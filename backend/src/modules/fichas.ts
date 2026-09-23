import { pool } from "../db.js";
import { config } from "../config.js";
import { fichasModificadas, isMockMode, type B2BFicha, type CursorFichas } from "../integrations/nexob2b.js";

/**
 * Las correcciones del catálogo maestro.
 *
 * Un mayorista sube siete mil productos, después arregla los títulos que
 * quedaron mal y carga las fotos que faltaban. Hasta acá esas correcciones no
 * llegaban: la ficha se copiaba al recibir una compra o al importar el catálogo
 * propio, y ahí se congelaba. El almacén que compró una vez se quedaba con el
 * título viejo para siempre.
 *
 * Ahora se leen los cambios por delta, con la clave de plataforma: una consulta
 * para todos los comercios, no una por cada uno.
 */

const CLAVE = "fichas-b2b";

/** Cada hora. Casi siempre no hay nada; cuando hay, llega en el día. */
const CADA = 3600_000;

/**
 * Cómo se llama en el POS la línea de una presentación.
 *
 * Es la misma construcción que usa la importación de catálogo propio, y por eso
 * después de la primera corrida los productos quedan con un nombre parejo sin
 * importar por dónde entraron —compra recibida o catálogo propio—. Hasta hoy
 * dependía del camino, que es una diferencia que nadie eligió.
 */
const nombreDeLinea = (ficha: B2BFicha, presentacion: string): string =>
  `${ficha.nombre} — ${presentacion}`;

/**
 * Aplica una ficha a las líneas locales que le correspondan.
 *
 * El cruce es por `presentacion.id` —la presentación maestra, `pp_`—, que es lo
 * que guardamos en `products.nexob2b_id`. Las filas viejas que guardaron el
 * listing del mayorista (`pmp_`) no se alcanzan: la ficha no trae los listings.
 * Se cuentan aparte en vez de darlas por actualizadas.
 *
 * Todo con COALESCE salvo el nombre y la galería. Un campo que la ficha manda
 * vacío es "no lo cargaron allá", no "borralo acá": el que perdería el dato es
 * el comerciante, que no tuvo nada que ver. El nombre sí se pisa, porque
 * corregirlo es justamente lo que vinimos a hacer.
 */
async function aplicarFicha(ficha: B2BFicha): Promise<number> {
  let tocadas = 0;
  for (const pres of ficha.presentaciones ?? []) {
    if (!pres.id) continue;
    const { rowCount } = await pool.query(
      `UPDATE products SET
         name = $2,
         ean = COALESCE($3, ean),
         descripcion = COALESCE($4, descripcion),
         brand = COALESCE($5, brand),
         alicuota_iva = COALESCE($6, alicuota_iva),
         image_url = COALESCE($7, image_url),
         imagenes = $8,
         pasillo_id = COALESCE($9, pasillo_id),
         pasillo_nombre = COALESCE($10, pasillo_nombre),
         rubro_id = COALESCE($11, rubro_id),
         rubro_nombre = COALESCE($12, rubro_nombre),
         category = COALESCE($12, category),
         subrubro_id = COALESCE($13, subrubro_id),
         subrubro_nombre = COALESCE($14, subrubro_nombre),
         synced_at = now()
       WHERE nexob2b_id = $1`,
      [
        pres.id,
        nombreDeLinea(ficha, pres.nombre),
        pres.ean_propio ?? ficha.ean,
        ficha.descripcion,
        ficha.marca,
        ficha.alicuota_iva === null || ficha.alicuota_iva === undefined
          ? null : Number(ficha.alicuota_iva),
        ficha.imagen_url,
        JSON.stringify(ficha.imagenes ?? []),
        ficha.pasillo_id, ficha.pasillo_nombre,
        ficha.rubro_id, ficha.rubro_nombre,
        ficha.subrubro_id, ficha.subrubro_nombre,
      ]
    );
    tocadas += rowCount ?? 0;
  }
  return tocadas;
}

async function cursorGuardado(): Promise<CursorFichas> {
  // La fecha sale como texto armado por Postgres, no como Date de JavaScript.
  // Un Date recorta a milisegundos; si NexoB2B vuelve a mandar microsegundos,
  // reenviar el cursor recortado lo deja antes del bloque empatado y la misma
  // página vuelve una y otra vez. Fue exactamente lo que pasó entre julio y
  // septiembre de 2026 (CR-0001), aunque esa vez la causa estaba del otro lado.
  const { rows: [c] } = await pool.query(
    `SELECT to_char(fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fecha, id
       FROM sync_cursor WHERE clave = $1`,
    [CLAVE]
  );
  // Sin cursor se arranca del principio de los tiempos: la primera corrida trae
  // el catálogo entero y deja todo parejo. Es una sola vez.
  return {
    desde: c?.fecha ?? "1970-01-01T00:00:00.000Z",
    ...(c?.id ? { desde_id: String(c.id) } : {}),
  };
}

const mismoCursor = (a: CursorFichas, b: CursorFichas): boolean =>
  new Date(a.desde).getTime() === new Date(b.desde).getTime() &&
  (a.desde_id ?? null) === (b.desde_id ?? null);

/**
 * Una corrida por vez. Resincronizar el catálogo entero son ~150 páginas y
 * puede pasar de la hora; sin esto el setInterval arranca otra encima con el
 * mismo cursor y las dos leen lo mismo.
 */
let corriendo = false;

/**
 * Trae y aplica lo que haya. Devuelve cuántas fichas leyó.
 *
 * El cursor se guarda DESPUÉS de aplicar cada página, no al final: si el
 * proceso se cae en la página nueve, la próxima corrida sigue por la nueve y no
 * vuelve a empezar. Y como cada página se aplica entera antes de mover el
 * cursor, reintentar la misma página no rompe nada: escribir dos veces el mismo
 * título deja el mismo título.
 */
export async function sincronizarFichas(): Promise<number> {
  if (isMockMode() || !config.platformKey) return 0;
  if (corriendo) return 0;
  corriendo = true;
  try {
    return await sincronizar();
  } finally {
    corriendo = false;
  }
}

async function sincronizar(): Promise<number> {
  let cursor = await cursorGuardado();
  const desde = cursor.desde;
  let leidas = 0;
  let filas = 0;
  let paginas = 0;
  let ultimoHayMas = false;
  // Los ids vistos en la corrida. Una página que no trae ninguna ficha nueva es
  // un cursor que no avanza: del 6 de julio al 23 de septiembre de 2026 se leyó
  // la misma página doscientas veces por hora y nada lo decía.
  const vistas = new Set<string>();

  // Tope de vueltas: con 500 por página son 100.000 fichas, más que el catálogo
  // entero. Si se llega acá es que el cursor no avanza, y girar para siempre
  // sería peor que cortar y volver dentro de una hora.
  for (let vuelta = 0; vuelta < 200; vuelta++) {
    const { fichas, hayMas, siguiente } = await fichasModificadas(cursor);
    paginas++;
    ultimoHayMas = hayMas;

    const nuevas = fichas.filter((f) => !vistas.has(f.id));
    if (fichas.length > 0 && nuevas.length === 0) {
      throw new Error(
        `el cursor no avanza: la página ${paginas} repite ${fichas.length} fichas ya leídas ` +
        `(desde=${cursor.desde}, desde_id=${cursor.desde_id ?? "-"})`
      );
    }
    if (hayMas && siguiente && mismoCursor(siguiente, cursor)) {
      throw new Error(`el cursor no avanza: NexoB2B devolvió el mismo siguiente (desde=${cursor.desde})`);
    }
    for (const f of fichas) vistas.add(f.id);

    for (const ficha of fichas) filas += await aplicarFicha(ficha);
    leidas += fichas.length;

    if (siguiente) {
      await pool.query(
        `INSERT INTO sync_cursor (clave, fecha, id, corrida_at, leidos, ultimo_error)
         VALUES ($1, $2, $3, now(), $4, NULL)
         ON CONFLICT (clave) DO UPDATE SET
           fecha = EXCLUDED.fecha, id = EXCLUDED.id,
           corrida_at = now(), leidos = EXCLUDED.leidos, ultimo_error = NULL`,
        [CLAVE, siguiente.desde, siguiente.desde_id ?? null, leidas]
      );
      cursor = siguiente;
    }
    if (!hayMas || !siguiente) break;
  }

  if (leidas > 0) {
    // Una línea con todo lo que hace falta para contestarle a NexoB2B si la
    // paginación terminó bien, sin tener que reconstruirlo de a página.
    console.log(
      `[fichas] ${leidas} fichas de NexoB2B (${vistas.size} distintas) en ${paginas} páginas ` +
      `desde ${desde}, hay_mas=${ultimoHayMas}, ${filas} líneas del stock actualizadas`
    );
  }
  return leidas;
}

export function iniciarFichas(): void {
  if (isMockMode() || !config.platformKey) {
    console.log("[fichas] sin NEXOPOS_PLATFORM_KEY: las correcciones del catálogo no se sincronizan");
    return;
  }
  const correr = () =>
    sincronizarFichas().catch(async (err) => {
      const detalle = err instanceof Error ? err.message : String(err);
      console.error("[fichas]", detalle);
      // El error se guarda donde se ve, no sólo en el log: una sincronización
      // que dejó de andar hace tres semanas no se nota por sí sola.
      await pool.query(
        `INSERT INTO sync_cursor (clave, corrida_at, ultimo_error) VALUES ($1, now(), $2)
         ON CONFLICT (clave) DO UPDATE SET corrida_at = now(), ultimo_error = EXCLUDED.ultimo_error`,
        [CLAVE, detalle.slice(0, 400)]
      ).catch(() => {});
    });
  // No al arrancar de una: el primer arranque después de un deploy tiene la
  // migración recién aplicada y el resto de los servicios subiendo.
  setTimeout(correr, 60_000).unref();
  setInterval(correr, CADA).unref();
}

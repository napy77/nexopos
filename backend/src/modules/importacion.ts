import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { buscarCatalogoMaestro, absolutas, type B2BProductoMaestro } from "../integrations/nexob2b.js";

/**
 * Alta masiva de productos: el CSV de la pantalla y `POST /api/erp/v1/productos`
 * pasan por acá, para que un comerciante y su ERP den de alta exactamente igual.
 *
 * Cada fila termina en una de cinco cosas:
 *
 *   actualizar    el comercio ya lo tiene: se le cambian precio, costo, stock
 *   vincular      el producto ya está en NexoPOS (otro comercio lo trajo):
 *                 se le agrega al comercio con sus números
 *   crear_b2b     está en el catálogo de NexoB2B: entra con su ficha —nombre,
 *                 foto, pasillo— como si lo hubiera agregado del catálogo
 *   crear_propio  no está en ningún lado: producto propio con el nombre del
 *                 archivo (decisión de German, 23/10)
 *   error         no se puede: queda listado con el motivo
 *
 * Reglas que no se discuten:
 *
 * - **El precio de venta sale del archivo y de ningún otro lado.** El costo de
 *   NexoB2B es el costo; usarlo de precio vende a costo miles de productos
 *   (regla 8 de CLAUDE.md). Sin precio, el producto entra pero no se vende ni
 *   sale a la tienda: es un problema que se ve, no uno que se descubre.
 * - **El stock del archivo reemplaza** (decisión de German, 23/10): es lo que
 *   hay, no lo que entró. Subir el mismo archivo dos veces no duplica nada. El
 *   movimiento registra la diferencia, para que la suma de movimientos siga
 *   dando el stock.
 * - Una columna vacía no borra: deja lo que había.
 */

type Ejecutor = Pick<PoolClient, "query">;

// ── Las filas ───────────────────────────────────────────────────────────────

export interface Fila {
  /** Número de renglón en el archivo, para que el comerciante lo encuentre */
  n: number;
  ean: string | null;
  nombre: string | null;
  unidad: string | null;
  /** En pesos. null = la columna no vino o estaba vacía */
  precio: number | null;
  costo: number | null;
  stock: number | null;
  stockMinimo: number | null;
  /** Lo que no se pudo leer de la fila, antes de buscar nada */
  problema?: string;
}

/**
 * Un número como lo escribe un comerciante argentino en Excel.
 *
 * "1.234,56", "1234,56", "$ 1.500", "1500.5". El punto seguido de exactamente
 * tres dígitos es de miles ("1.500" son mil quinientos, no uno y medio): es la
 * convención de acá, y equivocarse para el otro lado vende a $1,50 lo que vale
 * $1.500. Devuelve NaN si no es un número, para poder decir qué renglón está mal.
 */
export function numeroAR(crudo: unknown): number | null {
  if (crudo === null || crudo === undefined) return null;
  if (typeof crudo === "number") return Number.isFinite(crudo) ? crudo : NaN;
  let t = String(crudo).trim().replace(/^\$\s*/, "").replace(/\s/g, "");
  if (t === "") return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/**
 * El EAN tal como se compara: sólo dígitos. Vacío o "NXB" —la convención de
 * NexoB2B para "no tiene"— es null: producto sin código de barras.
 */
export function eanNormalizado(crudo: unknown): string | null | typeof NaN {
  const t = String(crudo ?? "").trim();
  if (t === "" || t.toUpperCase() === "NXB") return null;
  // Excel muestra los EAN largos como 7,79E+12 y así los guarda: no hay forma
  // de recuperar los dígitos, y adivinar le pondría el código de otro.
  if (/e\+/i.test(t)) return NaN;
  const d = t.replace(/[\s-]/g, "");
  return /^\d{6,14}$/.test(d) ? d : NaN;
}

/** Lo que llega, en el idioma de quien lo manda: el CSV en pesos, la API en centavos */
export interface FilaCruda {
  ean?: unknown; nombre?: unknown; unidad?: unknown;
  precio?: unknown; costo?: unknown; stock?: unknown; stock_minimo?: unknown;
}

export function normalizar(crudas: FilaCruda[], enCentavos = false): Fila[] {
  const plata = (v: unknown): number | null => {
    const n = numeroAR(v);
    return n === null || Number.isNaN(n) || !enCentavos ? n : n / 100;
  };
  return crudas.map((c, i) => {
    const ean = eanNormalizado(c.ean);
    const nombre = String(c.nombre ?? "").trim() || null;
    const f: Fila = {
      n: i + 1,
      ean: Number.isNaN(ean) ? null : (ean as string | null),
      nombre: nombre ? nombre.slice(0, 200) : null,
      unidad: String(c.unidad ?? "").trim().slice(0, 40) || null,
      precio: plata(c.precio),
      costo: plata(c.costo),
      stock: numeroAR(c.stock),
      stockMinimo: numeroAR(c.stock_minimo),
    };
    const malos = [
      Number.isNaN(ean) && "el EAN (van de 6 a 14 dígitos; si Excel lo muestra como 7,79E+12, poné esa columna como texto)",
      Number.isNaN(f.precio) && "el precio",
      Number.isNaN(f.costo) && "el costo",
      Number.isNaN(f.stock) && "el stock",
      Number.isNaN(f.stockMinimo) && "el stock mínimo",
    ].filter(Boolean);
    if (malos.length) f.problema = `No se entiende ${malos.join(", ")}.`;
    else if (!f.ean && !f.nombre) f.problema = "Sin EAN y sin nombre: no hay cómo saber qué producto es.";
    else if ((f.precio ?? 0) < 0 || (f.costo ?? 0) < 0 || (f.stockMinimo ?? 0) < 0) {
      f.problema = "Hay un número negativo donde no puede haberlo.";
    } else if (f.precio === 0) f.problema = "Precio en cero: dejalo vacío si todavía no tiene precio.";
    return f;
  });
}

// ── El plan ─────────────────────────────────────────────────────────────────

/** La ficha de NexoB2B con la que se va a dar de alta, ya elegida la presentación */
interface FichaB2B {
  presentacionId: string;
  ean: string | null;
  nombre: string;
  marca: string | null;
  unidad: string;
  factor: number;
  imagenUrl: string | null;
  imagenes: unknown[];
  alicuotaIva: number | null;
  descripcion: string | null;
  pasilloId: string | null; pasilloNombre: string | null;
  rubroId: string | null; rubroNombre: string | null;
  subrubroId: string | null; subrubroNombre: string | null;
}

export type Accion = "actualizar" | "vincular" | "crear_b2b" | "crear_propio" | "error";

export interface Paso {
  n: number;
  accion: Accion;
  /** Con qué nombre va a quedar, para mostrar en la vista previa */
  nombre: string;
  ean: string | null;
  productId?: number;
  ficha?: FichaB2B;
  motivo?: string;
  precio: number | null;
  costo: number | null;
  stock: number | null;
  stockMinimo: number | null;
  unidad: string | null;
  /** Lo que hay hoy, para que la vista previa muestre el cambio */
  stockAntes?: number;
  precioAntes?: number | null;
}

/**
 * De la búsqueda en el catálogo maestro, la presentación que corresponde a ese
 * EAN: la que lo tiene como propio (una caja con su código), y si no, la unidad.
 * Un EAN de unidad no es el de la caja x12: vender una caja a precio de unidad
 * es el error que esto evita.
 */
function elegirFicha(ean: string, encontrados: B2BProductoMaestro[]): FichaB2B | null {
  for (const p of encontrados) {
    const pres = p.presentaciones ?? [];
    const propia = pres.find((x) => x.ean_propio === ean);
    const deEsteEan = propia ?? (p.ean === ean ? (pres.find((x) => Number(x.factor) === 1) ?? pres[0]) : undefined);
    if (!deEsteEan) continue;
    return {
      presentacionId: deEsteEan.id,
      ean,
      nombre: `${p.nombre} — ${deEsteEan.nombre}`,
      marca: p.marca,
      unidad: deEsteEan.nombre,
      factor: Number(deEsteEan.factor) || 1,
      imagenUrl: p.imagen_url,
      imagenes: absolutas(p.imagenes),
      alicuotaIva: p.alicuota_iva === null ? null : Number(p.alicuota_iva),
      descripcion: p.descripcion ?? null,
      pasilloId: p.pasillo_id, pasilloNombre: p.pasillo_nombre,
      rubroId: p.rubro_id, rubroNombre: p.rubro_nombre,
      subrubroId: p.subrubro_id, subrubroNombre: p.subrubro_nombre,
    };
  }
  return null;
}

/** Cuántas consultas a NexoB2B a la vez. Más que esto es pegarle a su servidor. */
const EN_PARALELO = 6;

/**
 * Decide qué hacer con cada fila. Lee la base y NexoB2B, no escribe nada.
 *
 * Primero se resuelve todo lo que se puede con la base —lo que el comercio
 * ya tiene, lo que otro comercio ya trajo— y sólo lo que queda va a NexoB2B.
 * En un comercio que ya usa NexoPOS, la mayoría de las filas no salen de acá.
 */
export async function planificar(
  db: Ejecutor,
  commerceId: number,
  filas: Fila[],
  token: string,
  avance: (hechas: number) => Promise<void>
): Promise<Paso[]> {
  const pasos: Paso[] = new Array(filas.length);
  const base = (f: Fila) => ({
    n: f.n, ean: f.ean, precio: f.precio, costo: f.costo, stock: f.stock,
    stockMinimo: f.stockMinimo, unidad: f.unidad,
  });
  const error = (f: Fila, motivo: string): Paso =>
    ({ ...base(f), accion: "error", nombre: f.nombre ?? f.ean ?? "", motivo });

  // Un mismo producto dos veces en el archivo: ¿cuál de los dos precios vale?
  // No se adivina; la primera entra y las demás se marcan.
  const vistos = new Map<string, number>();
  const pendientesB2B: Fila[] = [];

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    if (f.problema) { pasos[i] = error(f, f.problema); continue; }

    const clave = f.ean ? `ean:${f.ean}` : `nombre:${f.nombre!.toLowerCase()}`;
    if (vistos.has(clave)) {
      pasos[i] = error(f, `Repetido: ya está en el renglón ${vistos.get(clave)}.`);
      continue;
    }
    vistos.set(clave, f.n);

    // ¿Ya lo tiene el comercio? Por EAN; sin EAN, un propio con ese nombre
    // (es lo que hace que subir el mismo archivo dos veces no duplique).
    const { rows: propios } = await db.query(
      f.ean
        ? `SELECT p.id, p.name, s.quantity, s.sale_price FROM stock_items s
             JOIN products p ON p.id = s.product_id
            WHERE s.commerce_id = $1 AND p.ean = $2 LIMIT 2`
        : `SELECT p.id, p.name, s.quantity, s.sale_price FROM stock_items s
             JOIN products p ON p.id = s.product_id
            WHERE s.commerce_id = $1 AND p.commerce_id = $1 AND lower(p.name) = lower($2) LIMIT 2`,
      [commerceId, f.ean ?? f.nombre]
    );
    if (propios.length > 1) {
      pasos[i] = error(f, f.ean
        ? `Tenés dos productos con el EAN ${f.ean}: no sabemos a cuál cargarle esto. Arreglalo en Productos.`
        : `Tenés dos productos llamados "${f.nombre}". Arreglalo en Productos.`);
      continue;
    }
    if (propios[0]) {
      pasos[i] = {
        ...base(f), accion: "actualizar", nombre: propios[0].name, productId: Number(propios[0].id),
        stockAntes: Number(propios[0].quantity),
        precioAntes: propios[0].sale_price === null ? null : Number(propios[0].sale_price),
      };
      continue;
    }

    if (!f.ean) {
      pasos[i] = { ...base(f), accion: "crear_propio", nombre: f.nombre! };
      continue;
    }

    // ¿Lo trajo otro comercio? El producto de NexoB2B es uno solo para todos.
    const { rows: globales } = await db.query(
      `SELECT id, name, factor FROM products
        WHERE ean = $1 AND commerce_id IS NULL AND origen = 'nexob2b'`,
      [f.ean]
    );
    const global = globales.length === 1
      ? globales[0]
      : globales.filter((g) => Number(g.factor) === 1).length === 1
        ? globales.find((g) => Number(g.factor) === 1)
        : null;
    if (global) {
      pasos[i] = { ...base(f), accion: "vincular", nombre: global.name, productId: Number(global.id), stockAntes: 0 };
      continue;
    }
    pendientesB2B.push(f);
    pasos[i] = undefined as unknown as Paso; // se completa abajo
  }

  let hechas = filas.length - pendientesB2B.length;
  await avance(hechas);

  // Lo que falta, a NexoB2B, de a varios. Si NexoB2B falla —no "no lo
  // encontré", sino que no contesta o la sesión venció— se corta todo: seguir
  // daría de alta como propios con el nombre del archivo productos que sí
  // tienen ficha, y eso no se arregla después sin trabajo a mano.
  const indice = new Map(filas.map((f, i) => [f.n, i]));
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < pendientesB2B.length) {
      const f = pendientesB2B[siguiente++];
      const encontrados = await buscarCatalogoMaestro(token, { ean: f.ean! });
      const ficha = elegirFicha(f.ean!, encontrados);
      pasos[indice.get(f.n)!] = ficha
        ? { ...base(f), accion: "crear_b2b", nombre: ficha.nombre, ficha, stockAntes: 0 }
        : f.nombre
          ? { ...base(f), accion: "crear_propio", nombre: f.nombre }
          : error(f, `El EAN ${f.ean} no está en el catálogo de NexoB2B y la fila no tiene nombre para darlo de alta como propio.`);
      hechas++;
      if (hechas % 25 === 0) await avance(hechas);
    }
  };
  await Promise.all(Array.from({ length: EN_PARALELO }, trabajador));
  await avance(filas.length);
  return pasos;
}

export function resumir(pasos: Paso[]) {
  const r = { actualizar: 0, vincular: 0, crear_b2b: 0, crear_propio: 0, error: 0, sinPrecio: 0 };
  for (const p of pasos) {
    r[p.accion]++;
    if (p.accion !== "error" && p.precio === null && (p.accion !== "actualizar" || p.precioAntes == null)) {
      r.sinPrecio++;
    }
  }
  return r;
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

/**
 * Escribe el plan, todo o nada: una importación a medias es peor que ninguna,
 * porque el comerciante no sabe qué renglón quedó y cuál no.
 */
export async function aplicarPlan(client: PoolClient, commerceId: number, pasos: Paso[], origen: string) {
  let aplicadas = 0;
  for (const p of pasos) {
    if (p.accion === "error") continue;
    let productId = p.productId;

    if (p.accion === "crear_b2b" && p.ficha) {
      const f = p.ficha;
      // Igual que agregar del catálogo (stock.ts, add-from-catalog): si otro
      // comercio lo trajo entre la vista previa y ahora, se usa ese.
      const { rows: [prod] } = await client.query(
        `INSERT INTO products (nexob2b_id, ean, name, brand, category, unit, image_url, alicuota_iva, factor,
                               pasillo_id, pasillo_nombre, rubro_id, rubro_nombre, subrubro_id, subrubro_nombre,
                               descripcion, imagenes, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
         ON CONFLICT (nexob2b_id) DO UPDATE SET synced_at = now()
         RETURNING id`,
        [f.presentacionId, f.ean, f.nombre, f.marca, f.rubroNombre, f.unidad, f.imagenUrl,
         f.alicuotaIva, f.factor, f.pasilloId, f.pasilloNombre, f.rubroId, f.rubroNombre,
         f.subrubroId, f.subrubroNombre, f.descripcion, JSON.stringify(f.imagenes)]
      );
      productId = Number(prod.id);
    }

    if (p.accion === "crear_propio") {
      const { rows: [prod] } = await client.query(
        `INSERT INTO products (commerce_id, origen, name, ean, unit, synced_at)
         VALUES ($1, 'propio', $2, $3, $4, now()) RETURNING id`,
        [commerceId, p.nombre, p.ean, p.unidad ?? "unidad"]
      );
      productId = Number(prod.id);
    }

    // El FOR UPDATE es por el mostrador: una venta entre la lectura y la
    // escritura no se puede perder (mismo cuidado que el PUT /stock del ERP).
    const { rows: [antes] } = await client.query(
      "SELECT quantity FROM stock_items WHERE commerce_id = $1 AND product_id = $2 FOR UPDATE",
      [commerceId, productId]
    );
    const cantidadAntes = antes ? Number(antes.quantity) : 0;
    const cantidadDespues = p.stock ?? cantidadAntes;

    await client.query(
      `INSERT INTO stock_items (commerce_id, product_id, quantity, cost, sale_price, min_stock,
                                precio_manual, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), $5::numeric IS NOT NULL, now())
       ON CONFLICT (commerce_id, product_id) DO UPDATE SET
         quantity = $3,
         cost = COALESCE($4, stock_items.cost),
         sale_price = COALESCE($5, stock_items.sale_price),
         -- Un precio que vino del archivo es del comerciante: la próxima
         -- corrida de márgenes lo respeta.
         precio_manual = (stock_items.precio_manual OR $5::numeric IS NOT NULL),
         min_stock = COALESCE($6, stock_items.min_stock),
         updated_at = now()`,
      [commerceId, productId, cantidadDespues, p.costo, p.precio, p.stockMinimo]
    );
    if (cantidadDespues !== cantidadAntes) {
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'import', $3, $4)`,
        [commerceId, productId, cantidadDespues - cantidadAntes,
         origen === "api" ? "Alta masiva desde el ERP" : "Importación de CSV"]
      );
    }
    aplicadas++;
  }
  return aplicadas;
}

// ── El trabajo en segundo plano ─────────────────────────────────────────────

/** Arranca una importación y devuelve su id. El análisis sigue solo. */
export async function iniciarImportacion(
  commerceId: number,
  crudas: FilaCruda[],
  opts: { origen: "csv" | "api"; archivo?: string; enCentavos?: boolean; autoAplicar?: boolean }
): Promise<number> {
  const filas = normalizar(crudas, opts.enCentavos);
  const { rows: [imp] } = await pool.query(
    `INSERT INTO importaciones (commerce_id, origen, archivo, total, filas, auto_aplicar)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [commerceId, opts.origen, opts.archivo ?? null, filas.length, JSON.stringify(filas),
     Boolean(opts.autoAplicar)]
  );
  const id = Number(imp.id);
  // Sin await a propósito: el request vuelve enseguida con el id y la
  // pantalla pregunta el avance. El error queda en la fila, no se pierde.
  analizar(id, commerceId, filas).catch(async (err) => {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error(`[importacion] ${id}:`, detalle);
    await pool.query(
      "UPDATE importaciones SET estado = 'error', error = $2, updated_at = now() WHERE id = $1",
      [id, detalle.slice(0, 500)]
    ).catch(() => {});
  });
  return id;
}

async function analizar(id: number, commerceId: number, filas: Fila[]) {
  const { rows: [com] } = await pool.query("SELECT nexob2b_token FROM commerces WHERE id = $1", [commerceId]);
  const pasos = await planificar(pool, commerceId, filas, com?.nexob2b_token ?? "", (hechas) =>
    pool.query("UPDATE importaciones SET procesadas = $2, updated_at = now() WHERE id = $1", [id, hechas])
      .then(() => undefined)
  );
  const { rows: [imp] } = await pool.query(
    `UPDATE importaciones SET estado = 'lista', plan = $2, resumen = $3, procesadas = total, updated_at = now()
      WHERE id = $1 RETURNING auto_aplicar`,
    [id, JSON.stringify(pasos), JSON.stringify(resumir(pasos))]
  );
  if (imp?.auto_aplicar) await aplicarImportacion(id, commerceId);
}

/** Aplica una importación lista. Sólo una vez: dos toques no importan dos veces. */
export async function aplicarImportacion(id: number, commerceId: number): Promise<number> {
  const { rows: [imp] } = await pool.query(
    `UPDATE importaciones SET estado = 'aplicando', updated_at = now()
      WHERE id = $1 AND commerce_id = $2 AND estado = 'lista'
      RETURNING plan, origen`,
    [id, commerceId]
  );
  if (!imp) throw new HttpError(409, "Esta importación no está lista para aplicar (ya se aplicó, o todavía se está analizando).");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const aplicadas = await aplicarPlan(client, commerceId, imp.plan as Paso[], imp.origen);
    await client.query(
      "UPDATE importaciones SET estado = 'aplicada', updated_at = now() WHERE id = $1", [id]
    );
    await client.query("COMMIT");
    await audit(commerceId, "productos.importacion", "importaciones", id, { aplicadas, origen: imp.origen });
    return aplicadas;
  } catch (err) {
    await client.query("ROLLBACK");
    await pool.query(
      "UPDATE importaciones SET estado = 'error', error = $2, updated_at = now() WHERE id = $1",
      [id, (err instanceof Error ? err.message : String(err)).slice(0, 500)]
    );
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Un análisis que estaba corriendo cuando se reinició el servidor no va a
 * terminar nunca: el trabajo vivía en memoria. Se marca, para que la pantalla
 * diga "subilo de nuevo" en vez de mostrar un avance congelado para siempre.
 */
export async function cerrarInterrumpidas(): Promise<void> {
  await pool.query(
    `UPDATE importaciones SET estado = 'error', updated_at = now(),
            error = 'Se interrumpió porque el servidor se reinició. Subí el archivo de nuevo.'
      WHERE estado IN ('analizando', 'aplicando')`
  );
}

/** Lo que ve la pantalla o el ERP de una importación */
export async function estadoImportacion(id: number, commerceId: number, centavos = false) {
  const { rows: [imp] } = await pool.query(
    `SELECT id, origen, estado, archivo, total, procesadas, plan, resumen, error, created_at
       FROM importaciones WHERE id = $1 AND commerce_id = $2`,
    [id, commerceId]
  );
  if (!imp) throw new HttpError(404, "No existe esa importación");
  const plan = (imp.plan ?? []) as Paso[];
  const plata = (v: number | null | undefined) =>
    v == null ? null : centavos ? Math.round(v * 100) : v;
  return {
    id: String(imp.id),
    origen: imp.origen,
    estado: imp.estado,
    archivo: imp.archivo,
    total: imp.total,
    procesadas: imp.procesadas,
    resumen: imp.resumen,
    error: imp.error,
    creada: new Date(imp.created_at).toISOString(),
    // Los errores todos (son los que hay que arreglar) y del resto una
    // muestra: dos mil renglones en pantalla no los lee nadie.
    errores: plan.filter((p) => p.accion === "error").map((p) => ({ fila: p.n, ean: p.ean, nombre: p.nombre, motivo: p.motivo })),
    muestra: plan.filter((p) => p.accion !== "error").slice(0, 50).map((p) => ({
      fila: p.n, accion: p.accion, ean: p.ean, nombre: p.nombre,
      ...(centavos
        ? { precio_centavos: plata(p.precio), precio_antes_centavos: plata(p.precioAntes) }
        : { precio: p.precio, precioAntes: p.precioAntes ?? null }),
      stock: p.stock, ...(centavos ? { stock_antes: p.stockAntes ?? null } : { stockAntes: p.stockAntes ?? null }),
    })),
  };
}

// ── Desde la pantalla ───────────────────────────────────────────────────────

export const importacionRouter = Router();

const MAX_FILAS = 5000;

const csvSchema = z.object({
  archivo: z.string().max(200).optional(),
  filas: z.array(z.record(z.unknown())).min(1).max(MAX_FILAS),
});

/** POST /api/importaciones — las filas del CSV, ya leídas por la pantalla */
importacionRouter.post("/", async (req, res, next) => {
  try {
    const body = csvSchema.parse(req.body);
    const id = await iniciarImportacion(req.auth.commerceId, body.filas as FilaCruda[], {
      origen: "csv", archivo: body.archivo,
    });
    res.status(202).json({ id: String(id) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/importaciones/:id */
importacionRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await estadoImportacion(Number(req.params.id), req.auth.commerceId));
  } catch (err) {
    next(err);
  }
});

/** POST /api/importaciones/:id/aplicar */
importacionRouter.post("/:id/aplicar", async (req, res, next) => {
  try {
    const aplicadas = await aplicarImportacion(Number(req.params.id), req.auth.commerceId);
    res.json({ aplicadas, ...(await estadoImportacion(Number(req.params.id), req.auth.commerceId)) });
  } catch (err) {
    next(err);
  }
});

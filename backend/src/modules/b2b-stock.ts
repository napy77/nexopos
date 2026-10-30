import { Router } from "express";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool, audit } from "../db.js";
import { operador } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { ajustarStockB2B, presentarseAB2B, isMockMode, type ResultadoStockB2B } from "../integrations/nexob2b.js";
import { requierePlataforma } from "./plataforma.js";

/**
 * El stock compartido con NexoB2B, para el negocio que es mayorista y comercio
 * a la vez. Son la misma empresa y el mismo depósito visto desde dos sistemas.
 *
 *   mostrador vende      → esta cola avisa a B2B    → baja allá
 *   mayorista despacha   → B2B avisa por webhook    → baja acá
 *
 * Las dos mitades se encienden juntas. Con una sola, el número del POS baja y
 * nunca sube —o sube y nunca baja— y a la semana el comerciante deja de
 * creerle, que es peor que no haber sincronizado nada.
 *
 * El interruptor es por comercio y arranca apagado: encenderlo mientras el ERP
 * del cliente sigue reescribiendo el total en B2B le devuelve las unidades que
 * el mostrador acaba de descontar.
 */

// ── Salida: lo que vendió el mostrador ──────────────────────────────────────

/** 1min, 5min, 15min, 1h, y de ahí cada 6h */
const esperaMinutos = (intentos: number): number => [1, 5, 15, 60][intentos] ?? 360;
const MAX_INTENTOS = 12;

/**
 * Encola el aviso. Se llama DENTRO de la transacción de la venta, con el mismo
 * client: si el ticket existe, el aviso existe.
 *
 * Filtra acá y no al enviar —una sola consulta por venta— qué líneas son del
 * catálogo propio. Las demás no se avisan: el stock de lo que el comercio le
 * compró a otros mayoristas es del POS y no tiene nada que hacer en B2B.
 */
export async function encolarStockB2B(
  client: PoolClient,
  commerceId: number,
  lineas: { productId: number; quantity: number }[],
  referencia: string
): Promise<void> {
  if (lineas.length === 0) return;

  const { rows } = await client.query(
    /*
     * Cómo se nombra el ítem, de más preciso a menos. NexoB2B acepta los tres:
     *
     *   pmp_id           la fila del mayorista. Exacta, siempre una sola.
     *   presentacion_id  la presentación del maestro.
     *   ean             último recurso.
     *
     * nexob2b_id guarda uno u otro según por dónde entró el producto: la
     * presentación maestra (pp_) por la importación de catálogo propio, el
     * listing del mayorista (pmp_) por una recepción de compra. Los dos sirven
     * tal cual, así que el EAN ya casi nunca se usa —y con él se va el último
     * lugar donde una presentación podía quedar sin nombrar, porque el EAN es
     * el único de los tres que puede faltar—.
     */
    `SELECT s.product_id,
            CASE WHEN p.nexob2b_id LIKE 'pmp\\_%' THEN p.nexob2b_id END AS pmp_id,
            CASE WHEN p.nexob2b_id LIKE 'pp\\_%'  THEN p.nexob2b_id END AS presentacion_id,
            NULLIF(p.ean, '') AS ean
       FROM stock_items s
       JOIN products p ON p.id = s.product_id
       JOIN commerces c ON c.id = s.commerce_id
      WHERE s.commerce_id = $1 AND s.product_id = ANY($2::bigint[])
        AND s.b2b_propio AND c.b2b_stock_sync
        AND (p.nexob2b_id IS NOT NULL OR NULLIF(p.ean, '') IS NOT NULL)`,
    [commerceId, lineas.map((l) => l.productId)]
  );
  if (rows.length === 0) return;

  const idDe = new Map(rows.map((r) => [Number(r.product_id), r]));
  for (const l of lineas) {
    const ids = idDe.get(l.productId);
    if (!ids) continue;
    await client.query(
      `INSERT INTO b2b_stock_outbox
         (commerce_id, product_id, pmp_id, presentacion_id, ean, cantidad, referencia)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [commerceId, l.productId, ids.pmp_id ?? null, ids.presentacion_id ?? null,
       ids.ean ?? null, l.quantity, referencia]
    );
  }
}

/**
 * Con qué nombre viaja un ítem. Sirve para armar el pedido y para nombrarlo en
 * el log; el resultado NO se cruza por acá sino por `indice`.
 */
function comoSeLlama(f: { pmp_id?: unknown; presentacion_id?: unknown; ean?: unknown }):
  { campo: "pmp_id" | "presentacion_id" | "ean"; valor: string } {
  if (f.pmp_id) return { campo: "pmp_id", valor: String(f.pmp_id) };
  if (f.presentacion_id) return { campo: "presentacion_id", valor: String(f.presentacion_id) };
  return { campo: "ean", valor: String(f.ean) };
}

/**
 * Arma los lotes que todavía no salieron nunca.
 *
 * El lote es la clave de idempotencia, así que tiene que quedar fijo antes de
 * la primera llamada. Si se armara en cada vuelta con lo que esté pendiente, un
 * reintento después de una venta nueva mandaría un conjunto distinto con clave
 * distinta, y NexoB2B volvería a sumar lo que ya había sumado.
 */
async function armarLotes(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT DISTINCT o.commerce_id
       FROM b2b_stock_outbox o JOIN commerces c ON c.id = o.commerce_id
      WHERE o.enviado_at IS NULL AND o.lote IS NULL AND c.b2b_stock_sync`
  );
  for (const { commerce_id } of rows) {
    await pool.query(
      `UPDATE b2b_stock_outbox SET lote = $2
        WHERE id IN (SELECT id FROM b2b_stock_outbox
                      WHERE commerce_id = $1 AND enviado_at IS NULL AND lote IS NULL
                      ORDER BY id LIMIT 100)`,
      [commerce_id, randomUUID()]
    );
  }
}

/** Manda los pendientes. Devuelve cuántos salieron. */
export async function despacharStockB2B(): Promise<number> {
  await armarLotes();

  const { rows } = await pool.query(
    `SELECT o.id, o.commerce_id, o.lote, o.pmp_id, o.presentacion_id, o.ean, o.cantidad,
            o.intentos, c.nexob2b_token
       FROM b2b_stock_outbox o JOIN commerces c ON c.id = o.commerce_id
      WHERE o.enviado_at IS NULL AND o.lote IS NOT NULL
        AND o.intentos < $1 AND o.proximo_intento <= now()
        AND c.b2b_stock_sync
      ORDER BY o.id`,
    [MAX_INTENTOS]
  );
  if (rows.length === 0) return 0;

  // Un viaje por lote: NexoB2B acepta varios ítems en una llamada y cada una
  // cuesta una ida y vuelta. Una venta de diez renglones sale en una.
  const porLote = new Map<string, typeof rows>();
  for (const fila of rows) {
    const clave = String(fila.lote);
    porLote.set(clave, [...(porLote.get(clave) ?? []), fila]);
  }

  let enviados = 0;
  for (const [lote, filas] of porLote) {
    const token = filas[0].nexob2b_token;
    if (!token) {
      await marcarError(filas, "El comercio no tiene sesión de NexoB2B: tiene que volver a entrar.");
      continue;
    }
    try {
      const { resultados, repetido } = await ajustarStockB2B(
        token,
        filas.map((f) => {
          const { campo, valor } = comoSeLlama(f);
          return { [campo]: valor, cantidad: Number(f.cantidad) };
        }),
        lote
      );
      if (repetido) {
        console.log(`[b2b-stock] lote ${lote} ya estaba aplicado del otro lado`);
      }

      /*
       * El resultado es por ítem: uno puede fallar porque esa presentación no
       * es de su propio catálogo. Reintentarlo no lo va a arreglar, así que se
       * cierra con el error escrito en vez de girar doce veces.
       *
       * Se cruza por `indice`, que es la posición del ítem que mandamos. El
       * orden también está garantizado, pero NexoB2B lo estaba cumpliendo por
       * cómo había quedado escrito su bucle y no por contrato: el que mañana
       * agrupe o filtre ahí adentro lo rompe sin enterarse. `indice` es el
       * contrato; el orden queda de respaldo para una versión vieja de ellos.
       *
       * Si no se puede cruzar —vinieron menos resultados que ítems y sin
       * índice— no se da nada por bueno: falla el lote entero y se reintenta
       * con la misma clave, que es idempotente. Marcar una línea como enviada
       * sin saber si entró es la forma de perder un descuento en silencio.
       */
      const porIndice = new Map<number, ResultadoStockB2B>();
      for (const [i, r] of resultados.entries()) {
        porIndice.set(typeof r.indice === "number" ? r.indice : i, r);
      }
      if (porIndice.size < filas.length) {
        await marcarError(
          filas,
          `NexoB2B contestó ${resultados.length} resultados para ${filas.length} ítems`
        );
        continue;
      }

      for (const [i, fila] of filas.entries()) {
        const resultado = porIndice.get(i)!;
        const fallo = resultado.ok ? undefined : (resultado.error ?? "rechazado");
        const suClave = comoSeLlama(fila).valor;
        if (fallo) {
          await pool.query(
            `UPDATE b2b_stock_outbox
                SET enviado_at = now(), intentos = $1, ultimo_error = $2
              WHERE id = $3`,
            [MAX_INTENTOS, `NexoB2B lo rechazó: ${fallo}`.slice(0, 400), fila.id]
          );
          console.error(`[b2b-stock] ${suClave} rechazado: ${fallo}`);
        } else {
          await pool.query("UPDATE b2b_stock_outbox SET enviado_at = now() WHERE id = $1", [fila.id]);
          enviados++;
        }
      }
    } catch (err) {
      await marcarError(filas, err instanceof Error ? err.message : String(err));
    }
  }
  return enviados;
}

async function marcarError(filas: { id: number; intentos: number }[], detalle: string): Promise<void> {
  for (const fila of filas) {
    const intentos = fila.intentos + 1;
    await pool.query(
      `UPDATE b2b_stock_outbox
          SET intentos = $1, ultimo_error = $2,
              proximo_intento = now() + ($3 || ' minutes')::interval
        WHERE id = $4`,
      [intentos, detalle.slice(0, 400), esperaMinutos(intentos), fila.id]
    );
    if (intentos >= MAX_INTENTOS) {
      console.error(`[b2b-stock] aviso ${fila.id} abandonado tras ${intentos} intentos: ${detalle}`);
    }
  }
}

export function iniciarStockB2B(): void {
  setInterval(() => {
    despacharStockB2B().catch((err) => console.error("[b2b-stock]", err));
  }, 15_000).unref();
}

// ── Entrada: lo que despachó el mayorista ───────────────────────────────────

export const b2bStockWebhookRouter = Router();

/**
 * Lo que le contestamos a NexoB2B por cada aviso. Los números suman
 * `recibidos`, y cuando no se aplicó nada `motivo` dice por qué: el 29/10
 * llegaron 900 avisos con «0 aplicadas» y del otro lado no había forma de
 * saber si era el interruptor, ids que no cruzaban o stock ya igual.
 */
type ResultadoAviso = {
  recibidos: number;
  aplicados: number;
  /** Ya teníamos ese mismo número: no es un error, no hay movimiento. */
  sin_cambio: number;
  /** Sin id o sin un `stock` numérico. */
  invalidos: number;
  /** El comercio no tiene ese producto como propio en el POS. */
  no_encontrados: number;
  /** Hasta diez, para poder buscarlos sin pedirnos el log. */
  no_encontrados_muestra: string[];
  /** Código fijo, para que lo registren tal cual. */
  motivo?: "interruptor_apagado";
};

/**
 * Aplica lo que NexoB2B dice que quedó. `stock` es el total resultante, no un
 * delta: es el número a escribir. El movimiento guarda la diferencia contra lo
 * que teníamos, que es lo que el comerciante necesita leer en el historial.
 */
async function aplicarStockDeB2B(
  commerceId: number,
  items: unknown[],
  origen: string
): Promise<ResultadoAviso> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let aplicados = 0, sinCambio = 0, invalidos = 0;
    const desconocidos: string[] = [];
    for (const raw of items) {
      const item = raw as { presentacion_id?: unknown; pmp_id?: unknown; stock?: unknown };
      const presentacionId = String(item?.presentacion_id ?? "");
      const pmpId = String(item?.pmp_id ?? "");
      const stock = Number(item?.stock);
      if ((!presentacionId && !pmpId) || !Number.isFinite(stock)) { invalidos++; continue; }

      // nexob2b_id guarda la presentación (pp_) si el producto entró por la
      // importación del catálogo propio, o el listing (pmp_) si entró por una
      // recepción de compra. NexoB2B manda los dos; se busca por cualquiera.
      const { rows: [linea] } = await client.query(
        `SELECT s.product_id, s.quantity
           FROM stock_items s JOIN products p ON p.id = s.product_id
          WHERE s.commerce_id = $1 AND p.nexob2b_id IN ($2::text, $3::text) AND s.b2b_propio
          LIMIT 1
          FOR UPDATE OF s`,
        [commerceId, presentacionId || null, pmpId || null]
      );
      if (!linea) { desconocidos.push(presentacionId || pmpId); continue; }

      const delta = stock - Number(linea.quantity);
      if (delta === 0) { sinCambio++; continue; }

      await client.query(
        "UPDATE stock_items SET quantity = $3, updated_at = now() WHERE commerce_id = $1 AND product_id = $2",
        [commerceId, linea.product_id, stock]
      );
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'b2b', $3, $4)`,
        [commerceId, linea.product_id, delta, `NexoB2B (${origen})`]
      );
      aplicados++;
    }
    await client.query("COMMIT");
    return {
      recibidos: items.length, aplicados, sin_cambio: sinCambio, invalidos,
      no_encontrados: desconocidos.length,
      no_encontrados_muestra: desconocidos.slice(0, 10),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const itemsDe = (body: unknown): unknown[] => {
  const b = body as { items?: unknown };
  return Array.isArray(b?.items) ? b.items : [];
};
const origenDe = (body: unknown): string => {
  const b = body as { origen?: unknown };
  return typeof b?.origen === "string" ? b.origen : "b2b";
};

/**
 * POST /api/nexob2b/stock — lo que despachó el mayorista, por la puerta de
 * plataforma.
 *
 * Lo llama NexoB2B cuando el stock de una presentación propia cambió por algo
 * que no fuimos nosotros: un despacho, una carga del ERP, un ajuste en el
 * portal. Nunca por una venta del mostrador: el eco descontaría dos veces.
 *
 * Hubo antes una puerta por comercio (`/stock/:token`, con un secreto), que
 * obligaba a copiar dos valores a NexoB2B por cada negocio —y el portal del
 * comercio no tiene dónde pegarlos—. Nunca recibió un aviso en producción y se
 * sacó el 28/10 (migración 049).
 *
 * Contesta 200 aunque un ítem no exista acá: es que el comercio todavía no lo
 * importó, no un error de NexoB2B.
 *
 * Acá no hay nada que generar ni que pegar: NexoB2B ya tiene la clave de
 * plataforma —la misma con la que verifica los slugs— y nos dice de qué
 * comercio habla con el id que él mismo le asignó. Un comercio nuevo prende su
 * interruptor y anda, sin que nadie configure nada en el medio.
 */
b2bStockWebhookRouter.post("/", requierePlataforma, async (req, res, next) => {
  try {
    const nexob2bId = String(req.body?.comercio_id ?? "").trim();
    if (!nexob2bId) throw new HttpError(400, "Falta `comercio_id`: el id del comercio en NexoB2B.");

    const { rows: [comercio] } = await pool.query(
      "SELECT id, b2b_stock_sync FROM commerces WHERE nexob2b_id = $1",
      [nexob2bId]
    );
    // 404 y no 200: acá no es "todavía no importó ese producto", es un comercio
    // que no existe de este lado. Si NexoB2B avisa de uno que no conocemos, los
    // dos queremos saberlo.
    if (!comercio) throw new HttpError(404, `No tenemos ningún comercio con el id ${nexob2bId} de NexoB2B.`);
    const items = itemsDe(req.body);
    const origen = origenDe(req.body);
    const r: ResultadoAviso = comercio.b2b_stock_sync
      ? await aplicarStockDeB2B(comercio.id, items, origen)
      : { recibidos: items.length, aplicados: 0, sin_cambio: 0, invalidos: 0,
          no_encontrados: 0, no_encontrados_muestra: [], motivo: "interruptor_apagado" };

    // Una línea por aviso, también con el interruptor apagado: es lo que
    // permite cruzar nuestro log con el de ellos sin adivinar.
    console.log(`[b2b-stock] aviso de B2B, comercio ${comercio.id} (${origen}): ` +
      (r.motivo ? `${r.recibidos} recibidos, ${r.motivo}`
        : `${r.recibidos} recibidos, ${r.aplicados} aplicados, ${r.sin_cambio} sin cambio, ` +
          `${r.no_encontrados} no encontrados, ${r.invalidos} inválidos`));
    res.json({ ok: true, ...r });
  } catch (err) {
    next(err);
  }
});

// ── Configuración ───────────────────────────────────────────────────────────

export const b2bStockRouter = Router();

/** GET /api/b2b-stock — estado para la pantalla de configuración */
b2bStockRouter.get("/", async (req, res, next) => {
  try {
    const commerceId = req.auth.commerceId;
    const { rows: [c] } = await pool.query(
      "SELECT b2b_stock_sync FROM commerces WHERE id = $1",
      [commerceId]
    );
    const { rows: [n] } = await pool.query(
      "SELECT COUNT(*)::int AS propios FROM stock_items WHERE commerce_id = $1 AND b2b_propio",
      [commerceId]
    );
    const { rows: [u] } = await pool.query(
      `SELECT MAX(created_at) AS ultimo FROM stock_movements
        WHERE commerce_id = $1 AND type = 'b2b'`,
      [commerceId]
    );
    const { rows: [p] } = await pool.query(
      `SELECT COUNT(*)::int AS pendientes,
              MAX(ultimo_error) FILTER (WHERE enviado_at IS NULL) AS ultimo_error
         FROM b2b_stock_outbox WHERE commerce_id = $1 AND enviado_at IS NULL`,
      [commerceId]
    );
    res.json({
      activo: Boolean(c?.b2b_stock_sync),
      // Sin catálogo propio importado no hay nada que sincronizar, y mostrar el
      // interruptor sería ofrecer algo que no va a hacer nada.
      productosPropios: n.propios,
      // Si NexoB2B avisó alguna vez. Sin esto, un interruptor prendido con la
      // otra mitad muerta se ve igual que uno que anda.
      ultimoAvisoB2B: u?.ultimo ?? null,
      pendientes: p.pendientes,
      ultimoError: p.ultimo_error ?? null,
      modoMock: isMockMode(),
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/b2b-stock — prender o apagar. */
b2bStockRouter.put("/", async (req, res, next) => {
  try {
    if (req.body?.activo) {
      // Antes de prender, no después: si B2B no reconoce la sesión, ninguna de
      // las dos mitades va a andar, y es mejor decirlo ahora que en una semana.
      const { rows: [t] } = await pool.query(
        "SELECT nexob2b_token FROM commerces WHERE id = $1", [req.auth.commerceId]);
      if (!t?.nexob2b_token)
        throw new HttpError(409, "No hay sesión de NexoB2B para este comercio. Volvé a entrar y probá de nuevo.");
      try {
        await presentarseAB2B(t.nexob2b_token);
      } catch (err) {
        console.error("[b2b-stock] no pudimos presentarnos a NexoB2B:", err);
        throw new HttpError(502, "NexoB2B no respondió. No se prendió; probá de nuevo en un rato.");
      }
    }
    const { rows: [c] } = await pool.query(
      "UPDATE commerces SET b2b_stock_sync = $2 WHERE id = $1 RETURNING b2b_stock_sync",
      [req.auth.commerceId, Boolean(req.body?.activo)]
    );
    // Quién lo prendió importa: el 28/10 apareció prendido en un comercio que
    // tenía que estar apagado, y no había forma de saber cuándo ni quién.
    await audit(req.auth.commerceId, c.b2b_stock_sync ? "b2b_stock.prender" : "b2b_stock.apagar",
      undefined, undefined, { operador: operador(req.auth) });
    res.json({ activo: Boolean(c.b2b_stock_sync) });
  } catch (err) {
    next(err);
  }
});

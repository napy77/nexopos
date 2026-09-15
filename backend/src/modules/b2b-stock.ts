import { Router } from "express";
import type { PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { ajustarStockB2B, isMockMode } from "../integrations/nexob2b.js";

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
    `SELECT s.product_id, p.ean
       FROM stock_items s
       JOIN products p ON p.id = s.product_id
       JOIN commerces c ON c.id = s.commerce_id
      WHERE s.commerce_id = $1 AND s.product_id = ANY($2::bigint[])
        AND s.b2b_propio AND c.b2b_stock_sync
        AND p.ean IS NOT NULL AND p.ean <> ''`,
    [commerceId, lineas.map((l) => l.productId)]
  );
  if (rows.length === 0) return;

  const eanDe = new Map<number, string>(rows.map((r) => [Number(r.product_id), String(r.ean)]));
  for (const l of lineas) {
    const ean = eanDe.get(l.productId);
    if (!ean) continue;
    await client.query(
      `INSERT INTO b2b_stock_outbox (commerce_id, product_id, ean, cantidad, referencia)
       VALUES ($1, $2, $3, $4, $5)`,
      [commerceId, l.productId, ean, l.quantity, referencia]
    );
  }
}

/** Manda los pendientes. Devuelve cuántos salieron. */
export async function despacharStockB2B(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT o.id, o.commerce_id, o.ean, o.cantidad, o.intentos, c.nexob2b_token
       FROM b2b_stock_outbox o JOIN commerces c ON c.id = o.commerce_id
      WHERE o.enviado_at IS NULL AND o.intentos < $1 AND o.proximo_intento <= now()
        AND c.b2b_stock_sync
      ORDER BY o.id LIMIT 100`,
    [MAX_INTENTOS]
  );
  if (rows.length === 0) return 0;

  // Agrupadas por comercio: NexoB2B acepta varios ítems en una llamada y cada
  // una cuesta un viaje. Una venta de diez renglones sale en una.
  const porComercio = new Map<number, typeof rows>();
  for (const fila of rows) {
    const clave = Number(fila.commerce_id);
    porComercio.set(clave, [...(porComercio.get(clave) ?? []), fila]);
  }

  let enviados = 0;
  for (const [commerceId, filas] of porComercio) {
    const token = filas[0].nexob2b_token;
    if (!token) {
      await marcarError(filas, "El comercio no tiene sesión de NexoB2B: tiene que volver a entrar.");
      continue;
    }
    try {
      const resultados = await ajustarStockB2B(
        token,
        filas.map((f) => ({ ean: String(f.ean), cantidad: Number(f.cantidad) }))
      );
      // El resultado es por ítem: uno puede fallar porque ese EAN no es de su
      // propio catálogo. Reintentarlo no lo va a arreglar, así que se cierra
      // con el error escrito en vez de girar doce veces.
      const falloDe = new Map(resultados.filter((r) => !r.ok).map((r) => [r.ean, r.error ?? "rechazado"]));
      for (const fila of filas) {
        const fallo = falloDe.get(String(fila.ean));
        if (fallo) {
          await pool.query(
            `UPDATE b2b_stock_outbox
                SET enviado_at = now(), intentos = $1, ultimo_error = $2
              WHERE id = $3`,
            [MAX_INTENTOS, `NexoB2B lo rechazó: ${fallo}`.slice(0, 400), fila.id]
          );
          console.error(`[b2b-stock] EAN ${fila.ean} rechazado: ${fallo}`);
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
 * POST /api/nexob2b/stock/:token
 *
 * Lo llama NexoB2B cuando el stock de una presentación propia cambió por algo
 * que no fuimos nosotros: un despacho, una carga del ERP, un ajuste en el
 * portal. Nunca por una venta del mostrador, que es la que mandamos nosotros:
 * el eco volvería a descontar lo mismo dos veces.
 *
 * Se autentica con un token en la URL porque del otro lado se configura una
 * URL y nada más. Es aleatorio de 32 bytes y el comerciante puede regenerarlo.
 *
 * `stock` es la cantidad RESULTANTE, no un delta: es el número a escribir. Por
 * eso el movimiento guarda la diferencia contra lo que teníamos, que es lo que
 * el comerciante necesita leer cuando revisa el historial.
 *
 * Contesta 200 aunque un ítem no exista acá. NexoB2B manda esto best-effort y
 * sin reintentos; un 4xx no le haría reintentar y sí llenaría sus logs de un
 * error que no es suyo —que el comercio todavía no importó ese producto—.
 */
b2bStockWebhookRouter.post("/:token", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rows: [comercio] } = await pool.query(
      "SELECT id, b2b_stock_sync FROM commerces WHERE b2b_webhook_token = $1",
      [String(req.params.token)]
    );
    if (!comercio) throw new HttpError(404, "Token desconocido");
    if (!comercio.b2b_stock_sync) {
      // Apagado no es un error: el comerciante lo apagó a propósito y NexoB2B
      // no tiene por qué enterarse ni reintentar.
      res.json({ ok: true, aplicados: 0, motivo: "sincronización apagada" });
      return;
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const origen = typeof req.body?.origen === "string" ? req.body.origen : "b2b";

    await client.query("BEGIN");
    let aplicados = 0;
    const desconocidos: string[] = [];
    for (const item of items) {
      const presentacionId = String(item?.presentacion_id ?? "");
      const stock = Number(item?.stock);
      if (!presentacionId || !Number.isFinite(stock)) continue;

      const { rows: [linea] } = await client.query(
        `SELECT s.product_id, s.quantity
           FROM stock_items s JOIN products p ON p.id = s.product_id
          WHERE s.commerce_id = $1 AND p.nexob2b_id = $2 AND s.b2b_propio
          FOR UPDATE OF s`,
        [comercio.id, presentacionId]
      );
      if (!linea) { desconocidos.push(presentacionId); continue; }

      const delta = stock - Number(linea.quantity);
      if (delta === 0) continue;

      await client.query(
        "UPDATE stock_items SET quantity = $3, updated_at = now() WHERE commerce_id = $1 AND product_id = $2",
        [comercio.id, linea.product_id, stock]
      );
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'b2b', $3, $4)`,
        [comercio.id, linea.product_id, delta, `NexoB2B (${origen})`]
      );
      aplicados++;
    }
    await client.query("COMMIT");

    if (desconocidos.length > 0) {
      console.warn(`[b2b-stock] ${desconocidos.length} presentaciones no están en el stock del comercio ${comercio.id}`);
    }
    res.json({ ok: true, aplicados, no_encontrados: desconocidos.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── Configuración ───────────────────────────────────────────────────────────

export const b2bStockRouter = Router();

/** GET /api/b2b-stock — estado para la pantalla de configuración */
b2bStockRouter.get("/", async (req, res, next) => {
  try {
    const commerceId = req.auth.commerceId;
    const { rows: [c] } = await pool.query(
      "SELECT b2b_stock_sync, b2b_webhook_token FROM commerces WHERE id = $1",
      [commerceId]
    );
    const { rows: [n] } = await pool.query(
      "SELECT COUNT(*)::int AS propios FROM stock_items WHERE commerce_id = $1 AND b2b_propio",
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
      webhookUrl: c?.b2b_webhook_token ? urlDelWebhook(String(c.b2b_webhook_token)) : null,
      pendientes: p.pendientes,
      ultimoError: p.ultimo_error ?? null,
      modoMock: isMockMode(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/b2b-stock — prender o apagar.
 *
 * Al prender se genera el token si no existía. No se borra al apagar: el
 * comerciante que apaga para probar algo y vuelve a prender no tiene que ir a
 * reconfigurar la URL en NexoB2B.
 */
b2bStockRouter.put("/", async (req, res, next) => {
  try {
    const commerceId = req.auth.commerceId;
    const activo = Boolean(req.body?.activo);
    const { rows: [c] } = await pool.query(
      `UPDATE commerces
          SET b2b_stock_sync = $2,
              b2b_webhook_token = COALESCE(b2b_webhook_token, $3)
        WHERE id = $1
        RETURNING b2b_stock_sync, b2b_webhook_token`,
      [commerceId, activo, activo ? randomBytes(32).toString("hex") : null]
    );
    res.json({
      activo: Boolean(c.b2b_stock_sync),
      webhookUrl: c.b2b_webhook_token ? urlDelWebhook(String(c.b2b_webhook_token)) : null,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/b2b-stock/regenerar — si el token se filtró */
b2bStockRouter.post("/regenerar", async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query(
      "UPDATE commerces SET b2b_webhook_token = $2 WHERE id = $1 RETURNING b2b_webhook_token",
      [req.auth.commerceId, randomBytes(32).toString("hex")]
    );
    res.json({ webhookUrl: urlDelWebhook(String(c.b2b_webhook_token)) });
  } catch (err) {
    next(err);
  }
});

/**
 * La URL que el comerciante pega en NexoB2B.
 *
 * El dominio sale de PUBLIC_URL porque acá no hay request del comerciante de
 * la cual deducirlo cuando la arma el que despacha, y porque detrás de nginx
 * el Host puede ser localhost.
 */
function urlDelWebhook(token: string): string {
  const base = (process.env.PUBLIC_URL ?? "https://nexopos.app").replace(/\/$/, "");
  return `${base}/api/nexob2b/stock/${token}`;
}

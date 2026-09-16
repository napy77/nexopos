import { Router } from "express";
import type { PoolClient } from "pg";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
    /*
     * Se manda `presentacion_id`, no el EAN: con el EAN, una "unidad" y una
     * "caja x12" que comparten el código del producto se descontaban las dos.
     *
     * nexob2b_id guarda la presentación maestra (pp_) para lo que entró por la
     * importación de catálogo propio. Las filas viejas que llegaron por una
     * compra pueden tener el listing del mayorista (pmp_), que no sirve acá:
     * para ésas queda el EAN. Una línea sin ninguno de los dos no se puede
     * nombrar y no se encola.
     */
    `SELECT s.product_id,
            CASE WHEN p.nexob2b_id LIKE 'pp\\_%' THEN p.nexob2b_id END AS presentacion_id,
            NULLIF(p.ean, '') AS ean
       FROM stock_items s
       JOIN products p ON p.id = s.product_id
       JOIN commerces c ON c.id = s.commerce_id
      WHERE s.commerce_id = $1 AND s.product_id = ANY($2::bigint[])
        AND s.b2b_propio AND c.b2b_stock_sync
        AND (p.nexob2b_id LIKE 'pp\\_%' OR NULLIF(p.ean, '') IS NOT NULL)`,
    [commerceId, lineas.map((l) => l.productId)]
  );
  if (rows.length === 0) return;

  const idDe = new Map(rows.map((r) => [Number(r.product_id), r]));
  for (const l of lineas) {
    const ids = idDe.get(l.productId);
    if (!ids) continue;
    await client.query(
      `INSERT INTO b2b_stock_outbox (commerce_id, product_id, presentacion_id, ean, cantidad, referencia)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [commerceId, l.productId, ids.presentacion_id ?? null, ids.ean ?? null, l.quantity, referencia]
    );
  }
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
    `SELECT o.id, o.commerce_id, o.lote, o.presentacion_id, o.ean, o.cantidad,
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
        filas.map((f) => ({
          ...(f.presentacion_id ? { presentacion_id: String(f.presentacion_id) } : { ean: String(f.ean) }),
          cantidad: Number(f.cantidad),
        })),
        lote
      );
      if (repetido) {
        console.log(`[b2b-stock] lote ${lote} ya estaba aplicado del otro lado`);
      }

      // El resultado es por ítem: uno puede fallar porque esa presentación no
      // es de su propio catálogo. Reintentarlo no lo va a arreglar, así que se
      // cierra con el error escrito en vez de girar doce veces.
      const clave = (r: { presentacion_id?: string; ean?: string }) => r.presentacion_id ?? r.ean ?? "";
      const falloDe = new Map(
        resultados.filter((r) => !r.ok).map((r) => [clave(r), r.error ?? "rechazado"])
      );
      for (const fila of filas) {
        const suClave = String(fila.presentacion_id ?? fila.ean ?? "");
        const fallo = falloDe.get(suClave);
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
 * POST /api/nexob2b/stock/:token
 *
 * Lo llama NexoB2B cuando el stock de una presentación propia cambió por algo
 * que no fuimos nosotros: un despacho, una carga del ERP, un ajuste en el
 * portal. Nunca por una venta del mostrador, que es la que mandamos nosotros:
 * el eco volvería a descontar lo mismo dos veces.
 *
 * Se autentica de dos formas, y las dos conviven a propósito:
 *
 * - El token de la URL, que alcanza solo. Fue lo primero que hubo, porque del
 *   otro lado se configuraba una URL y nada más.
 * - `X-Nexob2b-Secret`, que NexoB2B agregó después. Es mejor: un secreto en
 *   una URL termina en los logs del proxy y en el portapapeles del que la
 *   pegue.
 *
 * Mientras el comerciante no cargue el secreto allá, no llega el header y vale
 * el token. Una vez cargado, se exige: si el secreto existe de este lado, un
 * pedido sin él —o con otro— no entra, porque a esa altura la única razón para
 * que falte es que no venga de NexoB2B.
 *
 * La comparación es de tiempo constante. Un `===` sobre un secreto contesta
 * más rápido cuando los primeros caracteres no coinciden, y eso se mide.
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
      "SELECT id, b2b_stock_sync, b2b_webhook_secret FROM commerces WHERE b2b_webhook_token = $1",
      [String(req.params.token)]
    );
    if (!comercio) throw new HttpError(404, "Token desconocido");
    if (comercio.b2b_webhook_secret &&
        !mismoSecreto(req.get("x-nexob2b-secret"), String(comercio.b2b_webhook_secret))) {
      throw new HttpError(401, "Secreto inválido");
    }
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
      "SELECT b2b_stock_sync, b2b_webhook_token, b2b_webhook_secret FROM commerces WHERE id = $1",
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
      webhookSecret: c?.b2b_webhook_secret ?? null,
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
              b2b_webhook_token = COALESCE(b2b_webhook_token, $3),
              b2b_webhook_secret = COALESCE(b2b_webhook_secret, $4)
        WHERE id = $1
        RETURNING b2b_stock_sync, b2b_webhook_token, b2b_webhook_secret`,
      [commerceId, activo,
       activo ? randomBytes(32).toString("hex") : null,
       activo ? randomBytes(32).toString("hex") : null]
    );
    res.json({
      activo: Boolean(c.b2b_stock_sync),
      webhookUrl: c.b2b_webhook_token ? urlDelWebhook(String(c.b2b_webhook_token)) : null,
      webhookSecret: c.b2b_webhook_secret ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/b2b-stock/regenerar — si se filtraron.
 *
 * Cambian los dos de una: el que regenera porque perdió el control de uno no
 * sabe si perdió el otro, y dejarle la mitad vieja es dejarle el problema.
 * Hasta que los vuelva a cargar en NexoB2B, los avisos de ellos no entran.
 */
b2bStockRouter.post("/regenerar", async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query(
      `UPDATE commerces SET b2b_webhook_token = $2, b2b_webhook_secret = $3
        WHERE id = $1 RETURNING b2b_webhook_token, b2b_webhook_secret`,
      [req.auth.commerceId, randomBytes(32).toString("hex"), randomBytes(32).toString("hex")]
    );
    res.json({
      webhookUrl: urlDelWebhook(String(c.b2b_webhook_token)),
      webhookSecret: c.b2b_webhook_secret,
    });
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
/** Compara sin filtrar por tiempo dónde dejan de coincidir. */
function mismoSecreto(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  // timingSafeEqual exige el mismo largo; un largo distinto ya es distinto.
  return a.length === b.length && timingSafeEqual(a, b);
}

function urlDelWebhook(token: string): string {
  const base = (process.env.PUBLIC_URL ?? "https://nexopos.app").replace(/\/$/, "");
  return `${base}/api/nexob2b/stock/${token}`;
}

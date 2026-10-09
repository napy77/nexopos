import { Router } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { isMockMode, aCentavos } from "../integrations/clubpay.js";
import {
  estadoCuentaMP, crearCobroMP, consultarCobroMP, cancelarCobroMP, devolverCobroMP,
  mockResolverCheckout, simulandoCobros, type CobroMP, type EstadoCuentaMP,
} from "../integrations/clubpay-cobros.js";
import { encolarEvento } from "./webhooks.js";
import { armarOrder } from "./v1-pedidos.js";

/**
 * Cobrar con Mercado Pago en el mostrador y en la tienda.
 *
 * Nadie en NexoPOS conecta Mercado Pago: el comercio lo conectó en ClubPay, y
 * acá se le pide el cobro a ClubPay con la clave `pos_…`. Contrato en
 * docs/RESPUESTA-COBROS-MERCADOPAGO-DE-CLUBPAY.md.
 *
 * Tres cosas que ClubPay avisó y que ordenan este archivo:
 *
 * 1. `rejected` no es final, y un `cancelled` o `expired` puede terminar en
 *    `paid` si el cliente ya estaba pagando. Por eso el estado se guarda en
 *    `mp_cobros` y los efectos se disparan en la TRANSICIÓN, no en el estado.
 * 2. Los avisos llegan desordenados. No se confía en el cuerpo del aviso: se
 *    le pregunta a ClubPay cómo está el cobro ahora y se aplica eso.
 * 3. Un pago que nadie va a usar —el cajero ya cobró en efectivo, el pedido ya
 *    se canceló— se devuelve solo. Es plata del cliente, y que el comerciante
 *    tenga que darse cuenta y devolverla a mano es exactamente cómo se pierde.
 */

export const mercadopagoRouter = Router();

async function claveDe(commerceId: number): Promise<string> {
  const { rows } = await pool.query("SELECT clubpay_api_key FROM commerces WHERE id = $1", [commerceId]);
  const key: string = rows[0]?.clubpay_api_key ?? "";
  if (!key && !isMockMode()) {
    throw new HttpError(409, "Este comercio no tiene ClubPay configurado, y Mercado Pago se cobra a través de ClubPay.");
  }
  return key;
}

// ── ¿Se puede cobrar? ────────────────────────────────────────────────────────

export interface DisponibilidadMP {
  mostrador: boolean;
  tienda: boolean;
  /** Por qué no, escrito para el comerciante. null si anda todo. */
  motivo: string | null;
}

/**
 * Lo que dice ClubPay se guarda unos minutos: el comercio prende el interruptor
 * una vez, y esto se consulta en cada armado de la tienda. Preguntarle en cada
 * visita sería atar la velocidad de todas las tiendas a la de ellos.
 *
 * El interruptor de NexoPOS no se cachea: es una fila nuestra, y el
 * comerciante que lo acaba de apagar espera que se apague ya.
 */
const CACHE_MS = 2 * 60_000;
const cache = new Map<number, { at: number; valor: EstadoCuentaMP }>();

export async function disponibilidadMP(commerceId: number): Promise<DisponibilidadMP> {
  const { rows } = await pool.query(
    "SELECT clubpay_api_key, clubpay_pay_enabled FROM commerces WHERE id = $1", [commerceId]
  );
  const key: string = rows[0]?.clubpay_api_key ?? "";
  // El interruptor de la tienda es del comerciante, en NexoPOS: puede querer
  // Mercado Pago en el mostrador y no en la tienda, o al revés.
  const tiendaPrendida = Boolean(rows[0]?.clubpay_pay_enabled);
  // Sin ClubPay y sin simulador pedido: no se ofrece, y sin motivo, porque no
  // hay nada que el comerciante pueda hacer al respecto.
  if (isMockMode() && !simulandoCobros()) return { mostrador: false, tienda: false, motivo: null };
  if (!key && !isMockMode()) {
    return { mostrador: false, tienda: false, motivo: "Mercado Pago se cobra a través de ClubPay, y este comercio no tiene la clave cargada." };
  }

  let e: EstadoCuentaMP;
  const guardado = cache.get(commerceId);
  if (guardado && Date.now() - guardado.at < CACHE_MS) {
    e = guardado.valor;
  } else {
    try {
      e = await estadoCuentaMP(key);
      cache.set(commerceId, { at: Date.now(), valor: e });
    } catch (err) {
      // ClubPay caído: no se ofrece lo que no se va a poder cobrar. Y no se
      // cachea, para que vuelva apenas ellos vuelvan.
      console.error("[mercadopago] estado:", err instanceof Error ? err.message : err);
      return { mostrador: false, tienda: false, motivo: "No pudimos consultar ClubPay. Probá en un rato." };
    }
  }
  const cuenta = e.mercadopago === "connected" && e.enabled_for_pos;
  return {
    mostrador: cuenta && e.mostrador_listo,
    tienda: cuenta && tiendaPrendida,
    motivo:
      e.mercadopago === "disconnected" ? "Conectá Mercado Pago en ClubPay › Cobros."
      : e.mercadopago === "expired" ? "Hay que volver a conectar Mercado Pago en ClubPay › Cobros."
      : !e.enabled_for_pos ? "Activá «Cobrar también desde NexoPOS y NexoTienda» en ClubPay › Cobros."
      : !e.mostrador_listo ? "Para el QR del mostrador falta cargar la dirección del local en ClubPay › Cobros."
      : null,
  };
}

/** Al cambiar la clave de ClubPay, lo cacheado es de la clave vieja */
export const olvidarEstadoMP = (commerceId: number): void => { cache.delete(commerceId); };

// ── Aplicar el estado de un cobro ────────────────────────────────────────────

/**
 * Guarda cómo está un cobro y dispara lo que corresponda al CAMBIO.
 *
 * Es el único lugar que mueve estados: lo llaman el polling del mostrador, el
 * aviso de ClubPay, el checkout simulado y las devoluciones. Si lo hicieran
 * por separado, tarde o temprano dos caminos marcan pagado el mismo pedido.
 */
export async function aplicarCobro(commerceId: number, cobro: CobroMP): Promise<void> {
  const client = await pool.connect();
  let devolver: { ref: string } | null = null;
  try {
    await client.query("BEGIN");
    const { rows: [antes] } = await client.query(
      "SELECT * FROM mp_cobros WHERE payment_id = $1 AND commerce_id = $2 FOR UPDATE",
      [cobro.payment_id, commerceId]
    );
    if (!antes) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query(
      `UPDATE mp_cobros SET status = $2, fee_cents = $3, refunded_cents = $4, error = $5,
              paid_at = $6, mp_payment_id = $7, updated_at = now()
        WHERE id = $1`,
      [antes.id, cobro.status, cobro.fee_cents ?? 0, cobro.refunded_cents ?? 0, cobro.error,
       cobro.paid_at, cobro.mp_payment_id]
    );
    const sePago = cobro.status === "paid" && antes.status !== "paid" && antes.status !== "refunded";

    if (antes.channel === "tienda" && antes.order_id) {
      const orderId = Number(antes.order_id);
      const { rows: [o] } = await client.query(
        "SELECT status, payment_status, payment_id FROM orders WHERE id = $1 FOR UPDATE", [orderId]
      );
      if (sePago) {
        // Un pedido se paga una vez. Si ya se canceló, o ya lo pagó otro
        // intento (el comprador abrió dos links), éste se devuelve.
        const otroPago = o.payment_status === "pagado" && o.payment_id && o.payment_id !== cobro.payment_id;
        if (o.status === "cancelado" || otroPago) {
          devolver = { ref: `${antes.external_reference}-devolucion` };
        } else {
          await client.query(
            `UPDATE orders SET payment_status = 'pagado', payment_id = $2, payment_error = NULL,
                    updated_at = now() WHERE id = $1`,
            [orderId, cobro.payment_id]
          );
          await encolarEvento(client, commerceId, orderId, "order.pagado", await armarOrder(orderId, client));
        }
      } else if (cobro.status === "rejected" && antes.status !== "rejected"
                 && ["pendiente", "rechazado"].includes(o.payment_status)) {
        await client.query(
          `UPDATE orders SET payment_status = 'rechazado', payment_error = $2, updated_at = now()
            WHERE id = $1`,
          [orderId, cobro.error ?? "Mercado Pago rechazó el pago."]
        );
        await encolarEvento(client, commerceId, orderId, "order.pago_rechazado", await armarOrder(orderId, client));
      } else if (cobro.status === "refunded" && cobro.refunded_cents >= cobro.amount_cents
                 && o.payment_id === cobro.payment_id && o.payment_status !== "reembolsado") {
        await client.query(
          "UPDATE orders SET payment_status = 'reembolsado', updated_at = now() WHERE id = $1", [orderId]
        );
        await encolarEvento(client, commerceId, orderId, "order.reembolsado", await armarOrder(orderId, client));
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (devolver) await devolverYAplicar(commerceId, cobro.payment_id, devolver.ref);
  await devolverSiAbandonado(commerceId, cobro.payment_id);
}

/**
 * El cajero canceló el QR y cobró de otra forma, pero el cliente ya estaba
 * pagando y Mercado Pago lo aprobó igual. Ese pago no está en ninguna venta:
 * se devuelve.
 */
async function devolverSiAbandonado(commerceId: number, paymentId: string): Promise<void> {
  const { rows: [c] } = await pool.query(
    `SELECT external_reference FROM mp_cobros
      WHERE payment_id = $1 AND commerce_id = $2 AND channel = 'mostrador'
        AND abandonado AND status = 'paid' AND sale_id IS NULL`,
    [paymentId, commerceId]
  );
  if (!c) return;
  console.warn(`[mercadopago] ${paymentId} se pagó después de cancelado: se devuelve`);
  await devolverYAplicar(commerceId, paymentId, `${c.external_reference}-devolucion`);
}

async function devolverYAplicar(commerceId: number, paymentId: string, ref: string): Promise<void> {
  try {
    const key = await claveDe(commerceId);
    const r = await devolverCobroMP(key, paymentId, { externalReference: ref });
    await audit(commerceId, "mercadopago.devolucion_automatica", "mp_cobros", undefined, { paymentId });
    await aplicarCobro(commerceId, r);
  } catch (err) {
    // Que falle no puede tirar el aviso: ClubPay reintenta, y en el próximo
    // intento se vuelve a probar. La referencia hace que no se devuelva dos
    // veces.
    console.error(`[mercadopago] no se pudo devolver ${paymentId}:`, err instanceof Error ? err.message : err);
  }
}

/** Le pregunta a ClubPay cómo está y lo aplica. Es lo que hay que hacer ante cualquier duda. */
export async function refrescarCobro(commerceId: number, paymentId: string): Promise<CobroMP> {
  const key = await claveDe(commerceId);
  const cobro = await consultarCobroMP(key, paymentId);
  await aplicarCobro(commerceId, cobro);
  return cobro;
}

/**
 * El aviso de ClubPay. Del cuerpo sólo se toma el `payment_id`: el estado se
 * le vuelve a preguntar, porque dos avisos pueden llegar desordenados y el
 * último en llegar no es necesariamente el último que pasó.
 */
export async function procesarAvisoCobro(apiKey: string, cuerpo: unknown): Promise<void> {
  const aviso = z.object({ payment_id: z.string().min(1) }).passthrough().parse(cuerpo);
  const { rows: [comercio] } = await pool.query(
    "SELECT id FROM commerces WHERE clubpay_api_key = $1", [apiKey]
  );
  if (!comercio) throw new HttpError(401, "Clave desconocida");
  const commerceId = Number(comercio.id);
  const { rows: [propio] } = await pool.query(
    "SELECT 1 FROM mp_cobros WHERE payment_id = $1 AND commerce_id = $2", [aviso.payment_id, commerceId]
  );
  // Un cobro que no creamos nosotros no se aplica a nada; se contesta bien
  // para que no lo reintenten siete días.
  if (!propio) {
    console.warn(`[mercadopago] aviso de un cobro desconocido: ${aviso.payment_id}`);
    return;
  }
  try {
    await refrescarCobro(commerceId, aviso.payment_id);
  } catch (err) {
    // Si ClubPay no contesta el GET justo ahora, se usa el aviso. Peor que
    // releer, mejor que perderlo: aplicarCobro igual no retrocede un pagado.
    console.error("[mercadopago] no se pudo releer el cobro, se usa el aviso:", err instanceof Error ? err.message : err);
    const { rows: [actual] } = await pool.query(
      "SELECT status FROM mp_cobros WHERE payment_id = $1", [aviso.payment_id]
    );
    const c = cuerpo as CobroMP;
    if (actual?.status === "paid" && c.status !== "refunded") return;
    await aplicarCobro(commerceId, c);
  }
}

// ── Mostrador ────────────────────────────────────────────────────────────────

/** GET /api/mercadopago/estado — si el mostrador puede ofrecer Mercado Pago */
mercadopagoRouter.get("/estado", async (req, res, next) => {
  try {
    res.json({ ...(await disponibilidadMP(req.auth.commerceId)), simulador: simulandoCobros() });
  } catch (err) {
    next(err);
  }
});

const cobroSchema = z.object({
  /** Lo que queda por cobrar, en pesos: el total menos el descuento de socio */
  total: z.coerce.number().positive(),
  /** Igual mientras sea el mismo intento sobre el mismo ticket: hace idempotente el pedido */
  referencia: z.string().min(1).max(60).optional(),
});

/**
 * POST /api/mercadopago/cobro
 * Crea el cobro y devuelve el QR dibujado. El cliente lo escanea con Mercado
 * Pago o con cualquier billetera que lea el QR interoperable.
 */
mercadopagoRouter.post("/cobro", async (req, res, next) => {
  try {
    const { total, referencia } = cobroSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    const disp = await disponibilidadMP(commerceId);
    if (!disp.mostrador) throw new HttpError(409, disp.motivo ?? "Mercado Pago no está disponible en el mostrador.");

    const key = await claveDe(commerceId);
    const { rows: [com] } = await pool.query("SELECT name FROM commerces WHERE id = $1", [commerceId]);
    const cobro = await crearCobroMP(key, {
      amountCents: aCentavos(total),
      externalReference: `nexopos-${commerceId}-mp-${referencia ?? randomUUID().slice(0, 8)}`,
      channel: "mostrador",
      description: `${com?.name ?? "Compra"} · mostrador`,
    });
    await pool.query(
      `INSERT INTO mp_cobros (commerce_id, payment_id, external_reference, channel, amount_cents, status)
       VALUES ($1, $2, $3, 'mostrador', $4, $5) ON CONFLICT (payment_id) DO NOTHING`,
      [commerceId, cobro.payment_id, cobro.external_reference, cobro.amount_cents, cobro.status]
    );
    if (!cobro.qr_data) throw new HttpError(502, "ClubPay no devolvió el QR del cobro.");
    const qrDataUrl = await QRCode.toDataURL(cobro.qr_data, { width: 320, margin: 1, errorCorrectionLevel: "M" });
    await audit(commerceId, "mercadopago.cobro", "mp_cobros", undefined, { paymentId: cobro.payment_id, total });
    res.status(201).json({
      paymentId: cobro.payment_id,
      status: cobro.status,
      qrDataUrl,
      expiresAt: cobro.expires_at,
      monto: cobro.amount_cents / 100,
    });
  } catch (err) {
    next(err);
  }
});

async function cobroDelComercio(commerceId: number, paymentId: string) {
  const { rows: [c] } = await pool.query(
    "SELECT * FROM mp_cobros WHERE payment_id = $1 AND commerce_id = $2", [paymentId, commerceId]
  );
  if (!c) throw new HttpError(404, "Cobro no encontrado");
  return c;
}

/** GET /api/mercadopago/cobro/:paymentId — el mostrador consulta cada ~2 s */
mercadopagoRouter.get("/cobro/:paymentId", async (req, res, next) => {
  try {
    await cobroDelComercio(req.auth.commerceId, req.params.paymentId);
    const c = await refrescarCobro(req.auth.commerceId, req.params.paymentId);
    res.json({ paymentId: c.payment_id, status: c.status, error: c.error, monto: c.amount_cents / 100 });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mercadopago/cobro/:paymentId/cancelar
 *
 * Puede contestar `paid`: el cliente pagó justo antes. Ahí la pantalla no
 * cierra, cobra. Si en cambio quedó cancelado y Mercado Pago lo aprueba igual
 * después, se devuelve solo (ver devolverSiAbandonado).
 */
mercadopagoRouter.post("/cobro/:paymentId/cancelar", async (req, res, next) => {
  try {
    const commerceId = req.auth.commerceId;
    const propio = await cobroDelComercio(commerceId, req.params.paymentId);
    if (propio.sale_id) throw new HttpError(409, "Ese cobro ya está en una venta.");
    const key = await claveDe(commerceId);
    const c = await cancelarCobroMP(key, req.params.paymentId);
    if (c.status !== "paid") {
      await pool.query("UPDATE mp_cobros SET abandonado = true WHERE id = $1", [propio.id]);
    }
    await aplicarCobro(commerceId, c);
    // Pudo pagarse entre el cancelar y el UPDATE de arriba: se mira de nuevo.
    await devolverSiAbandonado(commerceId, c.payment_id);
    res.json({ paymentId: c.payment_id, status: c.status, error: c.error });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mercadopago/cobro/:paymentId/devolver
 *
 * Un pago que llegó pero no va a quedar en ninguna venta: el ticket cambió
 * mientras el cliente pagaba, o el cajero se equivocó de importe. Sin esto la
 * única salida era entrar a Mercado Pago a devolverlo a mano.
 */
mercadopagoRouter.post("/cobro/:paymentId/devolver", async (req, res, next) => {
  try {
    const commerceId = req.auth.commerceId;
    const propio = await cobroDelComercio(commerceId, req.params.paymentId);
    if (propio.sale_id) {
      throw new HttpError(409, "Ese pago ya está en una venta: se devuelve reembolsando el ticket.");
    }
    const key = await claveDe(commerceId);
    const c = await devolverCobroMP(key, propio.payment_id, {
      externalReference: `${propio.external_reference}-devolucion`,
    });
    await aplicarCobro(commerceId, c);
    await audit(commerceId, "mercadopago.devolucion", "mp_cobros", Number(propio.id), { paymentId: c.payment_id });
    res.json({ paymentId: c.payment_id, status: c.status, devuelto: c.refunded_cents / 100 });
  } catch (err) {
    next(err);
  }
});

// ── Simulador del checkout de la tienda ──────────────────────────────────────

/**
 * Sólo existe sin CLUBPAY_API_URL y con MERCADOPAGO_SIMULADOR=on. Hace de Mercado Pago: el comprador elige
 * aprobar o rechazar y vuelve a la tienda, para que NexoTienda pueda probar
 * los dos caminos sin plata de verdad.
 */
export const mercadopagoSimuladorRouter = Router();

mercadopagoSimuladorRouter.get("/:paymentId", async (req, res, next) => {
  try {
    if (!simulandoCobros()) throw new HttpError(404, "No existe");
    const vuelta = String(req.query.vuelta ?? "");
    const id = encodeURIComponent(req.params.paymentId);
    const q = (aprobar: 0 | 1) =>
      `?aprobar=${aprobar}` + (vuelta ? `&vuelta=${encodeURIComponent(vuelta)}` : "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Mercado Pago (simulado)</title>
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<h1>Mercado Pago <small style="color:#888">simulado</small></h1>
<p>Cobro <code>${id}</code>. Esto no es Mercado Pago: es el simulador de NexoPOS.</p>
<form method="post" action="${id}/resolver${q(1)}">
<button style="font-size:18px;padding:10px 20px">Pagar</button></form><br>
<form method="post" action="${id}/resolver${q(0)}">
<button style="font-size:18px;padding:10px 20px">Rechazar la tarjeta</button></form></body>`);
  } catch (err) {
    next(err);
  }
});

mercadopagoSimuladorRouter.post("/:paymentId/resolver", async (req, res, next) => {
  try {
    if (!simulandoCobros()) throw new HttpError(404, "No existe");
    const { rows: [c] } = await pool.query(
      "SELECT commerce_id FROM mp_cobros WHERE payment_id = $1", [req.params.paymentId]
    );
    if (!c) throw new HttpError(404, "Cobro no encontrado");
    const aprobar = String(req.query.aprobar) === "1";
    const cobro = mockResolverCheckout(req.params.paymentId, aprobar);
    await aplicarCobro(Number(c.commerce_id), cobro);
    const vuelta = String(req.query.vuelta ?? "");
    if (vuelta) res.redirect(303, vuelta);
    else res.json(cobro);
  } catch (err) {
    next(err);
  }
});

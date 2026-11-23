import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { operador } from "../middleware/auth.js";
import { sesionAbierta } from "./caja.js";
import { descontarCupo } from "./disponibilidad.js";
import { periodoAbierto } from "./cuenta-corriente.js";
import { encolarMovimiento } from "./clubpay-outbox.js";
import { encolarEvento, type EventoPedido } from "./webhooks.js";
import { armarOrder } from "./v1-pedidos.js";
import { devolverCobroMP, cancelarCobroMP } from "../integrations/clubpay-cobros.js";
import { aplicarCobro } from "./mercadopago.js";

/**
 * Los pedidos, desde el mostrador.
 *
 * El modo de falla que hay que evitar no es que el comerciante no se entere:
 * es que se entere, no haga nada en cuarenta minutos, y el que pidió no sepa si
 * va o no va. Nadie se enoja porque tarde una hora si se lo dijeron.
 *
 * Por eso aceptar y declarar para cuándo lo tiene es un solo gesto, y el tiempo
 * lo dice él: la plataforma nunca promete sobre el trabajo de otro.
 */
export const pedidosPosRouter = Router();

const PASOS: Record<string, string[]> = {
  recibido: ["aceptado", "cancelado"],
  aceptado: ["listo", "cancelado"],
  listo: ["en_camino", "entregado", "cancelado"],
  en_camino: ["entregado", "cancelado"],
  entregado: [],
  cancelado: [],
};

/** GET /api/pedidos — los que están en curso, y los últimos cerrados */
pedidosPosRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.code, o.status, o.total, o.slot_label, o.slot_kind, o.address,
              o.payment_method, o.payment_status, o.ready_estimate, o.notes,
              o.contact_name, o.contact_phone, o.created_at, o.cancel_reason,
              o.review_reason, o.verification_level, c.origen AS customer_origen,
              c.name AS customer_name,
              (SELECT json_agg(json_build_object('name', l.name, 'quantity', l.quantity,
                                                 'unitPrice', l.unit_price) ORDER BY l.id)
                 FROM order_lines l WHERE l.order_id = o.id) AS lines
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.commerce_id = $1
        ORDER BY (o.status IN ('recibido','aceptado','listo','en_camino')) DESC, o.created_at DESC
        LIMIT 60`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/*
 * La lógica de cada paso vive en funciones que reciben el comercio, y no en
 * los handlers: la llaman la pantalla de pedidos (`req.auth`) y la API para
 * ERP (`req.erp`). Si se copia, en un tiempo descuentan el stock distinto.
 */

/** Quién da el paso. Cambia la auditoría y lo que pasa al repetirlo, nada más. */
export interface Quien {
  via: "panel" | "erp";
  /** Quién operó si no fue el comercio (modo soporte). NULL es el comercio. */
  operadoPor: string | null;
  /**
   * Repetir un paso ya dado contesta bien en vez de 409. Lo pide el ERP, que
   * reintenta cuando se le corta la red y necesita saber si el primer intento
   * llegó. La pantalla no: ahí un 409 es «otro ya lo movió», y conviene que
   * el comerciante lo vea.
   */
  idempotente?: boolean;
  /** La clave de ERP que lo pidió, para poder revocarla sabiendo qué hizo. */
  keyId?: number;
}

/** `cambio: false` es que el pedido ya estaba ahí y no se tocó nada. */
export interface Resultado { cambio: boolean; status: string }

type Cliente = PoolClient;

/**
 * Lee el pedido bloqueado, dentro de la transacción, y decide si el paso
 * corresponde. Leerlo afuera dejaba que dos «aceptar» a la vez —un doble
 * clic, o el ERP reintentando— descontaran el stock dos veces.
 */
async function bloquear(
  client: Cliente, commerceId: number, id: number, paso: string, quien: Quien,
  mensaje: (status: string) => string
): Promise<{ pedido: Record<string, any>; yaEstaba: boolean }> {
  const { rows } = await client.query(
    "SELECT * FROM orders WHERE id = $1 AND commerce_id = $2 FOR UPDATE",
    [id, commerceId]
  );
  const pedido = rows[0];
  if (!pedido) throw new HttpError(404, "No existe ese pedido");
  if (quien.idempotente && pedido.status === paso) return { pedido, yaEstaba: true };
  if (!PASOS[pedido.status].includes(paso)) {
    // El estado va aparte del texto: el ERP decide con él, no leyendo la frase.
    throw new HttpError(409, mensaje(pedido.status), "paso_invalido", { status: pedido.status });
  }
  return { pedido, yaEstaba: false };
}

/**
 * Aceptar.
 *
 * Acá el comercio se compromete, y por eso acá se descuenta el stock: antes no
 * se movió nada, porque un pedido que le llegó y todavía no miró no puede
 * dejarle el inventario en un número que no refleja lo que hay en la góndola.
 */
export async function aceptarPedido(
  commerceId: number, id: number, readyEstimate: string, quien: Quien
): Promise<Resultado> {
  if (!readyEstimate) {
    throw new HttpError(400, "Decile para cuándo lo tenés: es lo que el cliente está esperando saber.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { pedido, yaEstaba } = await bloquear(client, commerceId, id, "aceptado", quien,
      (s) => `Este pedido ya está ${s}.`);
    if (yaEstaba) {
      await client.query("ROLLBACK");
      return { cambio: false, status: "aceptado" };
    }

    const { rows: lineas } = await client.query(
      "SELECT product_id, quantity FROM order_lines WHERE order_id = $1", [id]
    );
    for (const l of lineas) {
      const { rows } = await client.query(
        "SELECT availability_policy FROM stock_items WHERE commerce_id = $1 AND product_id = $2 FOR UPDATE",
        [commerceId, l.product_id]
      );
      // Como en el mostrador: no se frena por falta de stock. El conteo puede
      // estar atrasado y el que sabe si están es el que va a buscarlos.
      if (rows[0]?.availability_policy === "declared") {
        await descontarCupo(client, commerceId, Number(l.product_id), Number(l.quantity));
      } else {
        await client.query(
          "UPDATE stock_items SET quantity = quantity - $3, updated_at = now() WHERE commerce_id = $1 AND product_id = $2",
          [commerceId, l.product_id, l.quantity]
        );
      }
      // El movimiento queda donde se movió la mercadería —al aceptar— y no al
      // entregar: si no, el inventario cambia sin que nada lo explique.
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'sale', $3, $4)`,
        [commerceId, l.product_id, -Number(l.quantity), `PEDIDO-${pedido.code}`]
      );
    }
    await client.query(
      "UPDATE orders SET status = 'aceptado', ready_estimate = $2, updated_at = now() WHERE id = $1",
      [id, readyEstimate]
    );
    await encolarEvento(client, commerceId, id, "order.aceptado", await armarOrder(id, client));
    await client.query("COMMIT");
    await audit(commerceId, "pedido.aceptado", "orders", id, { readyEstimate, via: quien.via, keyId: quien.keyId });
    return { cambio: true, status: "aceptado" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Listo, en camino o entregado: pasos que no mueven stock. */
export async function avanzarPedido(
  commerceId: number, id: number, paso: "listo" | "en_camino" | "entregado", quien: Quien
): Promise<Resultado> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { pedido, yaEstaba } = await bloquear(client, commerceId, id, paso, quien,
      (s) => `Un pedido ${s} no puede pasar a ${paso}.`);
    if (yaEstaba) {
      await client.query("ROLLBACK");
      return { cambio: false, status: paso };
    }
    if (paso === "en_camino" && pedido.slot_kind !== "reparto") {
      throw new HttpError(409, "Este pedido es para retirar, no sale a la calle.",
        "es_retiro", { status: pedido.status });
    }

    await client.query("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1", [id, paso]);

    /*
     * Entregado es donde el pedido se convierte en venta: ahí entró la plata.
     * Antes no, porque un pedido aceptado todavía puede cancelarse y una nota
     * de venta que se borra no es una nota de venta.
     */
    if (paso === "entregado") await emitirNotaDeVenta(client, commerceId, pedido, quien.operadoPor);

    await encolarEvento(client, commerceId, id, `order.${paso}` as EventoPedido,
      await armarOrder(id, client));
    await client.query("COMMIT");
    await audit(commerceId, `pedido.${paso}`, "orders", id, { via: quien.via, keyId: quien.keyId });
    return { cambio: true, status: paso };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export const cancelarSchema = z.object({
  motivo: z.string().trim().min(1).max(400),
});

/**
 * Cancelar.
 *
 * El motivo es texto libre del comerciante, no un código nuestro. "No me quedan
 * de ananá, tengo de muzzarella y napolitana; pasá igual y te las hago"
 * mantiene la venta y la relación. "Pedido cancelado: sin stock" las corta las
 * dos, y la plataforma no arbitra: acerca a las dos personas.
 */
export async function cancelarPedido(
  commerceId: number, id: number, motivo: string, quien: Quien
): Promise<Resultado> {
  const client = await pool.connect();
  let devolucion: Awaited<ReturnType<typeof devolverCobroMP>> | null = null;
  let clubpayKey = "";
  try {
    await client.query("BEGIN");
    const { pedido, yaEstaba } = await bloquear(client, commerceId, id, "cancelado", quien,
      (s) => `Este pedido ya está ${s}.`);
    if (yaEstaba) {
      await client.query("ROLLBACK");
      return { cambio: false, status: "cancelado" };
    }

    // Si ya se había aceptado, el stock estaba descontado y vuelve
    if (["aceptado", "listo", "en_camino"].includes(pedido.status)) {
      const { rows: lineas } = await client.query(
        "SELECT product_id, quantity FROM order_lines WHERE order_id = $1", [id]
      );
      for (const l of lineas) {
        await client.query(
          `UPDATE stock_items SET quantity = quantity + $3, updated_at = now()
            WHERE commerce_id = $1 AND product_id = $2 AND availability_policy = 'stock'`,
          [commerceId, l.product_id, l.quantity]
        );
      }
    }
    /*
     * Pagado con Mercado Pago: la plata vuelve sola al comprador. Antes del
     * COMMIT, para que si ClubPay no puede devolver el pedido no quede
     * cancelado con la plata del otro lado. La referencia es por pedido: un
     * reintento no devuelve dos veces.
     */
    const { rows: [pago] } = await client.query(
      `SELECT o.code, o.payment_status, o.payment_id, c.clubpay_api_key
         FROM orders o JOIN commerces c ON c.id = o.commerce_id WHERE o.id = $1`,
      [id]
    );
    clubpayKey = pago.clubpay_api_key ?? "";
    // Sólo se devuelve un cobro que pasó por ClubPay. Un `payment_id` que no
    // está en mp_cobros no es plata que podamos devolver: los pedidos que el
    // sandbox de NexoTienda marcó pagados en septiembre (pay_sbx_…) dejaban
    // al comercio sin poder cancelarlos.
    const { rows: [cobroDelPedido] } = pago.payment_id
      ? await client.query(
          "SELECT 1 FROM mp_cobros WHERE payment_id = $1 AND order_id = $2", [pago.payment_id, id])
      : { rows: [] };
    if (pago.payment_status === "pagado" && cobroDelPedido) {
      devolucion = await devolverCobroMP(clubpayKey, pago.payment_id, {
        externalReference: `nexopos-${commerceId}-pedido-${pago.code}-cancelado`,
      });
    }
    await client.query(
      `UPDATE orders SET status = 'cancelado', cancel_reason = $2,
              cancelled_by = 'comercio', updated_at = now(),
              payment_status = CASE WHEN $3::boolean THEN 'reembolsado' ELSE payment_status END
        WHERE id = $1`,
      [id, motivo, devolucion !== null && devolucion.refunded_cents >= devolucion.amount_cents]
    );
    await encolarEvento(client, commerceId, id, "order.cancelado", await armarOrder(id, client));
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await audit(commerceId, "pedido.cancelado", "orders", id, { motivo, via: quien.via, keyId: quien.keyId });
  if (devolucion) await aplicarCobro(commerceId, devolucion).catch((e) => console.error("[mercadopago]", e));
  // Los links que sigan vivos se dan de baja. Si alguno se paga igual,
  // aplicarCobro ve el pedido cancelado y lo devuelve.
  const { rows: vivos } = await pool.query(
    "SELECT payment_id FROM mp_cobros WHERE order_id = $1 AND status IN ('pending','rejected')", [id]
  );
  for (const v of vivos) {
    await cancelarCobroMP(clubpayKey, v.payment_id)
      .then((c) => aplicarCobro(commerceId, c))
      .catch((e) => console.error("[mercadopago] no se pudo dar de baja el link:", e instanceof Error ? e.message : e));
  }
  return { cambio: true, status: "cancelado" };
}

// ── La pantalla de pedidos ──────────────────────────────────────────────────

const delPanel = (req: { auth: Parameters<typeof operador>[0] }): Quien =>
  ({ via: "panel", operadoPor: operador(req.auth) });

/**
 * POST /api/pedidos/:id/aceptar
 *
 * Aceptar y declarar para cuándo lo tiene es un solo gesto (ver arriba).
 */
pedidosPosRouter.post("/:id/aceptar", async (req, res, next) => {
  try {
    const readyEstimate = String(req.body?.readyEstimate ?? "").trim();
    await aceptarPedido(req.auth.commerceId, Number(req.params.id), readyEstimate, delPanel(req));
    res.json({ ok: true, status: "aceptado", readyEstimate });
  } catch (err) {
    next(err);
  }
});

/*
 * Una ruta por paso, en vez de una genérica `/:id/:paso`.
 *
 * La genérica se comía `/:id/cancelar`: Express la matcheaba primero con
 * paso="cancelar", contestaba "paso desconocido" y la cancelación no corría
 * —dejando el stock descontado de un pedido que nadie iba a entregar—. Rutas
 * explícitas no se pisan entre ellas.
 */
function avanzar(paso: "listo" | "en_camino" | "entregado") {
  return async (req: Parameters<Parameters<typeof pedidosPosRouter.post>[1]>[0],
                res: Parameters<Parameters<typeof pedidosPosRouter.post>[1]>[1],
                next: Parameters<Parameters<typeof pedidosPosRouter.post>[1]>[2]) => {
    try {
      await avanzarPedido(req.auth.commerceId, Number(req.params.id), paso, delPanel(req));
      res.json({ ok: true, status: paso });
    } catch (err) {
      next(err);
    }
  };
}

pedidosPosRouter.post("/:id/listo", avanzar("listo"));
pedidosPosRouter.post("/:id/en-camino", avanzar("en_camino"));
pedidosPosRouter.post("/:id/entregado", avanzar("entregado"));

/** POST /api/pedidos/:id/cancelar */
pedidosPosRouter.post("/:id/cancelar", async (req, res, next) => {
  try {
    const { motivo } = cancelarSchema.parse(req.body);
    await cancelarPedido(req.auth.commerceId, Number(req.params.id), motivo, delPanel(req));
    res.json({ ok: true, status: "cancelado" });
  } catch (err) {
    next(err);
  }
});

/**
 * El pedido entregado aterriza como nota de venta: mismo stock, misma caja,
 * misma cuenta corriente que una venta del mostrador. Es lo correcto —el
 * comercio no lleva dos contabilidades— y es lo que hace que el arqueo cierre.
 *
 * El stock no se vuelve a tocar: ya se descontó al aceptar.
 */
async function emitirNotaDeVenta(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  commerceId: number,
  pedido: Record<string, unknown>,
  operadoPor: string | null
): Promise<void> {
  const METODO: Record<string, string> = {
    efectivo_entrega: "cash", online: "mercadopago", cuenta_corriente: "account",
  };
  const metodo = METODO[String(pedido.payment_method)] ?? "cash";
  const total = Number(pedido.total);

  /*
   * La sesión de caja, si hay una abierta. Si no la hay —un reparto que se
   * entrega a las diez de la noche, con el local cerrado— la venta queda sin
   * sesión: el arqueo dice qué hay en el cajón, y eso no entró al cajón de
   * ningún turno. Se ve igual en los reportes del día.
   */
  const sesion = await sesionAbierta(commerceId, client as never);

  const { rows: [{ next_number }] } = await client.query(
    "SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next_number FROM sales WHERE commerce_id = $1",
    [commerceId]
  );
  const { rows: [venta] } = await client.query(
    `INSERT INTO sales (commerce_id, ticket_number, customer_id, payment_method,
                        subtotal, discount, total, cash_session_id, order_id, operado_por)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9) RETURNING id, ticket_number`,
    [commerceId, next_number, pedido.customer_id ?? null, metodo,
     Number(pedido.subtotal), total, sesion?.id ?? null, pedido.id, operadoPor]
  );

  const { rows: lineas } = await client.query(
    "SELECT product_id, quantity, unit_price FROM order_lines WHERE order_id = $1",
    [pedido.id]
  );
  for (const l of lineas) {
    await client.query(
      "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,$4)",
      [venta.id, l.product_id, l.quantity, l.unit_price]
    );
  }
  await client.query(
    "INSERT INTO sale_payments (commerce_id, sale_id, method, amount) VALUES ($1,$2,$3,$4)",
    [commerceId, venta.id, metodo, total]
  );
  // El cobro de Mercado Pago del pedido pasa a ser el de esta nota. Sin esto,
  // reembolsar la nota devolvía la mercadería y dejaba la plata en Mercado
  // Pago: el reembolso busca el cobro por la venta, no por el pedido.
  if (metodo === "mercadopago") {
    await client.query(
      `UPDATE mp_cobros SET sale_id = $2, updated_at = now()
        WHERE order_id = $1 AND status = 'paid' AND sale_id IS NULL`,
      [pedido.id, venta.id]
    );
  }

  // Si fue a la libreta, el movimiento sale de esta nota como de cualquier
  // otra venta fiada, y cae en el período abierto del cliente.
  //
  // Se mira la forma de pago y no sólo que haya cliente: con CR-0003 un pedido
  // pagado en efectivo también trae quién lo hizo, y anotarle la deuda sería
  // cobrarle dos veces.
  if (pedido.payment_method === "cuenta_corriente" && pedido.customer_id) {
    const customerId = Number(pedido.customer_id);
    const periodo = await periodoAbierto(client as never, commerceId, customerId);
    const { rows: [mov] } = await client.query(
      `INSERT INTO customer_transactions (commerce_id, customer_id, type, amount, sale_id, note, period_id)
       VALUES ($1,$2,'sale_credit',$3,$4,$5,$6) RETURNING id`,
      [commerceId, customerId, total, venta.id, `Pedido ${pedido.code}`, periodo.id]
    );
    await client.query("UPDATE customers SET balance = balance + $1 WHERE id = $2", [total, customerId]);
    await encolarMovimiento(client as never, {
      commerceId, customerId, transactionId: Number(mov.id),
      kind: "compra", amount: total, description: `Pedido ${pedido.code}`,
    });
  }

  await client.query("UPDATE orders SET sale_id = $2 WHERE id = $1", [pedido.id, venta.id]);
}

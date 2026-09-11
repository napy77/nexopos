import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { requiereClave } from "../middleware/api-key.js";
import { disponibilidadDe } from "./disponibilidad.js";

/**
 * Los pedidos de la tienda online.
 *
 * Router aparte del catálogo a propósito: el guard va por clave y mezclarlos en
 * un router con `use` haría que un pedido pida la clave de catálogo.
 *
 * **Un pedido no es una venta.** Nace cuando alguien cierra el carrito y se
 * convierte en nota de venta recién cuando se entrega. Los tres momentos son
 * distintos y confundirlos rompe cosas distintas:
 *
 *   recibido   no se movió nada. Que le llegue al comercio no es que lo aceptó.
 *   aceptado   el comercio se comprometió: ahí se descuenta el stock.
 *   entregado  entró la plata: ahí sale la nota de venta y el fiado.
 */
export const pedidosRouter = Router();
const pedidos = requiereClave("pedidos");

/**
 * El código que ve el comprador. Va en la URL de seguimiento y se comparte por
 * WhatsApp, así que no es correlativo: con un número secuencial cualquiera mira
 * los pedidos del vecino cambiando un dígito.
 */
const nuevoCodigo = (): string =>
  `P-${randomBytes(4).toString("hex").toUpperCase()}`;

const centavos = (pesos: unknown): number => Math.round(Number(pesos ?? 0) * 100);

const nuevoPedidoSchema = z.object({
  storeId: z.string(),
  lines: z.array(z.object({
    productId: z.string(),
    quantity: z.coerce.number().positive(),
  })).min(1),
  slotId: z.string(),
  address: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(["efectivo_entrega", "online", "cuenta_corriente"]),
  notes: z.string().trim().max(500).optional(),
  /** Compra a la libreta. Esa cuenta se abrió en el mostrador, nunca acá. */
  accountId: z.string().optional(),
  /** Compra anónima: es la mayoría de las ventas */
  contact: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(4).max(40),
  }).optional(),
});

async function armarOrder(orderId: number) {
  const { rows } = await pool.query(
    `SELECT o.*, c.name AS store_name, c.slug AS store_slug, c.phone AS store_phone
       FROM orders o JOIN commerces c ON c.id = o.commerce_id WHERE o.id = $1`,
    [orderId]
  );
  const o = rows[0];
  const { rows: lineas } = await pool.query(
    "SELECT product_id, name, unit, quantity, unit_price FROM order_lines WHERE order_id = $1 ORDER BY id",
    [orderId]
  );
  return {
    code: o.code,
    storeId: String(o.commerce_id),
    storeName: o.store_name,
    storeSlug: o.store_slug,
    storePhone: o.store_phone ?? undefined,
    lines: lineas.map((l) => ({
      productId: String(l.product_id),
      name: l.name,
      unit: l.unit,
      quantity: Number(l.quantity),
      unitPriceCents: centavos(l.unit_price),
    })),
    subtotalCents: centavos(o.subtotal),
    feeCents: centavos(o.fee),
    totalCents: centavos(o.total),
    slotId: o.slot_id ? String(o.slot_id) : "",
    slotLabel: o.slot_label,
    slotKind: o.slot_kind,
    address: o.address ?? undefined,
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    paymentId: o.payment_id ?? undefined,
    status: o.status,
    createdAt: new Date(o.created_at).toISOString(),
    readyEstimate: o.ready_estimate ?? undefined,
    cancelReason: o.cancel_reason ?? undefined,
    cancelledBy: o.cancelled_by ?? undefined,
  };
}

/**
 * POST /v1/orders
 *
 * Los totales salen de acá y no de lo que mandó la tienda: el precio y el stock
 * del momento los tenemos nosotros, y los del carrito son de cuando el
 * comprador lo armó. Los suyos son para mostrar.
 */
pedidosRouter.post("/orders", pedidos, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = nuevoPedidoSchema.parse(req.body);
    const commerceId = Number(body.storeId);

    if (body.accountId && body.contact) {
      throw new HttpError(400, "Un pedido va con cuenta corriente o con contacto, no con los dos.");
    }
    if (!body.accountId && !body.contact) {
      throw new HttpError(400, "Falta el nombre y el teléfono de quien compra.");
    }

    const { rows: comercios } = await client.query(
      `SELECT id, nexotienda_enabled, pay_on_delivery_enabled, transfer_enabled,
              clubpay_pay_enabled, online_credit_enabled
         FROM commerces WHERE id = $1`,
      [commerceId]
    );
    const comercio = comercios[0];
    if (!comercio) throw new HttpError(404, "No existe ese comercio");
    if (!comercio.nexotienda_enabled) {
      throw new HttpError(409, "Este comercio no tiene la tienda publicada.");
    }

    // Que no entre un pedido por una puerta que el comerciante cerró
    if (body.paymentMethod === "efectivo_entrega" && !comercio.pay_on_delivery_enabled) {
      throw new HttpError(409, "Este comercio no acepta pago contra entrega.");
    }
    if (body.paymentMethod === "cuenta_corriente" && !comercio.online_credit_enabled) {
      throw new HttpError(409, "Este comercio toma la cuenta corriente solo en el mostrador.");
    }

    // La franja tiene que ser suya, y el reparto necesita dirección
    const { rows: slots } = await client.query(
      "SELECT id, label, kind, fee FROM commerce_slots WHERE id = $1 AND commerce_id = $2",
      [Number(body.slotId), commerceId]
    );
    const slot = slots[0];
    if (!slot) throw new HttpError(400, "Esa franja no es de este comercio.");
    if (slot.kind === "reparto" && !body.address) {
      throw new HttpError(400, "Para el reparto hace falta la dirección.");
    }

    // La cuenta corriente se abre en el mostrador: acá solo se usa una que ya
    // existe, que no esté pausada y que tenga disponible.
    let customerId: number | null = null;
    if (body.accountId) {
      const { rows: cuentas } = await client.query(
        `SELECT id, balance, credit_limit, credit_paused FROM customers
          WHERE id = $1 AND commerce_id = $2`,
        [Number(body.accountId.replace(/^CLI-/, "")), commerceId]
      );
      const cuenta = cuentas[0];
      if (!cuenta) throw new HttpError(404, "Esa cuenta corriente no existe en este comercio.");
      if (cuenta.credit_paused) {
        throw new HttpError(409, "La cuenta corriente está pausada. Se puede pagar de otra forma.");
      }
      customerId = Number(cuenta.id);
    }

    await client.query("BEGIN");

    // Precio y nombre del momento, congelados en la línea: si el comercio
    // cambia el precio mientras el pedido está en curso, se cobra el que el
    // comprador vio.
    let subtotal = 0;
    const lineas: { productId: number; name: string; unit: string; qty: number; price: number }[] = [];
    for (const l of body.lines) {
      const { rows } = await client.query(
        `SELECT p.id, p.name, p.unit, s.sale_price, s.quantity, s.availability_policy,
                s.declared_state, s.quota_total, s.quota_remaining, s.quota_day,
                s.es_insumo, s.published_in_store
           FROM stock_items s JOIN products p ON p.id = s.product_id
          WHERE s.commerce_id = $1 AND s.product_id = $2`,
        [commerceId, Number(l.productId)]
      );
      const p = rows[0];
      if (!p || p.es_insumo || !p.published_in_store) {
        throw new HttpError(400, `Uno de los productos ya no está a la venta.`);
      }
      const disp = disponibilidadDe(p);
      if (disp.policy === "declared" && disp.state === "out") {
        throw new HttpError(409, `${p.name} se acaba de agotar.`);
      }
      const precio = Number(p.sale_price);
      if (!precio) throw new HttpError(400, `${p.name} no tiene precio de venta.`);
      subtotal += precio * l.quantity;
      lineas.push({ productId: Number(p.id), name: p.name, unit: p.unit, qty: l.quantity, price: precio });
    }

    const fee = slot.kind === "reparto" ? Number(slot.fee) : 0;
    const total = Math.round((subtotal + fee) * 100) / 100;

    // El cobro online todavía no está: un pedido que dice "pendiente" sin
    // forma de cobrarlo sería una promesa vacía.
    const paymentStatus = body.paymentMethod === "online" ? "pendiente" : "no_aplica";

    const { rows: [orden] } = await client.query(
      `INSERT INTO orders (commerce_id, code, customer_id, contact_name, contact_phone,
                           slot_id, slot_label, slot_kind, address, notes,
                           payment_method, payment_status, subtotal, fee, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [commerceId, nuevoCodigo(), customerId,
       body.contact?.name ?? null, body.contact?.phone ?? null,
       slot.id, slot.label, slot.kind, body.address ?? null, body.notes ?? null,
       body.paymentMethod, paymentStatus, subtotal, fee, total]
    );
    for (const l of lineas) {
      await client.query(
        `INSERT INTO order_lines (order_id, product_id, name, unit, quantity, unit_price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [orden.id, l.productId, l.name, l.unit, l.qty, l.price]
      );
    }
    await client.query("COMMIT");

    await audit(commerceId, "pedido.recibido", "orders", orden.id, { total });
    res.status(201).json(await armarOrder(Number(orden.id)));
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/**
 * GET /v1/orders/:code
 *
 * Sin sesión: el comprador anónimo tiene el link y nada más. Por eso el código
 * es aleatorio y no correlativo.
 */
pedidosRouter.get("/orders/:code", pedidos, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id FROM orders WHERE code = $1", [
      String(req.params.code).toUpperCase(),
    ]);
    if (!rows[0]) throw new HttpError(404, "No existe ese pedido");
    res.json(await armarOrder(Number(rows[0].id)));
  } catch (err) {
    next(err);
  }
});

/** POST /v1/orders/:code/payment — el cobro se acreditó */
pedidosRouter.post("/orders/:code/payment", pedidos, async (req, res, next) => {
  try {
    const paymentId = String(req.body?.paymentId ?? "").trim();
    if (!paymentId) throw new HttpError(400, "Falta el paymentId");
    const { rows } = await pool.query(
      `UPDATE orders SET payment_status = 'pagado', payment_id = $2, updated_at = now()
        WHERE code = $1 AND payment_status <> 'pagado' RETURNING id`,
      [String(req.params.code).toUpperCase(), paymentId]
    );
    if (!rows[0]) {
      // Ya estaba pagado: se contesta el pedido igual, no un error. El
      // proveedor de cobro reintenta y no tiene la culpa.
      const { rows: existentes } = await pool.query("SELECT id FROM orders WHERE code = $1",
        [String(req.params.code).toUpperCase()]);
      if (!existentes[0]) throw new HttpError(404, "No existe ese pedido");
      res.json(await armarOrder(Number(existentes[0].id)));
      return;
    }
    res.json(await armarOrder(Number(rows[0].id)));
  } catch (err) {
    next(err);
  }
});

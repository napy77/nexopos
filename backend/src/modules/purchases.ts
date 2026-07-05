import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { pushOrder } from "../integrations/nexob2b.js";

export const purchasesRouter = Router();

const createOrderSchema = z.object({
  wholesalerId: z.string(),
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        quantity: z.number().positive(),
      })
    )
    .min(1),
});

/**
 * POST /api/purchases
 * Crea y confirma una orden de compra al mayorista con los precios vigentes
 * de sus ofertas, y la sincroniza a NexoB2B.
 */
purchasesRouter.post("/", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { wholesalerId, items } = createOrderSchema.parse(req.body);
    const commerceId = req.auth.commerceId;

    await client.query("BEGIN");

    // Validar que cada item tenga oferta vigente de ese mayorista y respetar mínimos
    const lines: { productId: number; quantity: number; unitPrice: number; nexoId: string | null }[] = [];
    let wholesalerName = "";
    for (const item of items) {
      const { rows } = await client.query(
        `SELECT o.price, o.min_qty, o.wholesaler_name, p.nexob2b_id
         FROM wholesaler_offers o JOIN products p ON p.id = o.product_id
         WHERE o.product_id = $1 AND o.wholesaler_id = $2`,
        [item.productId, wholesalerId]
      );
      if (!rows[0]) throw new HttpError(400, `El producto ${item.productId} no tiene oferta de este mayorista`);
      if (item.quantity < Number(rows[0].min_qty))
        throw new HttpError(400, `El producto ${item.productId} requiere mínimo ${rows[0].min_qty} unidades`);
      wholesalerName = rows[0].wholesaler_name;
      lines.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: Number(rows[0].price),
        nexoId: rows[0].nexob2b_id,
      });
    }
    const total = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);

    const {
      rows: [order],
    } = await client.query(
      `INSERT INTO purchase_orders (commerce_id, wholesaler_id, wholesaler_name, status, total, confirmed_at)
       VALUES ($1, $2, $3, 'confirmed', $4, now()) RETURNING id`,
      [commerceId, wholesalerId, wholesalerName, total]
    );
    for (const l of lines) {
      await client.query(
        `INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, l.productId, l.quantity, l.unitPrice]
      );
    }

    // Sincronizar a NexoB2B
    const { rows: commerceRows } = await client.query(
      "SELECT nexob2b_id FROM commerces WHERE id = $1",
      [commerceId]
    );
    const nexoOrderId = await pushOrder({
      commerceNexoId: commerceRows[0]?.nexob2b_id ?? null,
      wholesalerId,
      items: lines.map((l) => ({ productNexoId: l.nexoId, quantity: l.quantity, unitPrice: l.unitPrice })),
    });
    await client.query("UPDATE purchase_orders SET nexob2b_order_id = $1 WHERE id = $2", [
      nexoOrderId,
      order.id,
    ]);

    await client.query("COMMIT");
    await audit(commerceId, "po.confirm", "purchase_orders", order.id, { total, wholesalerId });
    res.status(201).json({ id: order.id, total, nexob2bOrderId: nexoOrderId });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/** GET /api/purchases — historial de compras del comercio */
purchasesRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, wholesaler_id, wholesaler_name, status, total, currency,
              nexob2b_order_id, created_at, confirmed_at, received_at
       FROM purchase_orders WHERE commerce_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** GET /api/purchases/:id — detalle con items */
purchasesRouter.get("/:id", async (req, res, next) => {
  try {
    const { rows: orders } = await pool.query(
      "SELECT * FROM purchase_orders WHERE id = $1 AND commerce_id = $2",
      [Number(req.params.id), req.auth.commerceId]
    );
    if (!orders[0]) throw new HttpError(404, "Orden no encontrada");
    const { rows: items } = await pool.query(
      `SELECT i.product_id, i.quantity, i.unit_price, p.name, p.ean
       FROM purchase_order_items i JOIN products p ON p.id = i.product_id
       WHERE i.order_id = $1`,
      [orders[0].id]
    );
    res.json({ ...orders[0], items });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchases/:id/receive
 * Marca la orden como recibida e ingresa la mercadería al stock local,
 * actualizando costos y registrando movimientos auditable.
 */
purchasesRouter.post("/:id/receive", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const { rows: orders } = await client.query(
      `SELECT id, status FROM purchase_orders
       WHERE id = $1 AND commerce_id = $2 FOR UPDATE`,
      [Number(req.params.id), commerceId]
    );
    if (!orders[0]) throw new HttpError(404, "Orden no encontrada");
    if (orders[0].status !== "confirmed")
      throw new HttpError(400, `La orden está en estado '${orders[0].status}', no se puede recibir`);

    const { rows: items } = await client.query(
      "SELECT product_id, quantity, unit_price FROM purchase_order_items WHERE order_id = $1",
      [orders[0].id]
    );
    for (const item of items) {
      await client.query(
        `INSERT INTO stock_items (commerce_id, product_id, quantity, cost, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (commerce_id, product_id) DO UPDATE SET
           quantity = stock_items.quantity + EXCLUDED.quantity,
           cost = EXCLUDED.cost, updated_at = now()`,
        [commerceId, item.product_id, item.quantity, item.unit_price]
      );
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'purchase_reception', $3, $4)`,
        [commerceId, item.product_id, item.quantity, `PO-${orders[0].id}`]
      );
    }
    await client.query(
      "UPDATE purchase_orders SET status = 'received', received_at = now() WHERE id = $1",
      [orders[0].id]
    );
    await client.query("COMMIT");
    await audit(commerceId, "po.receive", "purchase_orders", orders[0].id);
    res.json({ ok: true, itemsReceived: items.length });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

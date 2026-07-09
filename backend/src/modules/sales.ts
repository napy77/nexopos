import { Router } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";

export const salesRouter = Router();

// coerce: acepta números que lleguen como string (ids que el cliente
// obtuvo de respuestas JSON, inputs de formularios)
const createSaleSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int(),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().positive().optional(), // si no viene, usa sale_price del stock
      })
    )
    .min(1),
  paymentMethod: z.enum(["cash", "wallet", "card", "transfer", "account"]),
  customerId: z.coerce.number().int().optional(),
  discount: z.coerce.number().nonnegative().default(0),
});

/**
 * POST /api/sales
 * Emite un ticket de venta: valida y descuenta stock, numera el ticket de
 * forma secuencial por comercio y, si el pago es a cuenta corriente,
 * registra la deuda del cliente.
 */
salesRouter.post("/", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = createSaleSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    if (body.paymentMethod === "account" && !body.customerId)
      throw new HttpError(400, "La venta a cuenta corriente requiere un cliente");

    await client.query("BEGIN");

    // Resolver precios y descontar stock (con lock por fila)
    const lines: { productId: number; quantity: number; unitPrice: number }[] = [];
    for (const item of body.items) {
      const { rows } = await client.query(
        `SELECT quantity, sale_price FROM stock_items
         WHERE commerce_id = $1 AND product_id = $2 FOR UPDATE`,
        [commerceId, item.productId]
      );
      if (!rows[0]) throw new HttpError(400, `El producto ${item.productId} no está en el stock local`);
      if (Number(rows[0].quantity) < item.quantity)
        throw new HttpError(400, `Stock insuficiente para el producto ${item.productId} (disponible: ${rows[0].quantity})`);
      const unitPrice = item.unitPrice ?? Number(rows[0].sale_price);
      if (!unitPrice) throw new HttpError(400, `El producto ${item.productId} no tiene precio de venta definido`);
      lines.push({ productId: item.productId, quantity: item.quantity, unitPrice });

      await client.query(
        `UPDATE stock_items SET quantity = quantity - $3, updated_at = now()
         WHERE commerce_id = $1 AND product_id = $2`,
        [commerceId, item.productId, item.quantity]
      );
    }

    const subtotal = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
    const total = Math.max(0, subtotal - body.discount);

    // Numeración secuencial por comercio
    const {
      rows: [{ next_number }],
    } = await client.query(
      `SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next_number
       FROM sales WHERE commerce_id = $1`,
      [commerceId]
    );

    const {
      rows: [sale],
    } = await client.query(
      `INSERT INTO sales (commerce_id, ticket_number, customer_id, payment_method, subtotal, discount, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, ticket_number, created_at`,
      [commerceId, next_number, body.customerId ?? null, body.paymentMethod, subtotal, body.discount, total]
    );
    for (const l of lines) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)`,
        [sale.id, l.productId, l.quantity, l.unitPrice]
      );
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'sale', $3, $4)`,
        [commerceId, l.productId, -l.quantity, `TICKET-${sale.ticket_number}`]
      );
    }

    // Cuenta corriente
    if (body.paymentMethod === "account" && body.customerId) {
      const { rows: custRows } = await client.query(
        "SELECT id FROM customers WHERE id = $1 AND commerce_id = $2 FOR UPDATE",
        [body.customerId, commerceId]
      );
      if (!custRows[0]) throw new HttpError(404, "Cliente no encontrado");
      await client.query(
        `INSERT INTO customer_transactions (commerce_id, customer_id, type, amount, sale_id, note)
         VALUES ($1, $2, 'sale_credit', $3, $4, $5)`,
        [commerceId, body.customerId, total, sale.id, `Ticket #${sale.ticket_number}`]
      );
      await client.query("UPDATE customers SET balance = balance + $1 WHERE id = $2", [
        total,
        body.customerId,
      ]);
    }

    await client.query("COMMIT");
    await audit(commerceId, "sale.create", "sales", sale.id, { total, paymentMethod: body.paymentMethod });
    res.status(201).json({ id: sale.id, ticketNumber: Number(sale.ticket_number), subtotal, total });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/sales/:id/refund
 * Reembolso total: crea una venta espejo con cantidades negativas,
 * devuelve la mercadería al stock y, si fue a cuenta corriente,
 * descuenta la deuda del cliente.
 */
salesRouter.post("/:id/refund", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const { rows: originals } = await client.query(
      "SELECT * FROM sales WHERE id = $1 AND commerce_id = $2 FOR UPDATE",
      [Number(req.params.id), commerceId]
    );
    const original = originals[0];
    if (!original) throw new HttpError(404, "Ticket no encontrado");
    if (original.refund_of) throw new HttpError(400, "Ese ticket ya es un reembolso");
    const { rows: existing } = await client.query(
      "SELECT id FROM sales WHERE refund_of = $1",
      [original.id]
    );
    if (existing[0]) throw new HttpError(400, "Ese ticket ya fue reembolsado");

    const { rows: items } = await client.query(
      "SELECT product_id, quantity, unit_price FROM sale_items WHERE sale_id = $1",
      [original.id]
    );

    const {
      rows: [{ next_number }],
    } = await client.query(
      "SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next_number FROM sales WHERE commerce_id = $1",
      [commerceId]
    );
    const {
      rows: [refund],
    } = await client.query(
      `INSERT INTO sales (commerce_id, ticket_number, customer_id, payment_method,
                          subtotal, discount, total, refund_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, ticket_number`,
      [
        commerceId, next_number, original.customer_id, original.payment_method,
        -original.subtotal, -original.discount, -original.total, original.id,
      ]
    );
    for (const item of items) {
      await client.query(
        "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)",
        [refund.id, item.product_id, -item.quantity, item.unit_price]
      );
      // La mercadería vuelve al stock
      await client.query(
        `UPDATE stock_items SET quantity = quantity + $3, updated_at = now()
         WHERE commerce_id = $1 AND product_id = $2`,
        [commerceId, item.product_id, item.quantity]
      );
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'return', $3, $4)`,
        [commerceId, item.product_id, item.quantity, `REEMBOLSO-${refund.ticket_number}`]
      );
    }
    if (original.payment_method === "account" && original.customer_id) {
      await client.query(
        `INSERT INTO customer_transactions (commerce_id, customer_id, type, amount, sale_id, note)
         VALUES ($1, $2, 'adjustment', $3, $4, $5)`,
        [commerceId, original.customer_id, -original.total, refund.id, `Reembolso ticket #${original.ticket_number}`]
      );
      await client.query("UPDATE customers SET balance = balance - $1 WHERE id = $2", [
        original.total, original.customer_id,
      ]);
    }
    await client.query("COMMIT");
    await audit(commerceId, "sale.refund", "sales", refund.id, { originalId: original.id });
    res.status(201).json({ id: refund.id, ticketNumber: Number(refund.ticket_number), total: -original.total });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/** GET /api/sales — historial de ventas */
salesRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.ticket_number, s.payment_method, s.subtotal, s.discount, s.total,
              s.refund_of, s.created_at, c.name AS customer_name,
              (SELECT r.id FROM sales r WHERE r.refund_of = s.id LIMIT 1) AS refunded_by
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.commerce_id = $1 ORDER BY s.created_at DESC LIMIT 200`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

async function getSaleWithItems(saleId: number, commerceId: number) {
  const { rows: sales } = await pool.query(
    `SELECT s.*, c.name AS customer_name, co.name AS commerce_name
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     JOIN commerces co ON co.id = s.commerce_id
     WHERE s.id = $1 AND s.commerce_id = $2`,
    [saleId, commerceId]
  );
  if (!sales[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT i.quantity, i.unit_price, p.name, p.ean
     FROM sale_items i JOIN products p ON p.id = i.product_id WHERE i.sale_id = $1`,
    [saleId]
  );
  return { ...sales[0], items };
}

/** GET /api/sales/:id — detalle del ticket */
salesRouter.get("/:id", async (req, res, next) => {
  try {
    const sale = await getSaleWithItems(Number(req.params.id), req.auth.commerceId);
    if (!sale) throw new HttpError(404, "Ticket no encontrado");
    res.json(sale);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sales/:id/ticket.pdf
 * Ticket simple en PDF (formato 80mm, sin validez fiscal en esta versión).
 */
salesRouter.get("/:id/ticket.pdf", async (req, res, next) => {
  try {
    const sale = await getSaleWithItems(Number(req.params.id), req.auth.commerceId);
    if (!sale) throw new HttpError(404, "Ticket no encontrado");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=ticket-${sale.ticket_number}.pdf`);

    const doc = new PDFDocument({ size: [227, 400 + sale.items.length * 14], margin: 10 });
    doc.pipe(res);

    doc.fontSize(12).font("Helvetica-Bold").text(sale.commerce_name, { align: "center" });
    doc.fontSize(8).font("Helvetica").text(sale.refund_of ? "REEMBOLSO · no fiscal" : "Ticket no fiscal", { align: "center" });
    doc.moveDown(0.5);
    doc.text(`Ticket #${sale.ticket_number}`);
    doc.text(new Date(sale.created_at).toLocaleString("es-AR"));
    if (sale.customer_name) doc.text(`Cliente: ${sale.customer_name}`);
    doc.moveDown(0.5);
    doc.text("─".repeat(38));

    for (const item of sale.items) {
      doc.text(item.name.slice(0, 34));
      doc.text(
        `  ${item.quantity} x $${Number(item.unit_price).toFixed(2)}` +
          ` = $${(item.quantity * item.unit_price).toFixed(2)}`
      );
    }

    doc.text("─".repeat(38));
    doc.font("Helvetica-Bold");
    if (Number(sale.discount) > 0) {
      doc.text(`Subtotal: $${Number(sale.subtotal).toFixed(2)}`);
      doc.text(`Descuento: -$${Number(sale.discount).toFixed(2)}`);
    }
    doc.fontSize(11).text(`TOTAL: $${Number(sale.total).toFixed(2)}`);
    const methods: Record<string, string> = {
      cash: "Efectivo", wallet: "Billetera", card: "Tarjeta",
      transfer: "Transferencia", account: "Cuenta corriente",
    };
    doc.fontSize(8).font("Helvetica").text(`Pago: ${methods[sale.payment_method]}`);
    doc.moveDown().text("¡Gracias por su compra!", { align: "center" });
    doc.end();
  } catch (err) {
    next(err);
  }
});

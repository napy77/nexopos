import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";

export const customersRouter = Router();

const customerSchema = z.object({
  name: z.string().min(1),
  docNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

/** GET /api/customers — clientes del comercio con saldo */
customersRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, doc_number, phone, email, balance, created_at
       FROM customers WHERE commerce_id = $1 ORDER BY name`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** POST /api/customers — alta de cliente */
customersRouter.post("/", async (req, res, next) => {
  try {
    const body = customerSchema.parse(req.body);
    const {
      rows: [customer],
    } = await pool.query(
      `INSERT INTO customers (commerce_id, name, doc_number, phone, email)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.auth.commerceId, body.name, body.docNumber ?? null, body.phone ?? null, body.email ?? null]
    );
    await audit(req.auth.commerceId, "customer.create", "customers", customer.id);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

/** GET /api/customers/:id/transactions — historial de cuenta corriente */
customersRouter.get("/:id/transactions", async (req, res, next) => {
  try {
    const { rows: customers } = await pool.query(
      "SELECT id, name, balance FROM customers WHERE id = $1 AND commerce_id = $2",
      [Number(req.params.id), req.auth.commerceId]
    );
    if (!customers[0]) throw new HttpError(404, "Cliente no encontrado");
    const { rows: transactions } = await pool.query(
      `SELECT id, type, amount, sale_id, note, created_at
       FROM customer_transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [customers[0].id]
    );
    res.json({ customer: customers[0], transactions });
  } catch (err) {
    next(err);
  }
});

const paymentSchema = z.object({ amount: z.coerce.number().positive(), note: z.string().optional() });

/** POST /api/customers/:id/payments — registra un pago que baja la deuda */
customersRouter.post("/:id/payments", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = paymentSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const { rows: customers } = await client.query(
      "SELECT id, balance FROM customers WHERE id = $1 AND commerce_id = $2 FOR UPDATE",
      [Number(req.params.id), commerceId]
    );
    if (!customers[0]) throw new HttpError(404, "Cliente no encontrado");
    await client.query(
      `INSERT INTO customer_transactions (commerce_id, customer_id, type, amount, note)
       VALUES ($1, $2, 'payment', $3, $4)`,
      [commerceId, customers[0].id, -body.amount, body.note ?? "Pago recibido"]
    );
    const {
      rows: [updated],
    } = await client.query(
      "UPDATE customers SET balance = balance - $1 WHERE id = $2 RETURNING balance",
      [body.amount, customers[0].id]
    );
    await client.query("COMMIT");
    await audit(commerceId, "customer.payment", "customers", customers[0].id, body);
    res.json({ ok: true, balance: Number(updated.balance) });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

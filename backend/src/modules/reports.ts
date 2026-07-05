import { Router } from "express";
import { pool } from "../db.js";

export const reportsRouter = Router();

/** GET /api/reports/daily?date=YYYY-MM-DD — resumen de ventas del día */
reportsRouter.get("/daily", async (req, res, next) => {
  try {
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    const commerceId = req.auth.commerceId;
    const {
      rows: [summary],
    } = await pool.query(
      `SELECT COUNT(*)::int AS tickets,
              COALESCE(SUM(total), 0) AS total,
              COALESCE(SUM(total) FILTER (WHERE payment_method = 'cash'), 0) AS cash,
              COALESCE(SUM(total) FILTER (WHERE payment_method = 'card'), 0) AS card,
              COALESCE(SUM(total) FILTER (WHERE payment_method = 'account'), 0) AS account
       FROM sales WHERE commerce_id = $1 AND created_at::date = $2::date`,
      [commerceId, date]
    );
    const { rows: topProducts } = await pool.query(
      `SELECT p.name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.unit_price) AS revenue
       FROM sale_items i
       JOIN sales s ON s.id = i.sale_id
       JOIN products p ON p.id = i.product_id
       WHERE s.commerce_id = $1 AND s.created_at::date = $2::date
       GROUP BY p.name ORDER BY revenue DESC LIMIT 10`,
      [commerceId, date]
    );
    res.json({ date, ...summary, topProducts });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/receivables — cuentas por cobrar */
reportsRouter.get("/receivables", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, phone, balance FROM customers
       WHERE commerce_id = $1 AND balance > 0 ORDER BY balance DESC`,
      [req.auth.commerceId]
    );
    const total = rows.reduce((acc, r) => acc + Number(r.balance), 0);
    res.json({ total, customers: rows });
  } catch (err) {
    next(err);
  }
});

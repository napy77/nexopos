import { Router } from "express";
import { pool } from "../db.js";

export const exportRouter = Router();

/**
 * GET /api/export/odoo
 * Exporta todos los datos del comercio en un JSON estructurado para la
 * migración a Odoo (ver docs/ODOO-MIGRATION.md para el mapeo de modelos).
 * ?format=csv devuelve un ZIP-less multiparte simple: un CSV por entidad
 * concatenado con separadores (suficiente para el MVP).
 */
exportRouter.get("/odoo", async (req, res, next) => {
  try {
    const commerceId = req.auth.commerceId;

    const [products, customers, sales, saleItems, movements, transactions] = await Promise.all([
      pool.query(
        `SELECT p.ean, p.name, p.brand, p.category, p.unit,
                s.quantity, s.cost, s.sale_price,
                CASE WHEN s.cost > 0 THEN ROUND((s.sale_price - s.cost) / s.cost * 100, 2) END AS margin_pct
         FROM stock_items s JOIN products p ON p.id = s.product_id
         WHERE s.commerce_id = $1 ORDER BY p.name`,
        [commerceId]
      ),
      pool.query(
        `SELECT name, doc_number, phone, email, balance, created_at
         FROM customers WHERE commerce_id = $1 ORDER BY name`,
        [commerceId]
      ),
      pool.query(
        `SELECT s.id, s.ticket_number, s.payment_method, s.subtotal, s.discount, s.total,
                s.created_at, c.name AS customer_name
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.commerce_id = $1 ORDER BY s.ticket_number`,
        [commerceId]
      ),
      pool.query(
        `SELECT s.ticket_number, p.ean, p.name, i.quantity, i.unit_price
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         JOIN products p ON p.id = i.product_id
         WHERE s.commerce_id = $1 ORDER BY s.ticket_number`,
        [commerceId]
      ),
      pool.query(
        `SELECT p.ean, p.name, m.type, m.quantity, m.reference, m.created_at
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         WHERE m.commerce_id = $1 ORDER BY m.created_at`,
        [commerceId]
      ),
      pool.query(
        `SELECT c.name AS customer_name, t.type, t.amount, t.note, t.created_at
         FROM customer_transactions t JOIN customers c ON c.id = t.customer_id
         WHERE t.commerce_id = $1 ORDER BY t.created_at`,
        [commerceId]
      ),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      // Claves alineadas con modelos de Odoo
      "product.template": products.rows,
      "res.partner": customers.rows,
      "pos.order": sales.rows,
      "pos.order.line": saleItems.rows,
      "stock.move": movements.rows,
      "account.move": transactions.rows,
    };

    if (req.query.format === "csv") {
      const toCsv = (rows: Record<string, unknown>[]): string => {
        if (!rows.length) return "";
        const cols = Object.keys(rows[0]);
        const escape = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
        return [cols.join(","), ...rows.map((r) => cols.map((c) => escape(r[c])).join(","))].join("\n");
      };
      const sections = Object.entries(payload)
        .filter(([, v]) => Array.isArray(v))
        .map(([name, rows]) => `### ${name}\n${toCsv(rows as Record<string, unknown>[])}`)
        .join("\n\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=nexo-pos-export.csv");
      res.send(sections);
      return;
    }

    res.setHeader("Content-Disposition", "attachment; filename=nexo-pos-export.json");
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import { pool } from "../db.js";
import { syncCatalog } from "../integrations/nexob2b.js";

export const catalogRouter = Router();

/**
 * GET /api/catalog?q=&category=&page=&pageSize=
 * Búsqueda por nombre, EAN o categoría sobre la cache local del catálogo.
 */
catalogRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));

    const where: string[] = [];
    const params: unknown[] = [];
    if (q) {
      params.push(`%${q}%`, q);
      where.push(`(p.name ILIKE $${params.length - 1} OR p.ean = $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`p.category = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT p.id, p.ean, p.name, p.brand, p.category, p.unit,
              COUNT(*) OVER() AS total_count,
              (SELECT MIN(o.price) FROM wholesaler_offers o WHERE o.product_id = p.id) AS best_price,
              (SELECT COUNT(*) FROM wholesaler_offers o WHERE o.product_id = p.id) AS offer_count
       FROM products p
       ${whereSql}
       ORDER BY p.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({
      total: rows[0] ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
      products: rows.map(({ total_count, ...p }) => p),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/catalog/categories */
catalogRouter.get("/categories", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category"
    );
    res.json(rows.map((r) => r.category));
  } catch (err) {
    next(err);
  }
});

/** GET /api/catalog/:id/offers — ofertas de mayoristas para un producto */
catalogRouter.get("/:id/offers", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, wholesaler_id, wholesaler_name, price, currency, min_qty,
              available_stock, conditions, synced_at
       FROM wholesaler_offers WHERE product_id = $1 ORDER BY price`,
      [Number(req.params.id)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** POST /api/catalog/sync — fuerza sincronización manual con NexoB2B */
catalogRouter.post("/sync", async (_req, res, next) => {
  try {
    const result = await syncCatalog();
    res.json({ synced: result });
  } catch (err) {
    next(err);
  }
});

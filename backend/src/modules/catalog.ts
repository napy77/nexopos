import { Router } from "express";
import { pool } from "../db.js";
import { getProductos, getTaxonomia, type B2BTaxonomia } from "../integrations/nexob2b.js";
import { b2bContext } from "./auth.js";

export const catalogRouter = Router();

// La taxonomía cambia poco: cache en memoria 1 hora
let taxonomiaCache: { data: B2BTaxonomia; at: number } | null = null;

/**
 * Mantiene sincronizados los nombres de pasillo/rubro/subrubro de los
 * productos locales con la taxonomía de NexoB2B (por si el marketplace
 * renombra una categoría). Corre al iniciar y cada 12 horas.
 */
export async function refreshProductTaxonomy(): Promise<void> {
  const taxonomia = await getTaxonomia();
  for (const p of taxonomia.pasillos) {
    await pool.query(
      "UPDATE products SET pasillo_nombre = $1 WHERE pasillo_id = $2 AND pasillo_nombre IS DISTINCT FROM $1",
      [p.nombre, p.id]
    );
  }
  for (const r of taxonomia.rubros) {
    await pool.query(
      "UPDATE products SET rubro_nombre = $1, category = $1 WHERE rubro_id = $2 AND rubro_nombre IS DISTINCT FROM $1",
      [r.nombre, r.id]
    );
  }
  for (const s of taxonomia.subrubros) {
    await pool.query(
      "UPDATE products SET subrubro_nombre = $1 WHERE subrubro_id = $2 AND subrubro_nombre IS DISTINCT FROM $1",
      [s.nombre, s.id]
    );
  }
}

/** GET /api/catalog/taxonomia — pasillos y rubros para filtros */
catalogRouter.get("/taxonomia", async (_req, res, next) => {
  try {
    if (!taxonomiaCache || Date.now() - taxonomiaCache.at > 3600_000) {
      taxonomiaCache = { data: await getTaxonomia(), at: Date.now() };
    }
    res.json(taxonomiaCache.data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalog?q=&rubro_id=&pasillo_id=&mayorista_id=
 * Catálogo en vivo de NexoB2B: producto maestro → mayoristas → presentaciones.
 * tiene_alta indica si el comercio puede comprarle a ese mayorista.
 */
catalogRouter.get("/", async (req, res, next) => {
  try {
    const { token, comercioId } = await b2bContext(req);
    const productos = await getProductos(token, comercioId, {
      q: req.query.q ? String(req.query.q) : undefined,
      rubroId: req.query.rubro_id ? String(req.query.rubro_id) : undefined,
      pasilloId: req.query.pasillo_id ? String(req.query.pasillo_id) : undefined,
      subrubroId: req.query.subrubro_id ? String(req.query.subrubro_id) : undefined,
      mayoristaId: req.query.mayorista_id ? String(req.query.mayorista_id) : undefined,
      incluirSinMayorista: req.query.incluir_sin_mayorista === "true",
    });
    res.json({ productos });
  } catch (err) {
    next(err);
  }
});

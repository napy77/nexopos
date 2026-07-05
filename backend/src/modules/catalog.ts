import { Router } from "express";
import { getProductos, getTaxonomia, type B2BTaxonomia } from "../integrations/nexob2b.js";
import { b2bContext } from "./auth.js";

export const catalogRouter = Router();

// La taxonomía cambia poco: cache en memoria 1 hora
let taxonomiaCache: { data: B2BTaxonomia; at: number } | null = null;

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
      mayoristaId: req.query.mayorista_id ? String(req.query.mayorista_id) : undefined,
    });
    res.json({ productos });
  } catch (err) {
    next(err);
  }
});

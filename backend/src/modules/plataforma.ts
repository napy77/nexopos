import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db.js";
import { config } from "../config.js";
import { HttpError } from "../middleware/error.js";
import { formaDelSlug } from "../lib/slug.js";

/**
 * Endpoints que consumen los otros sistemas de Nexo, no un comercio.
 *
 * Van con la clave de plataforma y no con el JWT del POS, porque quien llama es
 * el admin de B2B y no hay ningún comerciante del otro lado.
 */
export const plataformaRouter = Router();

function requierePlataforma(req: Request, _res: Response, next: NextFunction): void {
  const enviada = (req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Sin clave configurada no se abre igual: se cierra. Un endpoint de
  // plataforma sin credencial es un endpoint público.
  if (!config.platformKey) {
    next(new HttpError(503, "Los endpoints de plataforma no están habilitados en este servidor."));
    return;
  }
  if (enviada !== config.platformKey) {
    next(new HttpError(401, "Clave de plataforma inválida"));
    return;
  }
  next();
}

/**
 * GET /api/slugs/:slug — ¿está libre esta dirección?
 *
 * Lo consulta el admin de Nexo B2B antes de guardar una región. Comercios y
 * regiones comparten un solo espacio de nombres —`morrison.nexotienda.app` es
 * un pueblo o un comercio, nunca los dos— y los dos se crean en sistemas
 * distintos, así que alguien tiene que arbitrar. Es NexoPOS, porque es quien
 * contesta qué es cada subdominio.
 *
 * Se valida contra los cuatro conjuntos: reservados, forma, comercios (con sus
 * slugs anteriores, que quedan tomados para siempre) y regiones.
 */
plataformaRouter.get("/slugs/:slug", requierePlataforma, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();

    const forma = formaDelSlug(slug);
    if (!forma.ok) {
      res.json({ libre: false, motivo: forma.motivo });
      return;
    }

    const { rows } = await pool.query(
      `SELECT 'Ya lo usa un comercio' AS motivo FROM commerces WHERE slug = $1
       UNION ALL
       SELECT 'Lo usaba un comercio antes y queda tomado' FROM commerce_previous_slugs WHERE slug = $1
       UNION ALL
       SELECT 'Ya es una región' FROM regions WHERE slug = $1
       LIMIT 1`,
      [slug]
    );

    res.json(rows[0] ? { libre: false, motivo: rows[0].motivo } : { libre: true });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/regiones/:slug — Nexo B2B nos avisa de una región.
 *
 * La copia local es para servir la página del pueblo sin preguntarle a B2B en
 * cada request, y para validar los slugs de comercio contra las regiones. El
 * dato canónico sigue siendo de ellos.
 */
plataformaRouter.put("/regiones/:slug", requierePlataforma, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const { name, province, label } = req.body ?? {};
    if (!name) throw new HttpError(400, "Falta el nombre de la región");

    const forma = formaDelSlug(slug);
    if (!forma.ok) throw new HttpError(400, forma.motivo!);

    // Que no pise un comercio vivo: si el slug ya es de alguien, no se crea.
    const { rows: tomados } = await pool.query(
      `SELECT 1 FROM commerces WHERE slug = $1
       UNION ALL SELECT 1 FROM commerce_previous_slugs WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    if (tomados[0]) throw new HttpError(409, "Ese slug ya lo usa un comercio.");

    const { rows } = await pool.query(
      `INSERT INTO regions (slug, name, province, label)
       VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''))
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, province = EXCLUDED.province,
         label = EXCLUDED.label, synced_at = now()
       RETURNING slug, name, province, label`,
      [slug, name, province ?? null, label ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

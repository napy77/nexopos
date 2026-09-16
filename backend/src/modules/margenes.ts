import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";

/**
 * Márgenes: ponerle precio a miles de productos sin tocarlos de a uno.
 *
 * El comercio que importa su catálogo o recibe una compra grande se queda con
 * miles de productos que tienen costo y no tienen precio de venta. Sin precio
 * no se pueden cobrar ni salen a la tienda, y cargarlos a mano no es trabajo de
 * un día: es trabajo que no se hace nunca.
 *
 * La regla se busca de lo más específico a lo más general y gana la primera que
 * aparezca:
 *
 *     producto → subrubro → rubro → pasillo → global
 *
 * El que no tiene nada propio hereda lo de arriba. Un comercio puede vivir con
 * una sola regla global y agregar excepciones el día que le hagan falta.
 */

export const margenesRouter = Router();

// ── El cálculo ──────────────────────────────────────────────────────────────

/**
 * SQL que resuelve la regla que le toca a cada línea del stock.
 *
 * Se hace en la base y no en JS porque son miles de filas y el trabajo es
 * exactamente el que sabe hacer una base: cruzar y quedarse con la primera.
 * `prioridad` ordena de lo más específico a lo más general; DISTINCT ON se
 * queda con la de arriba.
 */
const MARGEN_APLICABLE = `
  SELECT DISTINCT ON (s.id)
         s.id AS stock_id, s.product_id, s.cost, s.sale_price, s.precio_manual,
         p.name, p.alicuota_iva,
         r.margen, r.nivel
    FROM stock_items s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN LATERAL (
      SELECT pr.margen, pr.nivel,
             CASE pr.nivel WHEN 'producto' THEN 1 WHEN 'subrubro' THEN 2
                           WHEN 'rubro' THEN 3 WHEN 'pasillo' THEN 4
                           ELSE 5 END AS prioridad
        FROM price_rules pr
       WHERE pr.commerce_id = s.commerce_id
         AND (
           (pr.nivel = 'global')
           OR (pr.nivel = 'producto' AND pr.clave = s.product_id::text)
           OR (pr.nivel = 'subrubro' AND pr.clave = p.subrubro_nombre)
           OR (pr.nivel = 'rubro'    AND pr.clave = p.rubro_nombre)
           OR (pr.nivel = 'pasillo'  AND pr.clave = p.pasillo_nombre)
         )
       ORDER BY prioridad
       LIMIT 1
    ) r ON true
   WHERE s.commerce_id = $1 AND NOT s.es_insumo`;

export interface Redondeo {
  sumaIva: boolean;
  redondeo: number;
}

/**
 * Costo neto + margen + IVA, redondeado.
 *
 * El IVA se suma porque los dos extremos son lo que son: el costo que guardamos
 * es neto —el precio de NexoB2B viene sin IVA y la recepción se lo suma
 * aparte— y el precio del mostrador es final, la venta no le agrega nada. Sin
 * este paso, cada producto saldría un 21% por debajo de lo que el comerciante
 * cree que está cobrando, en todo el catálogo a la vez.
 *
 * Redondea hacia ARRIBA. Para abajo el comercio regala unos pesos por unidad, y
 * multiplicado por un catálogo entero deja de ser "unos pesos".
 */
export function precioDesdeCosto(
  costo: number, margen: number, alicuota: number | null, cfg: Redondeo
): number {
  let precio = costo * (1 + margen / 100);
  if (cfg.sumaIva && alicuota) precio *= 1 + Number(alicuota) / 100;
  if (cfg.redondeo > 0) precio = Math.ceil(precio / cfg.redondeo) * cfg.redondeo;
  return Math.round(precio * 100) / 100;
}

async function configDe(commerceId: number): Promise<Redondeo> {
  const { rows: [c] } = await pool.query(
    "SELECT margen_suma_iva, margen_redondeo FROM commerces WHERE id = $1", [commerceId]
  );
  return { sumaIva: Boolean(c?.margen_suma_iva), redondeo: Number(c?.margen_redondeo ?? 0) };
}

// ── Consulta ────────────────────────────────────────────────────────────────

/**
 * GET /api/margenes — las reglas, la configuración y el tamaño del problema.
 *
 * Los contadores son la parte que decide si esto sirve: "sin costo" son los que
 * ningún margen puede alcanzar, y si son la mayoría el comerciante tiene que
 * saberlo antes de esperar que la pantalla le resuelva el catálogo.
 */
margenesRouter.get("/", async (req, res, next) => {
  try {
    const commerceId = req.auth.commerceId;
    const cfg = await configDe(commerceId);
    const { rows: reglas } = await pool.query(
      `SELECT r.id, r.nivel, r.clave, r.margen,
              CASE WHEN r.nivel = 'producto' THEN p.name END AS producto_nombre
         FROM price_rules r
         -- El CASE va DENTRO del cast y no como condición del join: puesto
         -- afuera, Postgres igual intenta convertir "Muebles y Colchones" a
         -- bigint y revienta la consulta entera.
         LEFT JOIN products p ON p.id = (CASE WHEN r.nivel = 'producto' THEN r.clave END)::bigint
        WHERE r.commerce_id = $1
        ORDER BY CASE r.nivel WHEN 'global' THEN 0 WHEN 'pasillo' THEN 1
                              WHEN 'rubro' THEN 2 WHEN 'subrubro' THEN 3 ELSE 4 END,
                 r.clave`,
      [commerceId]
    );
    const { rows: [n] } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE sale_price IS NULL OR sale_price = 0)::int AS sin_precio,
              COUNT(*) FILTER (WHERE cost IS NULL OR cost = 0)::int AS sin_costo,
              COUNT(*) FILTER (WHERE precio_manual)::int AS a_mano
         FROM stock_items WHERE commerce_id = $1 AND NOT es_insumo`,
      [commerceId]
    );
    res.json({
      reglas: reglas.map((r) => ({
        id: Number(r.id), nivel: r.nivel, clave: r.clave,
        nombre: r.producto_nombre ?? r.clave, margen: Number(r.margen),
      })),
      sumaIva: cfg.sumaIva,
      redondeo: cfg.redondeo,
      conteo: n,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/margenes/taxonomia — qué pasillos, rubros y subrubros tiene ESTE
 * comercio en su stock, con cuántos productos cada uno.
 *
 * Sale del stock y no de la taxonomía completa de NexoB2B a propósito: al
 * comerciante hay que ofrecerle los veinte rubros que tiene, no los
 * cuatrocientos que existen.
 */
margenesRouter.get("/taxonomia", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT 'pasillo' AS nivel, p.pasillo_nombre AS clave, COUNT(*)::int AS productos
         FROM stock_items s JOIN products p ON p.id = s.product_id
        WHERE s.commerce_id = $1 AND NOT s.es_insumo AND p.pasillo_nombre IS NOT NULL
        GROUP BY 2
       UNION ALL
       SELECT 'rubro', p.rubro_nombre, COUNT(*)::int
         FROM stock_items s JOIN products p ON p.id = s.product_id
        WHERE s.commerce_id = $1 AND NOT s.es_insumo AND p.rubro_nombre IS NOT NULL
        GROUP BY 2
       UNION ALL
       SELECT 'subrubro', p.subrubro_nombre, COUNT(*)::int
         FROM stock_items s JOIN products p ON p.id = s.product_id
        WHERE s.commerce_id = $1 AND NOT s.es_insumo AND p.subrubro_nombre IS NOT NULL
        GROUP BY 2
        ORDER BY 1, 2`,
      [req.auth.commerceId]
    );
    res.json(rows.map((r) => ({ nivel: r.nivel, clave: r.clave, productos: r.productos })));
  } catch (err) {
    next(err);
  }
});

// ── Reglas ──────────────────────────────────────────────────────────────────

const reglaSchema = z.object({
  nivel: z.enum(["global", "pasillo", "rubro", "subrubro", "producto"]),
  clave: z.string().trim().min(1).nullable().optional(),
  // -100 sería regalarlo. Más de 1000% es un error de tipeo, no un margen.
  margen: z.coerce.number().gt(-100).lte(1000),
});

/** PUT /api/margenes/regla — crea o cambia una */
margenesRouter.put("/regla", async (req, res, next) => {
  try {
    const body = reglaSchema.parse(req.body);
    const clave = body.nivel === "global" ? null : (body.clave ?? null);
    if (body.nivel !== "global" && !clave) {
      throw new HttpError(400, "Falta a qué se aplica la regla.");
    }
    const { rows: [r] } = await pool.query(
      `INSERT INTO price_rules (commerce_id, nivel, clave, margen)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (commerce_id, nivel, COALESCE(clave, ''))
       DO UPDATE SET margen = EXCLUDED.margen, updated_at = now()
       RETURNING id, nivel, clave, margen`,
      [req.auth.commerceId, body.nivel, clave, body.margen]
    );
    await audit(req.auth.commerceId, "margen.regla", "price_rules", r.id, body);
    res.json({ id: Number(r.id), nivel: r.nivel, clave: r.clave, margen: Number(r.margen) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/margenes/regla/:id */
margenesRouter.delete("/regla/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM price_rules WHERE id = $1 AND commerce_id = $2",
      [Number(req.params.id), req.auth.commerceId]
    );
    if (rowCount === 0) throw new HttpError(404, "Esa regla no existe");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/margenes/config — sumar IVA y redondeo */
margenesRouter.put("/config", async (req, res, next) => {
  try {
    const cfg = z.object({
      sumaIva: z.boolean(),
      redondeo: z.coerce.number().nonnegative().max(10000),
    }).parse(req.body);
    await pool.query(
      "UPDATE commerces SET margen_suma_iva = $2, margen_redondeo = $3 WHERE id = $1",
      [req.auth.commerceId, cfg.sumaIva, cfg.redondeo]
    );
    res.json(cfg);
  } catch (err) {
    next(err);
  }
});

// ── Simular y aplicar ───────────────────────────────────────────────────────

const alcanceSchema = z.object({
  /**
   * `sin-precio` es el que se ofrece: llena los huecos y no toca nada de lo que
   * ya estaba. `todos` incluye los precios que el comerciante puso a mano, y
   * por eso hay que pedirlo aparte.
   */
  alcance: z.enum(["sin-precio", "calculados", "todos"]).default("sin-precio"),
});

function filtroDeAlcance(alcance: string): string {
  if (alcance === "todos") return "";
  if (alcance === "calculados") return " AND (NOT precio_manual OR sale_price IS NULL)";
  return " AND (sale_price IS NULL OR sale_price = 0)";
}

/**
 * POST /api/margenes/simular — qué pasaría, antes de que pase.
 *
 * Devuelve los números de una muestra y los totales. Aplicar márgenes sobre
 * miles de productos es irreversible en la práctica —nadie recuerda qué precio
 * tenía cada uno— así que primero se mira.
 */
margenesRouter.post("/simular", async (req, res, next) => {
  try {
    const { alcance } = alcanceSchema.parse(req.body ?? {});
    const commerceId = req.auth.commerceId;
    const cfg = await configDe(commerceId);

    const { rows } = await pool.query(
      `SELECT * FROM (${MARGEN_APLICABLE}) t WHERE true ${filtroDeAlcance(alcance)} ORDER BY t.name`,
      [commerceId]
    );

    let alcanzados = 0, sinCosto = 0, sinRegla = 0;
    const muestra: unknown[] = [];
    for (const r of rows) {
      const costo = Number(r.cost);
      if (!costo) { sinCosto++; continue; }
      if (r.margen === null || r.margen === undefined) { sinRegla++; continue; }
      const nuevo = precioDesdeCosto(costo, Number(r.margen), r.alicuota_iva, cfg);
      alcanzados++;
      if (muestra.length < 12) {
        muestra.push({
          nombre: r.name, costo, margen: Number(r.margen), nivel: r.nivel,
          alicuota: r.alicuota_iva === null ? null : Number(r.alicuota_iva),
          precioActual: r.sale_price === null ? null : Number(r.sale_price),
          precioNuevo: nuevo,
        });
      }
    }
    res.json({ alcanzados, sinCosto, sinRegla, sumaIva: cfg.sumaIva, redondeo: cfg.redondeo, muestra });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/margenes/aplicar — escribe los precios.
 *
 * Los precios que escribe quedan marcados como calculados, no manuales: la
 * próxima corrida puede recalcularlos sin preguntar. El que después toque uno a
 * mano lo saca del conjunto por sí solo.
 */
margenesRouter.post("/aplicar", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { alcance } = alcanceSchema.parse(req.body ?? {});
    const commerceId = req.auth.commerceId;
    const cfg = await configDe(commerceId);

    const { rows } = await pool.query(
      `SELECT * FROM (${MARGEN_APLICABLE}) t WHERE true ${filtroDeAlcance(alcance)}`,
      [commerceId]
    );

    await client.query("BEGIN");
    let aplicados = 0, sinCosto = 0, sinRegla = 0;
    for (const r of rows) {
      const costo = Number(r.cost);
      if (!costo) { sinCosto++; continue; }
      if (r.margen === null || r.margen === undefined) { sinRegla++; continue; }
      const nuevo = precioDesdeCosto(costo, Number(r.margen), r.alicuota_iva, cfg);
      await client.query(
        `UPDATE stock_items SET sale_price = $2, precio_manual = false, updated_at = now()
          WHERE id = $1`,
        [r.stock_id, nuevo]
      );
      aplicados++;
    }
    await client.query("COMMIT");
    await audit(commerceId, "margen.aplicar", undefined, undefined, { alcance, aplicados });
    res.json({ aplicados, sinCosto, sinRegla });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

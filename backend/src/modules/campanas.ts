import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { ZONA } from "../lib/fechas.js";
import { requiereClave } from "../middleware/api-key.js";

/**
 * Campañas: las tandas de ofertas que el comercio publica en su tienda online.
 *
 * El comerciante pone el nombre —que es el título de la sección tal como se ve,
 * "Ofertas imperdibles"—, los días, el porcentaje y qué productos entran.
 *
 * **Sólo afectan a la tienda online, no al mostrador.** Es la decisión que más
 * importa de todo esto y por eso está escrita acá y en la pantalla: el cajero
 * sigue cobrando el precio de siempre. Hacer que también cambie lo que cobra la
 * caja es un cambio sobre el camino del dinero que nadie pidió, y el comerciante
 * que quiere las dos cosas tiene que poder decirlo, no descubrirlo.
 */

export const campanasRouter = Router();

/** Lo que NexoTienda consume. Router aparte: pide la clave de catálogo. */
export const campanasV1Router = Router();

const HOY = `(now() AT TIME ZONE '${ZONA}')::date`;

// ── Para la tienda ──────────────────────────────────────────────────────────

/**
 * GET /v1/stores/:storeId/campaigns
 *
 * Sólo las vigentes, y `[]` cuando no hay ninguna: un comercio que no hace
 * ofertas no está incompleto, y un 404 obligaría a la tienda a distinguir "no
 * tiene" de "se rompió".
 *
 * Van todos los productos de la campaña, incluso los agotados o sin precio. La
 * tienda los cruza contra el catálogo que ya pidió y los que no estén
 * simplemente no se dibujan; filtrarlos acá sería hacer dos veces el mismo
 * trabajo y arriesgar que las dos listas digan cosas distintas.
 */
campanasV1Router.get(
  "/stores/:storeId/campaigns", requiereClave("catalogo"), async (req, res, next) => {
    try {
      const storeId = Number(req.params.storeId);
      const { rows } = await pool.query(
        `SELECT c.id, c.nombre, c.desde, c.hasta, c.descuento,
                COALESCE(
                  ARRAY_AGG(cp.product_id::text ORDER BY cp.product_id)
                    FILTER (WHERE cp.product_id IS NOT NULL),
                  '{}'
                ) AS productos
           FROM campaigns c
           LEFT JOIN campaign_products cp ON cp.campaign_id = c.id
          WHERE c.commerce_id = $1 AND ${HOY} BETWEEN c.desde AND c.hasta
          GROUP BY c.id
          ORDER BY c.orden, c.id`,
        [storeId]
      );
      res.json(rows.map((r) => ({
        id: String(r.id),
        storeId: String(storeId),
        name: r.nombre,
        /*
         * El día entero, en la zona del comercio. Guardamos días porque es como
         * piensa el comerciante —"del 1 al 15"— y acá se convierten a los bordes
         * del día: el 15 vale hasta que en Córdoba termine el 15.
         */
        startsAt: bordeDelDia(r.desde, "inicio"),
        endsAt: bordeDelDia(r.hasta, "fin"),
        discountPercent: Number(r.descuento),
        productIds: r.productos as string[],
      })));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * El instante en que empieza o termina un día de la zona del comercio,
 * expresado en ISO.
 *
 * Postgres devuelve la DATE como medianoche del servidor. Mandarla tal cual
 * haría que una campaña que termina el 15 venciera a las nueve de la noche del
 * 14 para quien lea el ISO en otra zona.
 */
function bordeDelDia(fecha: Date | string, cual: "inicio" | "fin"): string {
  const dia = fecha instanceof Date
    ? `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`
    : String(fecha).slice(0, 10);
  // -03:00 fijo: Argentina no cambia de huso desde 2009.
  return cual === "inicio"
    ? new Date(`${dia}T00:00:00.000-03:00`).toISOString()
    : new Date(`${dia}T23:59:59.999-03:00`).toISOString();
}

// ── Para el comerciante ─────────────────────────────────────────────────────

const campanaSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descuento: z.coerce.number().gt(0).lte(95),
});

/** GET /api/campanas — las del comercio, vigentes y no */
campanasRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.nombre, c.desde::text, c.hasta::text, c.descuento, c.orden,
              (${HOY} BETWEEN c.desde AND c.hasta) AS vigente,
              COUNT(cp.product_id)::int AS productos
         FROM campaigns c
         LEFT JOIN campaign_products cp ON cp.campaign_id = c.id
        WHERE c.commerce_id = $1
        GROUP BY c.id
        ORDER BY c.orden, c.id`,
      [req.auth.commerceId]
    );
    res.json(rows.map((r) => ({
      id: Number(r.id), nombre: r.nombre, desde: r.desde, hasta: r.hasta,
      descuento: Number(r.descuento), vigente: r.vigente, productos: r.productos,
    })));
  } catch (err) {
    next(err);
  }
});

/** GET /api/campanas/:id/productos — qué tiene adentro, con su precio */
campanasRouter.get("/:id/productos", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id AS product_id, p.name, s.sale_price, c.descuento,
              ROUND(s.sale_price * (1 - c.descuento / 100), 2) AS precio_campana
         FROM campaign_products cp
         JOIN campaigns c ON c.id = cp.campaign_id
         JOIN products p ON p.id = cp.product_id
         LEFT JOIN stock_items s ON s.product_id = p.id AND s.commerce_id = c.commerce_id
        WHERE cp.campaign_id = $1 AND c.commerce_id = $2
        ORDER BY p.name`,
      [Number(req.params.id), req.auth.commerceId]
    );
    res.json(rows.map((r) => ({
      productId: Number(r.product_id), nombre: r.name,
      precio: r.sale_price === null ? null : Number(r.sale_price),
      precioCampana: r.precio_campana === null ? null : Number(r.precio_campana),
    })));
  } catch (err) {
    next(err);
  }
});

/** POST /api/campanas */
campanasRouter.post("/", async (req, res, next) => {
  try {
    const body = campanaSchema.parse(req.body);
    if (body.hasta < body.desde) throw new HttpError(400, "La campaña termina antes de empezar.");
    const { rows: [c] } = await pool.query(
      `INSERT INTO campaigns (commerce_id, nombre, desde, hasta, descuento, orden)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE((SELECT MAX(orden) + 1 FROM campaigns WHERE commerce_id = $1), 0))
       RETURNING id`,
      [req.auth.commerceId, body.nombre, body.desde, body.hasta, body.descuento]
    );
    await audit(req.auth.commerceId, "campana.crear", "campaigns", c.id, body);
    res.status(201).json({ id: Number(c.id) });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/campanas/:id */
campanasRouter.put("/:id", async (req, res, next) => {
  try {
    const body = campanaSchema.parse(req.body);
    if (body.hasta < body.desde) throw new HttpError(400, "La campaña termina antes de empezar.");
    const { rowCount } = await pool.query(
      `UPDATE campaigns SET nombre = $3, desde = $4, hasta = $5, descuento = $6
        WHERE id = $1 AND commerce_id = $2`,
      [Number(req.params.id), req.auth.commerceId, body.nombre, body.desde, body.hasta, body.descuento]
    );
    if (rowCount === 0) throw new HttpError(404, "Esa campaña no existe");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/campanas/:id */
campanasRouter.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM campaigns WHERE id = $1 AND commerce_id = $2",
      [Number(req.params.id), req.auth.commerceId]
    );
    if (rowCount === 0) throw new HttpError(404, "Esa campaña no existe");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/campanas/:id/orden — subir o bajar la sección en la tienda */
campanasRouter.put("/:id/orden", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const hacia = req.body?.hacia === "arriba" ? "arriba" : "abajo";
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT id FROM campaigns WHERE commerce_id = $1 ORDER BY orden, id FOR UPDATE",
      [commerceId]
    );
    const ids = rows.map((r) => Number(r.id));
    const i = ids.indexOf(Number(req.params.id));
    if (i === -1) throw new HttpError(404, "Esa campaña no existe");
    const j = hacia === "arriba" ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) {
      [ids[i], ids[j]] = [ids[j], ids[i]];
      // Se reescribe la lista entera: dejar huecos o empates en `orden` es lo
      // que hace que dos campañas se intercambien solas la próxima vez.
      for (const [orden, id] of ids.entries()) {
        await client.query("UPDATE campaigns SET orden = $2 WHERE id = $1", [id, orden]);
      }
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── Qué productos entran ────────────────────────────────────────────────────

const productosSchema = z.object({
  agregar: z.array(z.coerce.number().int()).optional(),
  quitar: z.array(z.coerce.number().int()).optional(),
  /** Mete de una todos los de un rubro, pasillo o subrubro del stock */
  agregarPor: z.object({
    nivel: z.enum(["pasillo", "rubro", "subrubro"]),
    clave: z.string().trim().min(1),
  }).optional(),
});

/**
 * PUT /api/campanas/:id/productos
 *
 * `agregarPor` existe porque un comercio con siete mil productos no arma una
 * tanda buscándolos de a uno. Expande a filas explícitas: la campaña sigue
 * siendo una lista de productos y no una regla, así que sacar uno después es
 * sacar uno, no pelearse con un criterio.
 */
campanasRouter.put("/:id/productos", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = productosSchema.parse(req.body ?? {});
    const campaignId = Number(req.params.id);
    const commerceId = req.auth.commerceId;

    const { rows: [c] } = await pool.query(
      "SELECT id FROM campaigns WHERE id = $1 AND commerce_id = $2", [campaignId, commerceId]
    );
    if (!c) throw new HttpError(404, "Esa campaña no existe");

    await client.query("BEGIN");

    if (body.agregarPor) {
      const col = { pasillo: "pasillo_nombre", rubro: "rubro_nombre", subrubro: "subrubro_nombre" }[
        body.agregarPor.nivel
      ];
      await client.query(
        `INSERT INTO campaign_products (campaign_id, product_id)
         SELECT $1, s.product_id
           FROM stock_items s JOIN products p ON p.id = s.product_id
          WHERE s.commerce_id = $2 AND NOT s.es_insumo AND p.${col} = $3
         ON CONFLICT DO NOTHING`,
        [campaignId, commerceId, body.agregarPor.clave]
      );
    }
    if (body.agregar?.length) {
      // El filtro por stock_items no es decorativo: sin él, un id de otro
      // comercio entraría a la campaña de éste.
      await client.query(
        `INSERT INTO campaign_products (campaign_id, product_id)
         SELECT $1, s.product_id FROM stock_items s
          WHERE s.commerce_id = $2 AND s.product_id = ANY($3::bigint[])
         ON CONFLICT DO NOTHING`,
        [campaignId, commerceId, body.agregar]
      );
    }
    if (body.quitar?.length) {
      await client.query(
        "DELETE FROM campaign_products WHERE campaign_id = $1 AND product_id = ANY($2::bigint[])",
        [campaignId, body.quitar]
      );
    }

    const { rows: [n] } = await client.query(
      "SELECT COUNT(*)::int AS n FROM campaign_products WHERE campaign_id = $1", [campaignId]
    );
    await client.query("COMMIT");
    res.json({ productos: n.n });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

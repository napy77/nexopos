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
        `SELECT c.id, c.nombre, c.desde, c.hasta,
                COALESCE(
                  ARRAY_AGG(cp.product_id::text ORDER BY cp.orden, cp.product_id)
                    FILTER (WHERE cp.product_id IS NOT NULL),
                  '{}'
                ) AS productos,
                /*
                 * El porcentaje más alto de la tanda, no el de la campaña: ya
                 * no hay uno de la campaña. Con descuentos distintos por
                 * producto, un número solo miente salvo que se lea como "hasta".
                 */
                MAX(CASE WHEN cp.descuento IS NOT NULL THEN cp.descuento
                         WHEN cp.precio IS NOT NULL AND s.sale_price > 0
                         THEN ROUND((1 - cp.precio / s.sale_price) * 100, 2)
                    END) AS tope
           FROM campaigns c
           LEFT JOIN campaign_products cp ON cp.campaign_id = c.id
           LEFT JOIN stock_items s
                  ON s.product_id = cp.product_id AND s.commerce_id = c.commerce_id
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
        /*
         * El más alto de la tanda. Antes era el único que había; ahora cada
         * producto tiene el suyo, así que esto sólo sirve leído como "hasta".
         * El porcentaje de cada cinta sale de los dos precios del producto, que
         * es como NexoTienda ya lo hace.
         */
        discountPercent: r.tope === null ? 0 : Number(r.tope),
        /** En el orden que eligió el comerciante, no alfabético. */
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
});

/** GET /api/campanas — las del comercio, vigentes y no */
campanasRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.nombre, c.desde::text, c.hasta::text, c.orden,
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
      vigente: r.vigente, productos: r.productos,
    })));
  } catch (err) {
    next(err);
  }
});

/** GET /api/campanas/:id/productos — qué tiene adentro, con su precio */
campanasRouter.get("/:id/productos", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id AS product_id, p.name, s.sale_price, cp.descuento, cp.precio,
              COALESCE(cp.precio, ROUND(s.sale_price * (1 - cp.descuento / 100), 2))
                AS precio_campana
         FROM campaign_products cp
         JOIN campaigns c ON c.id = cp.campaign_id
         JOIN products p ON p.id = cp.product_id
         LEFT JOIN stock_items s ON s.product_id = p.id AND s.commerce_id = c.commerce_id
        WHERE cp.campaign_id = $1 AND c.commerce_id = $2
        ORDER BY cp.orden, p.name`,
      [Number(req.params.id), req.auth.commerceId]
    );
    res.json(rows.map((r) => ({
      productId: Number(r.product_id), nombre: r.name,
      precio: r.sale_price === null ? null : Number(r.sale_price),
      precioCampana: r.precio_campana === null ? null : Number(r.precio_campana),
      /** Lo que el comerciante escribió: uno de los dos, nunca los dos. */
      descuento: r.descuento === null ? null : Number(r.descuento),
      precioFijo: r.precio === null ? null : Number(r.precio),
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
      `INSERT INTO campaigns (commerce_id, nombre, desde, hasta, orden)
       VALUES ($1, $2, $3, $4,
               COALESCE((SELECT MAX(orden) + 1 FROM campaigns WHERE commerce_id = $1), 0))
       RETURNING id`,
      [req.auth.commerceId, body.nombre, body.desde, body.hasta]
    );
    await audit(req.auth.commerceId, "campana.crear", "campaigns", c.id, body);
    res.status(201).json({ id: Number(c.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/campanas/orden — el orden completo, como quedó después de arrastrar.
 *
 * Se manda la lista entera y no "subí ésta": arrastrar no es un movimiento de a
 * uno, y reconstruirlo como una secuencia de intercambios da resultados
 * distintos según en qué orden lleguen. Además reescribe todos los `orden`, que
 * es lo que evita los empates que hacen que dos campañas se intercambien solas
 * la próxima vez.
 *
 * Las que no vengan en la lista quedan al final, en el orden que tenían: un
 * cliente desactualizado no puede mandar al fondo una campaña que no conocía.
 */
campanasRouter.put("/orden", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ids = z.array(z.coerce.number().int()).parse(req.body?.ids ?? []);
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT id FROM campaigns WHERE commerce_id = $1 ORDER BY orden, id FOR UPDATE",
      [commerceId]
    );
    const existentes = rows.map((r) => Number(r.id));
    const pedidos = ids.filter((id) => existentes.includes(id));
    const final = [...pedidos, ...existentes.filter((id) => !pedidos.includes(id))];
    for (const [orden, id] of final.entries()) {
      await client.query("UPDATE campaigns SET orden = $2 WHERE id = $1", [id, orden]);
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

/** PUT /api/campanas/:id */
campanasRouter.put("/:id", async (req, res, next) => {
  try {
    const body = campanaSchema.parse(req.body);
    if (body.hasta < body.desde) throw new HttpError(400, "La campaña termina antes de empezar.");
    const { rowCount } = await pool.query(
      `UPDATE campaigns SET nombre = $3, desde = $4, hasta = $5
        WHERE id = $1 AND commerce_id = $2`,
      [Number(req.params.id), req.auth.commerceId, body.nombre, body.desde, body.hasta]
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

// ── Qué productos entran ────────────────────────────────────────────────────

/**
 * Con cuánto entran los productos que se agregan.
 *
 * Uno de los dos, nunca los dos. El comerciante piensa de las dos formas —"a
 * éste hacele 25%" y "éste lo quiero a $5.000"— y se guarda la que dijo: pasar
 * el precio a porcentaje lo traicionaría, porque $8.500 a $5.000 es 41,17…% y
 * al redondear vuelve $5.000,30.
 */
const rebajaSchema = z.object({
  descuento: z.coerce.number().gt(0).lte(95).optional(),
  precio: z.coerce.number().positive().optional(),
}).refine((r) => (r.descuento === undefined) !== (r.precio === undefined),
  { message: "Poné un porcentaje o un precio, uno de los dos." });

const productosSchema = z.object({
  agregar: z.array(z.coerce.number().int()).optional(),
  quitar: z.array(z.coerce.number().int()).optional(),
  /** Con qué entran los de `agregar` y `agregarPor`. */
  rebaja: rebajaSchema.optional(),
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

    if ((body.agregar?.length || body.agregarPor) && !body.rebaja) {
      throw new HttpError(400, "Decime con qué descuento entran: un porcentaje o un precio.");
    }
    const desc = body.rebaja?.descuento ?? null;
    const prec = body.rebaja?.precio ?? null;
    // Los nuevos van al final de la tanda, no al principio: el orden de arriba
    // ya lo eligió el comerciante y agregar no es motivo para pisárselo.
    const { rows: [ult] } = await client.query(
      "SELECT COALESCE(MAX(orden) + 1, 0) AS n FROM campaign_products WHERE campaign_id = $1",
      [campaignId]
    );
    let siguiente = Number(ult.n);

    if (body.agregarPor) {
      const col = { pasillo: "pasillo_nombre", rubro: "rubro_nombre", subrubro: "subrubro_nombre" }[
        body.agregarPor.nivel
      ];
      const { rowCount } = await client.query(
        `INSERT INTO campaign_products (campaign_id, product_id, descuento, precio, orden)
         SELECT $1, s.product_id, $4, $5,
                $6 + ROW_NUMBER() OVER (ORDER BY p.name) - 1
           FROM stock_items s JOIN products p ON p.id = s.product_id
          WHERE s.commerce_id = $2 AND NOT s.es_insumo AND p.${col} = $3
         ON CONFLICT DO NOTHING`,
        [campaignId, commerceId, body.agregarPor.clave, desc, prec, siguiente]
      );
      siguiente += rowCount ?? 0;
    }
    if (body.agregar?.length) {
      // El filtro por stock_items no es decorativo: sin él, un id de otro
      // comercio entraría a la campaña de éste.
      await client.query(
        `INSERT INTO campaign_products (campaign_id, product_id, descuento, precio, orden)
         SELECT $1, s.product_id, $4, $5,
                $6 + ROW_NUMBER() OVER (ORDER BY s.product_id) - 1
           FROM stock_items s
          WHERE s.commerce_id = $2 AND s.product_id = ANY($3::bigint[])
         ON CONFLICT DO NOTHING`,
        [campaignId, commerceId, body.agregar, desc, prec, siguiente]
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

/**
 * PUT /api/campanas/:id/productos/orden — el orden dentro de la tanda.
 *
 * La tienda muestra los primeros y el resto queda en "Ver todos", así que esto
 * es una decisión comercial y no una preferencia de pantalla: el producto que
 * empieza con Z puede ser justo el que se quiere adelante.
 *
 * Misma forma que el orden de campañas y por el mismo motivo: llega la lista
 * entera, y lo que no venga queda al final como estaba.
 */
campanasRouter.put("/:id/productos/orden", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ids = z.array(z.coerce.number().int()).parse(req.body?.productIds ?? []);
    const campaignId = Number(req.params.id);
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT cp.product_id FROM campaign_products cp
         JOIN campaigns c ON c.id = cp.campaign_id
        WHERE cp.campaign_id = $1 AND c.commerce_id = $2
        ORDER BY cp.orden, cp.product_id
          FOR UPDATE OF cp`,
      [campaignId, req.auth.commerceId]
    );
    if (rows.length === 0) throw new HttpError(404, "Esa campaña no existe o está vacía");
    const existentes = rows.map((r) => Number(r.product_id));
    const pedidos = ids.filter((id) => existentes.includes(id));
    const final = [...pedidos, ...existentes.filter((id) => !pedidos.includes(id))];
    for (const [orden, id] of final.entries()) {
      await client.query(
        "UPDATE campaign_products SET orden = $3 WHERE campaign_id = $1 AND product_id = $2",
        [campaignId, id, orden]
      );
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

/**
 * PUT /api/campanas/:id/productos/:productId — cambiarle la rebaja a uno.
 *
 * Acepta porcentaje o precio, y guarda el que vino. Que el comerciante pueda
 * escribir cualquiera de los dos no es comodidad: en una góndola se piensa
 * "a éste hacele 25" para unos y "éste tiene que quedar en 5.000" para otros,
 * y obligarlo a convertir es pedirle que haga una cuenta para que la hagamos
 * nosotros al revés.
 */
campanasRouter.put("/:id/productos/:productId", async (req, res, next) => {
  try {
    const r = rebajaSchema.parse(req.body ?? {});
    const { rowCount } = await pool.query(
      `UPDATE campaign_products cp SET descuento = $3, precio = $4
         FROM campaigns c
        WHERE c.id = cp.campaign_id AND cp.campaign_id = $1
          AND cp.product_id = $2 AND c.commerce_id = $5`,
      [Number(req.params.id), Number(req.params.productId),
       r.descuento ?? null, r.precio ?? null, req.auth.commerceId]
    );
    if (rowCount === 0) throw new HttpError(404, "Ese producto no está en la campaña");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

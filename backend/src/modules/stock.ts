import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";

export const stockRouter = Router();

/** GET /api/stock?q=&lowOnly= — stock local del comercio */
stockRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const lowOnly = req.query.lowOnly === "true";
    const params: unknown[] = [req.auth.commerceId];
    let where = "s.commerce_id = $1";
    if (q) {
      params.push(`%${q}%`, q);
      where += ` AND (p.name ILIKE $${params.length - 1} OR p.ean = $${params.length})`;
    }
    if (lowOnly) where += " AND s.quantity <= s.min_stock";
    const { rows } = await pool.query(
      `SELECT s.id, s.product_id, p.name, p.ean, p.category, p.unit,
              COALESCE(s.image_url, p.image_url) AS image_url,
              (s.image_url IS NOT NULL) AS imagen_propia,
              p.pasillo_nombre, p.rubro_nombre, p.subrubro_nombre,
              p.origen, p.plu, p.venta_por_peso,
              s.quantity, s.cost, s.sale_price, s.min_stock, s.updated_at,
              (s.quantity <= s.min_stock) AS low_stock
       FROM stock_items s JOIN products p ON p.id = s.product_id
       WHERE ${where}
       ORDER BY p.name LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const adjustSchema = z.object({
  productId: z.coerce.number().int(),
  quantityDelta: z.coerce.number(),  // positivo entra, negativo sale
  reason: z.string().min(1),
  cost: z.coerce.number().nonnegative().optional(),
  salePrice: z.coerce.number().positive().optional(),
  minStock: z.coerce.number().nonnegative().optional(),
});

/** POST /api/stock/adjust — ajuste manual con motivo (auditable) */
stockRouter.post("/adjust", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = adjustSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const {
      rows: [item],
    } = await client.query(
      `INSERT INTO stock_items (commerce_id, product_id, quantity, cost, sale_price, min_stock, updated_at)
       VALUES ($1, $2, GREATEST($3, 0), $4, $5, COALESCE($6, 0), now())
       ON CONFLICT (commerce_id, product_id) DO UPDATE SET
         quantity = GREATEST(stock_items.quantity + $3, 0),
         cost = COALESCE($4, stock_items.cost),
         sale_price = COALESCE($5, stock_items.sale_price),
         min_stock = COALESCE($6, stock_items.min_stock),
         updated_at = now()
       RETURNING id, quantity`,
      [commerceId, body.productId, body.quantityDelta, body.cost ?? null, body.salePrice ?? null, body.minStock ?? null]
    );
    if (body.quantityDelta !== 0) {
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'manual_adjustment', $3, $4)`,
        [commerceId, body.productId, body.quantityDelta, body.reason]
      );
    }
    await client.query("COMMIT");
    await audit(commerceId, "stock.adjust", "stock_items", item.id, body);
    res.json({ ok: true, quantity: Number(item.quantity) });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

const addFromCatalogSchema = z.object({
  presentacionId: z.string(),
  meta: z.object({
    productoNombre: z.string(),
    presentacionNombre: z.string(),
    ean: z.string().nullable().optional(),
    descripcion: z.string().nullable().optional(),
    marca: z.string().nullable().optional(),
    pasilloId: z.string().nullable().optional(),
    pasilloNombre: z.string().nullable().optional(),
    rubroId: z.string().nullable().optional(),
    rubroNombre: z.string().nullable().optional(),
    subrubroId: z.string().nullable().optional(),
    subrubroNombre: z.string().nullable().optional(),
    imagenUrl: z.string().nullable().optional(),
    alicuotaIva: z.coerce.number().nullable().optional(),
    factor: z.coerce.number().optional(),
  }),
  quantity: z.coerce.number().nonnegative(),
  cost: z.coerce.number().nonnegative().optional(),
  salePrice: z.coerce.number().positive().optional(),
  minStock: z.coerce.number().nonnegative().optional(),
});

/**
 * POST /api/stock/add-from-catalog
 * Carga inicial de mercadería que el comercio ya tiene en el local:
 * crea el producto local (nivel presentación de NexoB2B) y su stock.
 */
stockRouter.post("/add-from-catalog", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = addFromCatalogSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const {
      rows: [product],
    } = await client.query(
      `INSERT INTO products (nexob2b_id, ean, name, brand, category, unit, image_url, alicuota_iva, factor,
                             pasillo_id, pasillo_nombre, rubro_id, rubro_nombre, subrubro_id, subrubro_nombre,
                             descripcion, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
       ON CONFLICT (nexob2b_id) DO UPDATE SET
         ean = COALESCE(EXCLUDED.ean, products.ean), name = EXCLUDED.name,
         brand = COALESCE(EXCLUDED.brand, products.brand),
         category = COALESCE(EXCLUDED.category, products.category),
         image_url = COALESCE(EXCLUDED.image_url, products.image_url),
         alicuota_iva = COALESCE(EXCLUDED.alicuota_iva, products.alicuota_iva),
         pasillo_id = COALESCE(EXCLUDED.pasillo_id, products.pasillo_id),
         pasillo_nombre = COALESCE(EXCLUDED.pasillo_nombre, products.pasillo_nombre),
         rubro_id = COALESCE(EXCLUDED.rubro_id, products.rubro_id),
         rubro_nombre = COALESCE(EXCLUDED.rubro_nombre, products.rubro_nombre),
         subrubro_id = COALESCE(EXCLUDED.subrubro_id, products.subrubro_id),
         subrubro_nombre = COALESCE(EXCLUDED.subrubro_nombre, products.subrubro_nombre),
         descripcion = COALESCE(EXCLUDED.descripcion, products.descripcion),
         synced_at = now()
       RETURNING id`,
      [
        body.presentacionId,
        body.meta.ean ?? null,
        `${body.meta.productoNombre} — ${body.meta.presentacionNombre}`,
        body.meta.marca ?? null,
        body.meta.rubroNombre ?? null,
        body.meta.presentacionNombre,
        body.meta.imagenUrl ?? null,
        body.meta.alicuotaIva ?? null,
        body.meta.factor ?? 1,
        body.meta.pasilloId ?? null,
        body.meta.pasilloNombre ?? null,
        body.meta.rubroId ?? null,
        body.meta.rubroNombre ?? null,
        body.meta.subrubroId ?? null,
        body.meta.subrubroNombre ?? null,
        body.meta.descripcion ?? null,
      ]
    );
    await client.query(
      `INSERT INTO stock_items (commerce_id, product_id, quantity, cost, sale_price, min_stock, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), now())
       ON CONFLICT (commerce_id, product_id) DO UPDATE SET
         quantity = stock_items.quantity + EXCLUDED.quantity,
         cost = COALESCE($4, stock_items.cost),
         sale_price = COALESCE($5, stock_items.sale_price),
         min_stock = COALESCE($6, stock_items.min_stock),
         updated_at = now()`,
      [commerceId, product.id, body.quantity, body.cost ?? null, body.salePrice ?? null, body.minStock ?? null]
    );
    if (body.quantity > 0) {
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'manual_adjustment', $3, 'Carga inicial de stock')`,
        [commerceId, product.id, body.quantity]
      );
    }
    await client.query("COMMIT");
    await audit(commerceId, "stock.add_from_catalog", "products", product.id, { presentacionId: body.presentacionId });
    res.status(201).json({ ok: true, productId: product.id });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/**
 * Imagen del producto: se guarda como data URI junto al producto, no como
 * archivo. El navegador ya la achica a ~400px (ver lib/imagen.ts), así que
 * entra holgada en la base, viaja en el backup y evita montar almacenamiento
 * de archivos y su configuración en nginx.
 */
const MAX_IMAGEN_BYTES = 400 * 1024;
const imagenSchema = z
  .string()
  .regex(/^data:image\/(jpeg|png|webp);base64,/, "Formato de imagen no soportado")
  .refine((v) => v.length * 0.75 <= MAX_IMAGEN_BYTES, "La imagen es demasiado pesada");

const productoPropioSchema = z.object({
  nombre: z.string().min(1),
  imagenUrl: imagenSchema.optional(),
  marca: z.string().optional(),
  rubro: z.string().optional(),          // texto libre: no viene de la taxonomía B2B
  ean: z.string().optional(),            // código de barras propio, si tiene
  plu: z.string().optional(),            // código de balanza
  ventaPorPeso: z.boolean().default(false),
  unidad: z.string().optional(),         // "unidad", "kg", "bandeja 100g"…
  descripcion: z.string().optional(),
  quantity: z.coerce.number().nonnegative().default(0),
  cost: z.coerce.number().nonnegative().optional(),
  salePrice: z.coerce.number().positive(),
  minStock: z.coerce.number().nonnegative().optional(),
});

/**
 * POST /api/stock/producto-propio
 * Crea un producto que no existe en el catálogo de NexoB2B: fraccionados
 * (jamón por bandeja), elaboración propia (una torta) o mercadería comprada
 * fuera del marketplace. Pertenece solo a este comercio.
 */
stockRouter.post("/producto-propio", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = productoPropioSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    const plu = body.plu?.trim() || null;

    await client.query("BEGIN");

    if (plu) {
      const { rows: dup } = await client.query(
        "SELECT id, name FROM products WHERE commerce_id = $1 AND plu = $2",
        [commerceId, plu]
      );
      if (dup[0]) throw new HttpError(409, `El código de balanza ${plu} ya lo usa "${dup[0].name}"`);
    }

    const {
      rows: [product],
    } = await client.query(
      `INSERT INTO products
         (commerce_id, origen, name, brand, category, rubro_nombre, ean, plu,
          venta_por_peso, unit, descripcion, image_url, synced_at)
       VALUES ($1, 'propio', $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, now())
       RETURNING id`,
      [
        commerceId,
        body.nombre,
        body.marca ?? null,
        body.rubro ?? null,
        body.ean?.trim() || null,
        plu,
        body.ventaPorPeso,
        body.unidad ?? (body.ventaPorPeso ? "kg" : "unidad"),
        body.descripcion ?? null,
        body.imagenUrl ?? null,
      ]
    );

    await client.query(
      `INSERT INTO stock_items (commerce_id, product_id, quantity, cost, sale_price, min_stock, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), now())`,
      [commerceId, product.id, body.quantity, body.cost ?? null, body.salePrice, body.minStock ?? null]
    );
    if (body.quantity > 0) {
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'manual_adjustment', $3, 'Alta de producto propio')`,
        [commerceId, product.id, body.quantity]
      );
    }

    await client.query("COMMIT");
    await audit(commerceId, "product.create_own", "products", product.id, { nombre: body.nombre, plu });
    res.status(201).json({ ok: true, productId: product.id });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

const imagenBodySchema = z.object({ imagenUrl: imagenSchema.nullable() });

/**
 * PUT /api/stock/:productId/imagen
 * Cambia (o borra, con null) la foto que se ve en el punto de venta.
 * Solo sobre productos que el comercio tenga en su stock: los del catálogo
 * de NexoB2B son globales, así que la foto propia pisa la del marketplace
 * únicamente si el comercio la sube.
 */
stockRouter.put("/:productId/imagen", async (req, res, next) => {
  try {
    const { imagenUrl } = imagenBodySchema.parse(req.body);
    const productId = Number(req.params.productId);
    const commerceId = req.auth.commerceId;

    const { rowCount } = await pool.query(
      `UPDATE stock_items SET image_url = $1, updated_at = now()
       WHERE commerce_id = $2 AND product_id = $3`,
      [imagenUrl, commerceId, productId]
    );
    if (!rowCount) throw new HttpError(404, "Ese producto no está en tu stock");
    await audit(commerceId, "product.image", "products", productId, { borrada: imagenUrl === null });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET /api/stock/movements?productId= — historial de movimientos */
stockRouter.get("/movements", async (req, res, next) => {
  try {
    const params: unknown[] = [req.auth.commerceId];
    let where = "m.commerce_id = $1";
    if (req.query.productId) {
      params.push(Number(req.query.productId));
      where += ` AND m.product_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT m.id, m.product_id, p.name, p.ean, m.type, m.quantity, m.reference, m.created_at
       FROM stock_movements m JOIN products p ON p.id = m.product_id
       WHERE ${where} ORDER BY m.created_at DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** GET /api/stock/alerts — productos con stock por debajo del mínimo */
stockRouter.get("/alerts", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.product_id, p.name, p.ean, s.quantity, s.min_stock
       FROM stock_items s JOIN products p ON p.id = s.product_id
       WHERE s.commerce_id = $1 AND s.min_stock > 0 AND s.quantity <= s.min_stock
       ORDER BY (s.min_stock - s.quantity) DESC`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

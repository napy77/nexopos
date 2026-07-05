import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { crearOrden, getOrdenes, cancelarOrden } from "../integrations/nexob2b.js";
import { b2bContext } from "./auth.js";

export const purchasesRouter = Router();

// Datos de la presentación que viajan con el carrito: alcanzan para crear
// el producto local al recibir la mercadería sin volver a consultar NexoB2B.
const itemMetaSchema = z.object({
  productoNombre: z.string(),
  presentacionNombre: z.string(),
  ean: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  rubroNombre: z.string().nullable().optional(),
  imagenUrl: z.string().nullable().optional(),
  alicuotaIva: z.coerce.number().nullable().optional(),
  factor: z.coerce.number().optional(),
});

const createOrderSchema = z.object({
  mayoristaId: z.string(),
  medioPagoId: z.string(),
  notas: z.string().optional(),
  items: z
    .array(
      z.object({
        presentacionId: z.string(),
        cantidad: z.coerce.number().positive(),
        meta: itemMetaSchema,
      })
    )
    .min(1),
});

/**
 * POST /api/purchases
 * Crea la orden en NexoB2B y la registra localmente con el detalle
 * que devuelve el marketplace (números, totales con IVA, estado).
 */
purchasesRouter.post("/", async (req, res, next) => {
  try {
    const body = createOrderSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    const { token } = await b2bContext(req);

    const orden = await crearOrden(token, {
      mayorista_id: body.mayoristaId,
      items: body.items.map((i) => ({ presentacion_id: i.presentacionId, cantidad: i.cantidad })),
      medio_pago_id: body.medioPagoId,
      notas: body.notas,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const {
        rows: [local],
      } = await client.query(
        `INSERT INTO purchase_orders
           (commerce_id, wholesaler_id, wholesaler_name, status, total, nexob2b_order_id,
            numero, estado_b2b, total_neto, total_iva, costo_medio_pago, medio_pago, notas, confirmed_at)
         VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
         RETURNING id`,
        [
          commerceId, orden.mayorista_id, orden.mayorista_nombre ?? "", orden.total,
          orden.id, orden.numero, orden.estado, orden.total_neto, orden.total_iva,
          orden.costo_medio_pago, orden.medio_pago_nombre ?? null, orden.notas,
        ]
      );
      // Ítems con lo que respondió NexoB2B + meta del carrito (imagen, rubro).
      // NexoB2B devuelve los items en el orden en que se enviaron.
      for (let i = 0; i < orden.items.length; i++) {
        const b2bItem = orden.items[i];
        const meta = body.items[i]?.meta ?? null;
        await client.query(
          `INSERT INTO purchase_order_items
             (order_id, presentacion_id, descripcion, quantity, unit_price, meta)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            local.id,
            body.items[i]?.presentacionId ?? null,
            b2bItem.nombre,
            b2bItem.cantidad,
            b2bItem.precio_unitario,
            meta ? JSON.stringify({ ...meta, ean: b2bItem.ean ?? meta.ean ?? null, alicuotaIva: b2bItem.alicuota_iva ?? meta.alicuotaIva ?? null }) : null,
          ]
        );
      }
      await client.query("COMMIT");
      await audit(commerceId, "po.create", "purchase_orders", local.id, { nexob2bId: orden.id, total: orden.total });
      res.status(201).json({ id: local.id, numero: orden.numero, total: orden.total, estado: orden.estado });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/purchases
 * Historial local, refrescando el estado de las órdenes desde NexoB2B.
 */
purchasesRouter.get("/", async (req, res, next) => {
  try {
    const commerceId = req.auth.commerceId;
    // Refrescar estados desde el marketplace (best effort)
    try {
      const { token } = await b2bContext(req);
      const ordenes = await getOrdenes(token);
      for (const o of ordenes) {
        await pool.query(
          `UPDATE purchase_orders
           SET estado_b2b = $1, is_pagada = $2, is_facturada = $3
           WHERE commerce_id = $4 AND nexob2b_order_id = $5`,
          [o.estado, o.is_pagada ?? false, o.is_facturada ?? false, commerceId, o.id]
        );
      }
    } catch (err) {
      console.error("[purchases] no se pudo refrescar estados desde NexoB2B:", err);
    }

    const { rows } = await pool.query(
      `SELECT id, wholesaler_id, wholesaler_name, status, estado_b2b, numero,
              total, total_neto, total_iva, costo_medio_pago, medio_pago, notas,
              is_pagada, is_facturada, nexob2b_order_id, created_at, received_at
       FROM purchase_orders WHERE commerce_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** GET /api/purchases/:id — detalle con items */
purchasesRouter.get("/:id", async (req, res, next) => {
  try {
    const { rows: orders } = await pool.query(
      "SELECT * FROM purchase_orders WHERE id = $1 AND commerce_id = $2",
      [Number(req.params.id), req.auth.commerceId]
    );
    if (!orders[0]) throw new HttpError(404, "Orden no encontrada");
    const { rows: items } = await pool.query(
      `SELECT presentacion_id, descripcion, quantity, unit_price, meta
       FROM purchase_order_items WHERE order_id = $1`,
      [orders[0].id]
    );
    res.json({ ...orders[0], items });
  } catch (err) {
    next(err);
  }
});

/** POST /api/purchases/:id/cancel — cancela en NexoB2B (solo estado "cargada") */
purchasesRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, nexob2b_order_id FROM purchase_orders WHERE id = $1 AND commerce_id = $2",
      [Number(req.params.id), req.auth.commerceId]
    );
    if (!rows[0]) throw new HttpError(404, "Orden no encontrada");
    const { token } = await b2bContext(req);
    const orden = await cancelarOrden(token, rows[0].nexob2b_order_id);
    await pool.query(
      "UPDATE purchase_orders SET status = 'cancelled', estado_b2b = $1 WHERE id = $2",
      [orden.estado, rows[0].id]
    );
    await audit(req.auth.commerceId, "po.cancel", "purchase_orders", rows[0].id);
    res.json({ ok: true, estado: orden.estado });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchases/:id/receive
 * Ingresa la mercadería al stock local. Crea (si hace falta) el producto
 * local a nivel presentación usando la meta guardada con la orden.
 */
purchasesRouter.post("/:id/receive", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const { rows: orders } = await client.query(
      `SELECT id, status, estado_b2b FROM purchase_orders
       WHERE id = $1 AND commerce_id = $2 FOR UPDATE`,
      [Number(req.params.id), commerceId]
    );
    if (!orders[0]) throw new HttpError(404, "Orden no encontrada");
    if (orders[0].status === "received") throw new HttpError(400, "La orden ya fue recibida");
    if (orders[0].status === "cancelled" || orders[0].estado_b2b === "cancelada")
      throw new HttpError(400, "No se puede recibir una orden cancelada");

    const { rows: items } = await client.query(
      "SELECT id, presentacion_id, descripcion, quantity, unit_price, meta FROM purchase_order_items WHERE order_id = $1",
      [orders[0].id]
    );
    for (const item of items) {
      const meta = item.meta ?? {};
      // Producto local por presentación (identidad: pmp_ de NexoB2B)
      const {
        rows: [product],
      } = await client.query(
        `INSERT INTO products (nexob2b_id, ean, name, brand, category, unit, image_url, alicuota_iva, factor, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (nexob2b_id) DO UPDATE SET
           ean = COALESCE(EXCLUDED.ean, products.ean),
           name = EXCLUDED.name, brand = COALESCE(EXCLUDED.brand, products.brand),
           category = COALESCE(EXCLUDED.category, products.category),
           image_url = COALESCE(EXCLUDED.image_url, products.image_url),
           alicuota_iva = COALESCE(EXCLUDED.alicuota_iva, products.alicuota_iva),
           synced_at = now()
         RETURNING id`,
        [
          item.presentacion_id,
          meta.ean ?? null,
          item.descripcion ?? `${meta.productoNombre ?? "Producto"} — ${meta.presentacionNombre ?? ""}`,
          meta.marca ?? null,
          meta.rubroNombre ?? null,
          meta.presentacionNombre ?? "unidad",
          meta.imagenUrl ?? null,
          meta.alicuotaIva ?? null,
          meta.factor ?? 1,
        ]
      );
      await client.query("UPDATE purchase_order_items SET product_id = $1 WHERE id = $2", [product.id, item.id]);
      await client.query(
        `INSERT INTO stock_items (commerce_id, product_id, quantity, cost, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (commerce_id, product_id) DO UPDATE SET
           quantity = stock_items.quantity + EXCLUDED.quantity,
           cost = EXCLUDED.cost, updated_at = now()`,
        [commerceId, product.id, item.quantity, item.unit_price]
      );
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'purchase_reception', $3, $4)`,
        [commerceId, product.id, item.quantity, `PO-${orders[0].id}`]
      );
    }
    await client.query(
      "UPDATE purchase_orders SET status = 'received', received_at = now() WHERE id = $1",
      [orders[0].id]
    );
    await client.query("COMMIT");
    await audit(commerceId, "po.receive", "purchase_orders", orders[0].id);
    res.json({ ok: true, itemsReceived: items.length });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

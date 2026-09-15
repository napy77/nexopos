import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { requiereClaveErp } from "../middleware/erp-key.js";

/**
 * La API para el sistema del comercio: su ERP, Odoo, o lo que use.
 *
 * Existe para que NexoPOS no sea obligatorio. Un negocio con 3000 productos no
 * les va a poner precio a mano, y el que ya tiene un sistema andando no lo va a
 * tirar para usar el nuestro. Si el POS es la única puerta, esos comercios no
 * entran.
 *
 * Los productos se identifican por EAN o por código de balanza, que es lo que
 * un ERP tiene. El id nuestro también sirve, pero nadie lo conoce de antemano.
 */
export const erpRouter = Router();
erpRouter.use(requiereClaveErp);

const PAGE = 500;

/** GET /api/erp/v1/productos — lo que el comercio tiene, con precio y stock */
erpRouter.get("/productos", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const { rows } = await pool.query(
      `SELECT p.id, p.ean, p.plu AS sku, p.name AS nombre, p.unit AS unidad,
              s.sale_price AS precio, s.cost AS costo, s.quantity AS stock,
              s.min_stock AS stock_minimo, s.es_insumo, s.published_in_store,
              s.updated_at
         FROM stock_items s JOIN products p ON p.id = s.product_id
        WHERE s.commerce_id = $1
        ORDER BY p.id
        LIMIT $2 OFFSET $3`,
      [req.erp!.commerceId, PAGE, (page - 1) * PAGE]
    );
    const { rows: [t] } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM stock_items WHERE commerce_id = $1",
      [req.erp!.commerceId]
    );
    res.json({
      productos: rows.map((r) => ({
        id: String(r.id),
        ean: r.ean, sku: r.sku, nombre: r.nombre, unidad: r.unidad,
        // En centavos, enteros: es lo mismo que hacemos con NexoTienda y
        // evita que un float arrastre medio centavo por 3000 productos.
        precio_centavos: r.precio === null ? null : Math.round(Number(r.precio) * 100),
        costo_centavos: r.costo === null ? null : Math.round(Number(r.costo) * 100),
        stock: Number(r.stock),
        stock_minimo: Number(r.stock_minimo),
        es_insumo: r.es_insumo,
        publicado_en_tienda: r.published_in_store,
        actualizado: new Date(r.updated_at).toISOString(),
      })),
      page, pageSize: PAGE, total: t.n,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Cómo encontrar el producto que manda el ERP.
 *
 * Por EAN o por código de balanza, que es lo que un ERP tiene cargado. El id
 * nuestro sirve también, pero nadie lo conoce antes de la primera lectura.
 */
const referenciaSchema = z.object({
  id: z.string().optional(),
  ean: z.string().optional(),
  sku: z.string().optional(),
}).refine((r) => r.id || r.ean || r.sku, "Cada línea necesita id, ean o sku");

async function resolver(
  commerceId: number,
  ref: { id?: string; ean?: string; sku?: string }
): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT s.product_id FROM stock_items s JOIN products p ON p.id = s.product_id
      WHERE s.commerce_id = $1
        AND ( ($2::bigint IS NOT NULL AND p.id = $2)
           OR ($3::text   IS NOT NULL AND p.ean = $3)
           OR ($4::text   IS NOT NULL AND p.plu = $4 AND p.commerce_id = $1) )
      LIMIT 2`,
    [commerceId, ref.id ? Number(ref.id) : null, ref.ean ?? null, ref.sku ?? null]
  );
  // Dos coincidencias es un EAN repetido: no se adivina cuál es.
  return rows.length === 1 ? Number(rows[0].product_id) : null;
}

const preciosSchema = z.object({
  precios: z.array(referenciaSchema.and(z.object({
    precio_centavos: z.coerce.number().int().nonnegative(),
    costo_centavos: z.coerce.number().int().nonnegative().optional(),
  }))).min(1).max(1000),
});

/**
 * PUT /api/erp/v1/precios — precios de venta, de a mil.
 *
 * El precio de venta es el único número que el ERP puede pisar sin pensar: no
 * hay nadie más escribiéndolo. Con el stock no pasa lo mismo, ver abajo.
 */
erpRouter.put("/precios", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { precios } = preciosSchema.parse(req.body);
    const commerceId = req.erp!.commerceId;
    await client.query("BEGIN");

    let aplicados = 0;
    const noEncontrados: unknown[] = [];
    for (const l of precios) {
      const productId = await resolver(commerceId, l);
      if (!productId) { noEncontrados.push({ id: l.id, ean: l.ean, sku: l.sku }); continue; }
      await client.query(
        `UPDATE stock_items SET sale_price = $3,
                cost = COALESCE($4, cost), updated_at = now()
          WHERE commerce_id = $1 AND product_id = $2`,
        [commerceId, productId, l.precio_centavos / 100,
         l.costo_centavos === undefined ? null : l.costo_centavos / 100]
      );
      aplicados++;
    }
    await client.query("COMMIT");
    await audit(commerceId, "erp.precios", undefined, undefined, { aplicados });
    res.json({ aplicados, no_encontrados: noEncontrados });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

const stockSchema = z.object({
  /**
   * `absoluto` deja el stock en ese número. `ajuste` suma o resta.
   *
   * La diferencia no es de gusto y se paga cara: si el ERP manda absolutos
   * cada tanto y el mostrador vendió en el medio, el absoluto **pisa** esa
   * venta y devuelve unidades que ya no están. Con `ajuste` eso no puede
   * pasar, porque no reescribe: acumula.
   *
   * Absoluto sirve cuando el ERP es el único que mueve el stock, o justo
   * después de un inventario. Para el día a día de un negocio que además vende
   * por mostrador, el que corresponde es `ajuste` —y leer las ventas por
   * /ventas para saber qué descontar—.
   */
  modo: z.enum(["absoluto", "ajuste"]).default("ajuste"),
  stock: z.array(referenciaSchema.and(z.object({
    cantidad: z.coerce.number(),
  }))).min(1).max(1000),
});

/** PUT /api/erp/v1/stock */
erpRouter.put("/stock", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { modo, stock } = stockSchema.parse(req.body);
    const commerceId = req.erp!.commerceId;
    await client.query("BEGIN");

    let aplicados = 0;
    const noEncontrados: unknown[] = [];
    for (const l of stock) {
      const productId = await resolver(commerceId, l);
      if (!productId) { noEncontrados.push({ id: l.id, ean: l.ean, sku: l.sku }); continue; }

      /*
       * Se lee antes de escribir porque en el movimiento va lo que CAMBIÓ, no
       * lo que quedó: con `absoluto`, el ERP manda "dejalo en 12" y eso no es
       * un movimiento de 12 —si había 9, se movieron 3—. Registrar el número
       * final haría que la suma de los movimientos no dé el stock, y esa suma
       * es justo lo que alguien hace cuando un número no cuadra.
       *
       * El FOR UPDATE es para que una venta del mostrador en el medio no se
       * pierda entre la lectura y la escritura.
       */
      const { rows: [previo] } = await client.query(
        "SELECT quantity FROM stock_items WHERE commerce_id = $1 AND product_id = $2 FOR UPDATE",
        [commerceId, productId]
      );
      const antes = Number(previo.quantity);
      const despues = modo === "absoluto" ? l.cantidad : antes + l.cantidad;

      await client.query(
        `UPDATE stock_items SET quantity = $3, updated_at = now()
          WHERE commerce_id = $1 AND product_id = $2`,
        [commerceId, productId, despues]
      );
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'erp', $3, $4)`,
        [commerceId, productId, despues - antes, `ERP ${modo}`]
      );
      aplicados++;
    }
    await client.query("COMMIT");
    await audit(commerceId, "erp.stock", undefined, undefined, { modo, aplicados });
    res.json({ modo, aplicados, no_encontrados: noEncontrados });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/**
 * GET /api/erp/v1/ventas?desde=ISO — lo que se vendió por el mostrador.
 *
 * Es la mitad que falta del modelo de dos espejos. Un ERP que se cree dueño
 * del stock y no lea esto va a reescribir unidades que el cajero ya vendió: la
 * venta del mostrador no pasa por el ERP, pasa por acá.
 *
 * Incluye los pedidos de la tienda online entregados, porque terminan como
 * nota de venta igual que una venta del mostrador.
 */
erpRouter.get("/ventas", async (req, res, next) => {
  try {
    const desde = String(req.query.desde ?? "");
    if (!desde || Number.isNaN(Date.parse(desde))) {
      throw new HttpError(400, "Mandá `desde` con una fecha ISO: ?desde=2026-09-15T00:00:00Z");
    }
    const { rows } = await pool.query(
      `SELECT s.id, s.ticket_number, s.total, s.payment_method, s.created_at,
              s.refund_of IS NOT NULL AS es_reembolso,
              (SELECT json_agg(json_build_object(
                 'producto_id', i.product_id, 'ean', p.ean, 'sku', p.plu,
                 'nombre', p.name, 'cantidad', i.quantity,
                 'precio_centavos', ROUND(i.unit_price * 100)) ORDER BY i.id)
                 FROM sale_items i JOIN products p ON p.id = i.product_id
                WHERE i.sale_id = s.id) AS lineas
         FROM sales s
        WHERE s.commerce_id = $1 AND s.created_at > $2
        ORDER BY s.created_at
        LIMIT 1000`,
      [req.erp!.commerceId, desde]
    );
    res.json({
      ventas: rows.map((r) => ({
        id: String(r.id),
        ticket: Number(r.ticket_number),
        fecha: new Date(r.created_at).toISOString(),
        total_centavos: Math.round(Number(r.total) * 100),
        medio_pago: r.payment_method,
        // Un reembolso viene con cantidades negativas: es una venta al revés,
        // no un registro aparte que el ERP tenga que interpretar.
        es_reembolso: r.es_reembolso,
        lineas: r.lineas ?? [],
      })),
      // Hasta acá llegó esta página. La próxima llamada va con este `desde`.
      hasta: rows.length > 0 ? new Date(rows[rows.length - 1].created_at).toISOString() : desde,
      hay_mas: rows.length === 1000,
    });
  } catch (err) {
    next(err);
  }
});

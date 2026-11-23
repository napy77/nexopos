import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { requiereClaveErp } from "../middleware/erp-key.js";
import { aceptarPedido, avanzarPedido, cancelarPedido, cancelarSchema, type Quien } from "./pedidos.js";
import { iniciarImportacion, estadoImportacion, type FilaCruda } from "./importacion.js";

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

const altaSchema = z.object({
  productos: z.array(z.object({
    ean: z.string().optional(),
    nombre: z.string().optional(),
    unidad: z.string().optional(),
    precio_centavos: z.coerce.number().int().positive().optional(),
    costo_centavos: z.coerce.number().int().nonnegative().optional(),
    stock: z.coerce.number().nonnegative().optional(),
    stock_minimo: z.coerce.number().nonnegative().optional(),
  })).min(1).max(5000),
});

/**
 * POST /api/erp/v1/productos — alta masiva, de hasta cinco mil.
 *
 * Es el mismo motor que el CSV de la pantalla (modules/importacion.ts): busca
 * cada EAN en lo que el comercio ya tiene, después en el catálogo de NexoB2B,
 * y si no está lo da de alta como producto propio. El stock reemplaza.
 *
 * Contesta 202 con un id y sigue en segundo plano: buscar dos mil fichas en
 * NexoB2B tarda más de lo que una conexión aguanta abierta. El ERP pregunta
 * en qué quedó con GET /importaciones/:id. A diferencia de la pantalla, no
 * hay vista previa: se aplica sola cuando termina de analizar.
 */
erpRouter.post("/productos", async (req, res, next) => {
  try {
    const { productos } = altaSchema.parse(req.body);
    const filas: FilaCruda[] = productos.map((p) => ({
      ean: p.ean, nombre: p.nombre, unidad: p.unidad, precio: p.precio_centavos,
      costo: p.costo_centavos, stock: p.stock, stock_minimo: p.stock_minimo,
    }));
    const id = await iniciarImportacion(req.erp!.commerceId, filas, {
      origen: "api", enCentavos: true, autoAplicar: true,
    });
    res.status(202).json({ importacion_id: String(id), estado: "analizando" });
  } catch (err) {
    next(err);
  }
});

/** GET /api/erp/v1/importaciones/:id — en qué quedó un alta masiva */
erpRouter.get("/importaciones/:id", async (req, res, next) => {
  try {
    const e = await estadoImportacion(Number(req.params.id), req.erp!.commerceId, true);
    if (e.origen !== "api") throw new HttpError(404, "No existe esa importación");
    res.json({
      importacion_id: e.id, estado: e.estado, total: e.total, procesadas: e.procesadas,
      resumen: e.resumen, error: e.error, errores: e.errores,
    });
  } catch (err) {
    next(err);
  }
});

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
        // Marcado como manual: el ERP es la autoridad sobre ese precio y una
        // corrida de márgenes no tiene por qué discutirle.
        `UPDATE stock_items SET sale_price = $3, precio_manual = true,
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
 * nota de venta igual que una venta del mostrador. Esos traen `pedido_code`.
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
              COALESCE(o.code, ro.code) AS pedido_code,
              (SELECT json_agg(json_build_object(
                 'producto_id', i.product_id, 'ean', p.ean, 'sku', p.plu,
                 'nombre', p.name, 'cantidad', i.quantity,
                 'precio_centavos', ROUND(i.unit_price * 100)) ORDER BY i.id)
                 FROM sale_items i JOIN products p ON p.id = i.product_id
                WHERE i.sale_id = s.id) AS lineas
         FROM sales s
         LEFT JOIN orders o ON o.id = s.order_id
         -- El reembolso de una nota de pedido no tiene order_id propio: hereda
         -- el del ticket que devuelve, para que el ERP sepa qué pedido revierte.
         LEFT JOIN sales rs ON rs.id = s.refund_of
         LEFT JOIN orders ro ON ro.id = rs.order_id
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
        // null es mostrador. Con código, la venta es la nota de un pedido de la
        // tienda: un ERP que ya registró el pedido no la tiene que contar dos veces.
        pedido_code: r.pedido_code ?? null,
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

// ── Pedidos de la tienda online ─────────────────────────────────────────────
//
// Para el comercio que atiende los pedidos de NexoTienda desde la caja de su
// ERP. NexoPOS sigue siendo el dueño del pedido: la tienda no se entera de
// por dónde se movió, y los pasos corren por las mismas funciones que la
// pantalla de pedidos (modules/pedidos.ts). Ver RESPUESTA-PEDIDOS-ERP-A-NEXO-ODOO.md.

const PAGINA_PEDIDOS = 200;

/**
 * Cuánto se queda atrás el `hasta`. El `updated_at` es la hora en que empezó
 * la transacción, no la del COMMIT: cancelar un pedido pagado espera la
 * devolución de Mercado Pago antes de confirmar, y un ERP que
 * consultó en el medio corría el cursor por encima de un cambio que todavía
 * no veía. Con este margen lo vuelve a traer en la próxima vuelta; repetido no
 * molesta, porque se actualiza por `code`.
 */
const MARGEN_CURSOR = "2 minutes";

const SELECT_PEDIDO = `
  SELECT o.code, o.status, o.created_at, o.updated_at,
         to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor,
         o.slot_kind, o.slot_label, o.address, o.notes,
         o.payment_method, o.payment_status, o.payment_id,
         COALESCE(o.contact_name, c.name) AS contacto_nombre,
         COALESCE(o.contact_phone, c.phone) AS contacto_telefono,
         COALESCE(o.contact_email, c.email) AS contacto_email,
         o.customer_id, o.ready_estimate, o.cancel_reason, o.cancelled_by, o.review_reason,
         o.subtotal, o.fee, o.total, o.sale_id, s.ticket_number,
         (SELECT json_agg(json_build_object(
            'producto_id', l.product_id::text, 'ean', p.ean, 'sku', p.plu,
            'nombre', l.name, 'unidad', l.unit, 'cantidad', l.quantity,
            'precio_centavos', ROUND(l.unit_price * 100)) ORDER BY l.id)
            FROM order_lines l JOIN products p ON p.id = l.product_id
           WHERE l.order_id = o.id) AS lineas
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN sales s ON s.id = o.sale_id`;

const cent = (v: unknown): number => Math.round(Number(v) * 100);

function pedidoErp(r: Record<string, any>) {
  return {
    code: r.code,
    status: r.status,
    creado: new Date(r.created_at).toISOString(),
    // Con microsegundos: es el cursor. Recortado a milisegundos, `>` volvía a
    // traer el último pedido en cada consulta.
    actualizado: r.cursor,
    retiro: { tipo: r.slot_kind, franja: r.slot_label || null, direccion: r.address ?? null },
    pago: { medio: r.payment_method, estado: r.payment_status, id: r.payment_id ?? null },
    contacto: { nombre: r.contacto_nombre ?? null, telefono: r.contacto_telefono ?? null,
                email: r.contacto_email ?? null },
    // La libreta, con el mismo nombre que usa NexoTienda (`CLI-<id>`).
    cuenta_id: r.customer_id ? `CLI-${r.customer_id}` : null,
    notas: r.notes ?? null,
    listo_para: r.ready_estimate ?? null,
    motivo_cancelacion: r.cancel_reason ?? null,
    cancelado_por: r.cancelled_by ?? null,
    // Sólo mientras está recibido: después de aceptarlo ya lo miraron (igual
    // que `review` en /v1/orders).
    revision: r.review_reason && r.status === "recibido" ? { motivo: r.review_reason } : null,
    // La nota de venta que salió al entregarlo: es la que aparece en /ventas
    // con este mismo `pedido_code`.
    venta: r.sale_id ? { id: String(r.sale_id), ticket: Number(r.ticket_number) } : null,
    lineas: (r.lineas ?? []).map((l: Record<string, any>) => ({
      ...l, cantidad: Number(l.cantidad), precio_centavos: Number(l.precio_centavos),
    })),
    subtotal_centavos: cent(r.subtotal),
    cargo_centavos: cent(r.fee),
    total_centavos: cent(r.total),
  };
}

/**
 * GET /api/erp/v1/pedidos?actualizados_desde=ISO
 *
 * Los que cambiaron después de esa fecha, en cualquier estado. Sin la fecha,
 * los que están en curso: es la primera lectura, y un ERP que recién se
 * conecta no tiene por qué cargar el historial entero.
 */
erpRouter.get("/pedidos", async (req, res, next) => {
  try {
    const commerceId = req.erp!.commerceId;
    const desdeTxt = req.query.actualizados_desde === undefined ? null : String(req.query.actualizados_desde);
    if (desdeTxt !== null && Number.isNaN(Date.parse(desdeTxt))) {
      throw new HttpError(400, "`actualizados_desde` tiene que ser una fecha ISO: ?actualizados_desde=2026-11-23T00:00:00Z");
    }
    const { rows } = await pool.query(
      `${SELECT_PEDIDO}
        WHERE o.commerce_id = $1
          AND CASE WHEN $2::timestamptz IS NULL
                   THEN o.status IN ('recibido','aceptado','listo','en_camino')
                   ELSE o.updated_at > $2::timestamptz END
        ORDER BY o.updated_at, o.id
        LIMIT $3`,
      [commerceId, desdeTxt, PAGINA_PEDIDOS]
    );
    const hayMas = rows.length === PAGINA_PEDIDOS;

    // El `hasta` no pasa de «ahora menos el margen» (ver MARGEN_CURSOR), ni
    // vuelve atrás de lo que mandó el ERP. Con página llena va el último, o
    // la paginación no avanzaría.
    const { rows: [t] } = await pool.query(
      `SELECT to_char(GREATEST(
                COALESCE($1::timestamptz, '-infinity'),
                CASE WHEN $3::boolean THEN $2::timestamptz
                     ELSE LEAST(COALESCE($2::timestamptz, 'infinity'), now() - $4::interval) END
              ) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS hasta`,
      [desdeTxt, rows.length ? rows[rows.length - 1].cursor : null, hayMas, MARGEN_CURSOR]
    );
    res.json({ pedidos: rows.map(pedidoErp), hasta: t.hasta, hay_mas: hayMas });
  } catch (err) {
    next(err);
  }
});

async function pedidoPorCode(commerceId: number, code: string) {
  const { rows } = await pool.query(
    `${SELECT_PEDIDO} WHERE o.commerce_id = $1 AND o.code = $2`,
    [commerceId, String(code).trim().toUpperCase()]
  );
  if (!rows[0]) throw new HttpError(404, "No existe ese pedido en este comercio", "pedido_inexistente");
  return rows[0];
}

/** GET /api/erp/v1/pedidos/:code — uno solo, con la misma forma */
erpRouter.get("/pedidos/:code", async (req, res, next) => {
  try {
    res.json(pedidoErp(await pedidoPorCode(req.erp!.commerceId, req.params.code)));
  } catch (err) {
    next(err);
  }
});

/*
 * Mover el pedido. Por `code`, que es lo que ve el comprador y lo que guarda
 * el ERP; el id interno se resuelve acá, siempre dentro del comercio de la
 * clave.
 *
 * Repetir un paso ya dado contesta 200 con el pedido: el ERP reintenta
 * cuando se le corta la red y tiene que poder saber que el primero llegó.
 * Un paso que no corresponde es 409 con el `status` actual al lado.
 */
const desdeErp = (keyId: number): Quien => ({ via: "erp", operadoPor: null, idempotente: true, keyId });

function moverDesdeErp(mover: (commerceId: number, id: number, body: unknown, quien: Quien) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const commerceId = req.erp!.commerceId;
      const { rows: [o] } = await pool.query(
        "SELECT id FROM orders WHERE commerce_id = $1 AND code = $2",
        [commerceId, String(req.params.code).trim().toUpperCase()]
      );
      if (!o) throw new HttpError(404, "No existe ese pedido en este comercio", "pedido_inexistente");
      await mover(commerceId, Number(o.id), req.body ?? {}, desdeErp(req.erp!.keyId));
      res.json(pedidoErp(await pedidoPorCode(commerceId, req.params.code)));
    } catch (err) {
      next(err);
    }
  };
}

erpRouter.post("/pedidos/:code/aceptar", moverDesdeErp((c, id, body, q) => {
  const listoPara = String((body as { listo_para?: unknown }).listo_para ?? "").trim();
  if (!listoPara) {
    throw new HttpError(400, "Mandá `listo_para`: para cuándo lo tienen, en palabras («30 minutos», «mañana a las 10»). Es lo que el comprador ve.", "falta_listo_para");
  }
  return aceptarPedido(c, id, listoPara, q);
}));
erpRouter.post("/pedidos/:code/listo", moverDesdeErp((c, id, _b, q) => avanzarPedido(c, id, "listo", q)));
erpRouter.post("/pedidos/:code/en-camino", moverDesdeErp((c, id, _b, q) => avanzarPedido(c, id, "en_camino", q)));
erpRouter.post("/pedidos/:code/entregado", moverDesdeErp((c, id, _b, q) => avanzarPedido(c, id, "entregado", q)));
erpRouter.post("/pedidos/:code/cancelar", moverDesdeErp((c, id, body, q) =>
  cancelarPedido(c, id, cancelarSchema.parse(body).motivo, q)));

import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { sesionAbierta } from "./caja.js";
import { descontarCupo } from "./disponibilidad.js";
import { periodoAbierto } from "./cuenta-corriente.js";
import { encolarMovimiento } from "./clubpay-outbox.js";
import { encolarEvento, type EventoPedido } from "./webhooks.js";
import { armarOrder } from "./v1-pedidos.js";

/**
 * Los pedidos, desde el mostrador.
 *
 * El modo de falla que hay que evitar no es que el comerciante no se entere:
 * es que se entere, no haga nada en cuarenta minutos, y el que pidió no sepa si
 * va o no va. Nadie se enoja porque tarde una hora si se lo dijeron.
 *
 * Por eso aceptar y declarar para cuándo lo tiene es un solo gesto, y el tiempo
 * lo dice él: la plataforma nunca promete sobre el trabajo de otro.
 */
export const pedidosPosRouter = Router();

const PASOS: Record<string, string[]> = {
  recibido: ["aceptado", "cancelado"],
  aceptado: ["listo", "cancelado"],
  listo: ["en_camino", "entregado", "cancelado"],
  en_camino: ["entregado", "cancelado"],
  entregado: [],
  cancelado: [],
};

async function traer(commerceId: number, id: number) {
  const { rows } = await pool.query(
    "SELECT * FROM orders WHERE id = $1 AND commerce_id = $2",
    [id, commerceId]
  );
  if (!rows[0]) throw new HttpError(404, "No existe ese pedido");
  return rows[0];
}

/** GET /api/pedidos — los que están en curso, y los últimos cerrados */
pedidosPosRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.code, o.status, o.total, o.slot_label, o.slot_kind, o.address,
              o.payment_method, o.payment_status, o.ready_estimate, o.notes,
              o.contact_name, o.contact_phone, o.created_at, o.cancel_reason,
              c.name AS customer_name,
              (SELECT json_agg(json_build_object('name', l.name, 'quantity', l.quantity,
                                                 'unitPrice', l.unit_price) ORDER BY l.id)
                 FROM order_lines l WHERE l.order_id = o.id) AS lines
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.commerce_id = $1
        ORDER BY (o.status IN ('recibido','aceptado','listo','en_camino')) DESC, o.created_at DESC
        LIMIT 60`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/pedidos/:id/aceptar
 *
 * Acá el comercio se compromete, y por eso acá se descuenta el stock: antes no
 * se movió nada, porque un pedido que le llegó y todavía no miró no puede
 * dejarle el inventario en un número que no refleja lo que hay en la góndola.
 */
pedidosPosRouter.post("/:id/aceptar", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const readyEstimate = String(req.body?.readyEstimate ?? "").trim();
    if (!readyEstimate) {
      throw new HttpError(400, "Decile para cuándo lo tenés: es lo que el cliente está esperando saber.");
    }
    const commerceId = req.auth.commerceId;
    const id = Number(req.params.id);
    const pedido = await traer(commerceId, id);
    if (!PASOS[pedido.status].includes("aceptado")) {
      throw new HttpError(409, `Este pedido ya está ${pedido.status}.`);
    }

    await client.query("BEGIN");
    const { rows: lineas } = await client.query(
      "SELECT product_id, quantity FROM order_lines WHERE order_id = $1", [id]
    );
    for (const l of lineas) {
      const { rows } = await client.query(
        "SELECT availability_policy FROM stock_items WHERE commerce_id = $1 AND product_id = $2 FOR UPDATE",
        [commerceId, l.product_id]
      );
      // Como en el mostrador: no se frena por falta de stock. El conteo puede
      // estar atrasado y el que sabe si están es el que va a buscarlos.
      if (rows[0]?.availability_policy === "declared") {
        await descontarCupo(client, commerceId, Number(l.product_id), Number(l.quantity));
      } else {
        await client.query(
          "UPDATE stock_items SET quantity = quantity - $3, updated_at = now() WHERE commerce_id = $1 AND product_id = $2",
          [commerceId, l.product_id, l.quantity]
        );
      }
      // El movimiento queda donde se movió la mercadería —al aceptar— y no al
      // entregar: si no, el inventario cambia sin que nada lo explique.
      await client.query(
        `INSERT INTO stock_movements (commerce_id, product_id, type, quantity, reference)
         VALUES ($1, $2, 'sale', $3, $4)`,
        [commerceId, l.product_id, -Number(l.quantity), `PEDIDO-${pedido.code}`]
      );
    }
    await client.query(
      "UPDATE orders SET status = 'aceptado', ready_estimate = $2, updated_at = now() WHERE id = $1",
      [id, readyEstimate]
    );
    await encolarEvento(client, commerceId, id, "order.aceptado", await armarOrder(id, client));
    await client.query("COMMIT");
    await audit(commerceId, "pedido.aceptado", "orders", id, { readyEstimate });
    res.json({ ok: true, status: "aceptado", readyEstimate });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/*
 * Una ruta por paso, en vez de una genérica `/:id/:paso`.
 *
 * La genérica se comía `/:id/cancelar`: Express la matcheaba primero con
 * paso="cancelar", contestaba "paso desconocido" y la cancelación no corría
 * —dejando el stock descontado de un pedido que nadie iba a entregar—. Rutas
 * explícitas no se pisan entre ellas.
 */
function avanzar(paso: "listo" | "en_camino" | "entregado") {
  return async (req: Parameters<Parameters<typeof pedidosPosRouter.post>[1]>[0],
                res: Parameters<Parameters<typeof pedidosPosRouter.post>[1]>[1],
                next: Parameters<Parameters<typeof pedidosPosRouter.post>[1]>[2]) => {
  const client = await pool.connect();
  try {
    const commerceId = req.auth.commerceId;
    const id = Number(req.params.id);
    const pedido = await traer(commerceId, id);
    if (!PASOS[pedido.status].includes(paso)) {
      throw new HttpError(409, `Un pedido ${pedido.status} no puede pasar a ${paso}.`);
    }
    if (paso === "en_camino" && pedido.slot_kind !== "reparto") {
      throw new HttpError(409, "Este pedido es para retirar, no sale a la calle.");
    }

    await client.query("BEGIN");
    await client.query("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1", [id, paso]);

    /*
     * Entregado es donde el pedido se convierte en venta: ahí entró la plata.
     * Antes no, porque un pedido aceptado todavía puede cancelarse y una nota
     * de venta que se borra no es una nota de venta.
     */
    if (paso === "entregado") await emitirNotaDeVenta(client, commerceId, pedido);

    await encolarEvento(client, commerceId, id, `order.${paso}` as EventoPedido,
      await armarOrder(id, client));
    await client.query("COMMIT");
    await audit(commerceId, `pedido.${paso}`, "orders", id);
    res.json({ ok: true, status: paso });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
  };
}

pedidosPosRouter.post("/:id/listo", avanzar("listo"));
pedidosPosRouter.post("/:id/en-camino", avanzar("en_camino"));
pedidosPosRouter.post("/:id/entregado", avanzar("entregado"));

const cancelarSchema = z.object({
  motivo: z.string().trim().min(1).max(400),
});

/**
 * POST /api/pedidos/:id/cancelar
 *
 * El motivo es texto libre del comerciante, no un código nuestro. "No me quedan
 * de ananá, tengo de muzzarella y napolitana; pasá igual y te las hago"
 * mantiene la venta y la relación. "Pedido cancelado: sin stock" las corta las
 * dos, y la plataforma no arbitra: acerca a las dos personas.
 */
pedidosPosRouter.post("/:id/cancelar", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { motivo } = cancelarSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    const id = Number(req.params.id);
    const pedido = await traer(commerceId, id);
    if (!PASOS[pedido.status].includes("cancelado")) {
      throw new HttpError(409, `Este pedido ya está ${pedido.status}.`);
    }

    await client.query("BEGIN");
    // Si ya se había aceptado, el stock estaba descontado y vuelve
    if (["aceptado", "listo", "en_camino"].includes(pedido.status)) {
      const { rows: lineas } = await client.query(
        "SELECT product_id, quantity FROM order_lines WHERE order_id = $1", [id]
      );
      for (const l of lineas) {
        await client.query(
          `UPDATE stock_items SET quantity = quantity + $3, updated_at = now()
            WHERE commerce_id = $1 AND product_id = $2 AND availability_policy = 'stock'`,
          [commerceId, l.product_id, l.quantity]
        );
      }
    }
    await client.query(
      `UPDATE orders SET status = 'cancelado', cancel_reason = $2,
              cancelled_by = 'comercio', updated_at = now() WHERE id = $1`,
      [id, motivo]
    );
    await encolarEvento(client, commerceId, id, "order.cancelado", await armarOrder(id, client));
    await client.query("COMMIT");
    await audit(commerceId, "pedido.cancelado", "orders", id, { motivo });
    res.json({ ok: true, status: "cancelado" });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/**
 * El pedido entregado aterriza como nota de venta: mismo stock, misma caja,
 * misma cuenta corriente que una venta del mostrador. Es lo correcto —el
 * comercio no lleva dos contabilidades— y es lo que hace que el arqueo cierre.
 *
 * El stock no se vuelve a tocar: ya se descontó al aceptar.
 */
async function emitirNotaDeVenta(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  commerceId: number,
  pedido: Record<string, unknown>
): Promise<void> {
  const METODO: Record<string, string> = {
    efectivo_entrega: "cash", online: "online", cuenta_corriente: "account",
  };
  const metodo = METODO[String(pedido.payment_method)] ?? "cash";
  const total = Number(pedido.total);

  /*
   * La sesión de caja, si hay una abierta. Si no la hay —un reparto que se
   * entrega a las diez de la noche, con el local cerrado— la venta queda sin
   * sesión: el arqueo dice qué hay en el cajón, y eso no entró al cajón de
   * ningún turno. Se ve igual en los reportes del día.
   */
  const sesion = await sesionAbierta(commerceId, client as never);

  const { rows: [{ next_number }] } = await client.query(
    "SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next_number FROM sales WHERE commerce_id = $1",
    [commerceId]
  );
  const { rows: [venta] } = await client.query(
    `INSERT INTO sales (commerce_id, ticket_number, customer_id, payment_method,
                        subtotal, discount, total, cash_session_id, order_id)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8) RETURNING id, ticket_number`,
    [commerceId, next_number, pedido.customer_id ?? null, metodo,
     Number(pedido.subtotal), total, sesion?.id ?? null, pedido.id]
  );

  const { rows: lineas } = await client.query(
    "SELECT product_id, quantity, unit_price FROM order_lines WHERE order_id = $1",
    [pedido.id]
  );
  for (const l of lineas) {
    await client.query(
      "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,$4)",
      [venta.id, l.product_id, l.quantity, l.unit_price]
    );
  }
  await client.query(
    "INSERT INTO sale_payments (commerce_id, sale_id, method, amount) VALUES ($1,$2,$3,$4)",
    [commerceId, venta.id, metodo, total]
  );

  // Si fue a la libreta, el movimiento sale de esta nota como de cualquier
  // otra venta fiada, y cae en el período abierto del cliente.
  if (pedido.customer_id) {
    const customerId = Number(pedido.customer_id);
    const periodo = await periodoAbierto(client as never, commerceId, customerId);
    const { rows: [mov] } = await client.query(
      `INSERT INTO customer_transactions (commerce_id, customer_id, type, amount, sale_id, note, period_id)
       VALUES ($1,$2,'sale_credit',$3,$4,$5,$6) RETURNING id`,
      [commerceId, customerId, total, venta.id, `Pedido ${pedido.code}`, periodo.id]
    );
    await client.query("UPDATE customers SET balance = balance + $1 WHERE id = $2", [total, customerId]);
    await encolarMovimiento(client as never, {
      commerceId, customerId, transactionId: Number(mov.id),
      kind: "compra", amount: total, description: `Pedido ${pedido.code}`,
    });
  }

  await client.query("UPDATE orders SET sale_id = $2 WHERE id = $1", [pedido.id, venta.id]);
}

import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { config } from "../config.js";

/**
 * Los avisos hacia NexoTienda.
 *
 * Contrato en docs/PEDIDO-WEBHOOKS-A-NEXOTIENDA.md.
 *
 * Va el pedido entero y no solo lo que cambió: así la tienda no tiene que
 * volver a preguntarnos para pintar la pantalla, y un aviso que llega tarde
 * igual trae el estado con el que salió.
 */

/** 1min, 5min, 15min, 1h, y de ahí cada 6h */
const esperaMinutos = (intentos: number): number => [1, 5, 15, 60][intentos] ?? 360;
const MAX_INTENTOS = 12;

export type EventoPedido =
  | "order.aceptado" | "order.listo" | "order.en_camino"
  | "order.entregado" | "order.cancelado";

/**
 * Encola un aviso. Se llama DENTRO de la transacción que cambia el estado, con
 * el mismo client: si el pedido quedó aceptado, el aviso existe.
 *
 * El `order` se arma acá y no al enviar, a propósito: el evento tiene que
 * contar lo que pasó en ese momento, no lo que sea cierto cuando la red
 * finalmente ande.
 */
export async function encolarEvento(
  client: PoolClient,
  commerceId: number,
  orderId: number,
  event: EventoPedido,
  order: unknown
): Promise<void> {
  await client.query(
    `INSERT INTO webhook_outbox (commerce_id, order_id, event, payload)
     VALUES ($1, $2, $3, $4)`,
    [commerceId, orderId, event, { event, occurred_at: new Date().toISOString(), order }]
  );
}

/** Manda los pendientes. Devuelve cuántos salieron. */
export async function despacharWebhooks(): Promise<number> {
  const { url, secret } = config.nexotiendaWebhook;
  // Sin URL no se descartan: se quedan en la cola y salen cuando se configure.
  if (!url) return 0;

  const { rows } = await pool.query(
    `SELECT id, payload, intentos FROM webhook_outbox
      WHERE enviado_at IS NULL AND intentos < $1 AND proximo_intento <= now()
      ORDER BY id LIMIT 50`,
    [MAX_INTENTOS]
  );

  let enviados = 0;
  for (const fila of rows) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        // El id del evento sale de la fila: es lo que le permite a NexoTienda
        // descartar el repetido si un reintento llega después de uno que sí
        // había entrado.
        body: JSON.stringify({ ...fila.payload, event_id: `evt-${fila.id}` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`NexoTienda contestó ${res.status}`);
      await pool.query("UPDATE webhook_outbox SET enviado_at = now() WHERE id = $1", [fila.id]);
      enviados++;
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      const intentos = fila.intentos + 1;
      await pool.query(
        `UPDATE webhook_outbox
            SET intentos = $1, ultimo_error = $2,
                proximo_intento = now() + ($3 || ' minutes')::interval
          WHERE id = $4`,
        [intentos, detalle.slice(0, 400), esperaMinutos(intentos), fila.id]
      );
      if (intentos >= MAX_INTENTOS) {
        console.error(`[webhook] evt-${fila.id} abandonado tras ${intentos} intentos: ${detalle}`);
      }
    }
  }
  return enviados;
}

export function iniciarWebhooks(): void {
  if (!config.nexotiendaWebhook.url) {
    console.log("[webhook] NEXOTIENDA_WEBHOOK_URL sin configurar: los avisos se acumulan en la cola");
  }
  setInterval(() => {
    despacharWebhooks().catch((err) => console.error("[webhook]", err));
  }, 15_000).unref();
}

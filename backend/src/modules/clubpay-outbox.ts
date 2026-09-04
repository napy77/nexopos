import type { PoolClient } from "pg";
import { pool } from "../db.js";
import {
  aCentavos,
  empujarMovimiento,
  isMockMode,
  vinculacionAceptada,
  type MovimientoKind,
} from "../integrations/clubpay.js";

/**
 * Cola de avisos hacia ClubPay.
 *
 * El problema que resuelve: el aviso no puede hacer fallar una venta —un
 * problema de red de ClubPay no puede dejar a un cajero sin poder cobrar— pero
 * tampoco puede perderse, porque entonces la app le muestra al cliente un saldo
 * que no es.
 *
 * La cola es lo que hace ciertas las dos cosas a la vez: la fila se escribe en
 * la misma transacción que el movimiento, así que si la venta quedó guardada el
 * aviso existe; y la llamada por red pasa después, afuera, donde puede fallar
 * sin arrastrar nada.
 */

/** El id que ve ClubPay. Deriva del movimiento, así el reintento no duplica. */
const movementId = (transactionId: number): string => `nexopos-mov-${transactionId}`;

/**
 * Después de 12 intentos dejamos de reintentar. Con el backoff de abajo son
 * casi dos días: si en dos días no entró, no es un corte de red y seguir
 * golpeando no lo va a arreglar. La fila queda sin enviar a propósito, para
 * que se pueda ver qué pasó.
 */
const MAX_INTENTOS = 12;

/** 1min, 5min, 15min, 1h, y de ahí en adelante cada 6h */
function esperaMinutos(intentos: number): number {
  const escala = [1, 5, 15, 60];
  return escala[intentos] ?? 360;
}

interface Aviso {
  commerceId: number;
  customerId: number;
  transactionId: number;
  kind: MovimientoKind;
  /** En pesos y con signo: positivo aumenta la deuda, negativo la baja */
  amount: number;
  description: string;
}

/**
 * Encola un movimiento. Se llama DENTRO de la transacción que lo genera,
 * pasándole el mismo client.
 *
 * No encola si la persona no aceptó la vinculación. Es una regla de ClubPay y
 * es la correcta: hasta que confirma, lo único que tienen de ella es el DNI con
 * el que se le propuso. Mandarle movimientos antes sería contarle a ClubPay lo
 * que compra alguien que nunca dijo que sí.
 *
 * La consecuencia es que la persona ve su cuenta desde que acepta en adelante,
 * no hacia atrás.
 */
export async function encolarMovimiento(client: PoolClient, aviso: Aviso): Promise<void> {
  const { rows } = await client.query(
    "SELECT clubpay_status FROM customers WHERE id = $1",
    [aviso.customerId]
  );
  if (!vinculacionAceptada(rows[0]?.clubpay_status)) return;

  const payload = {
    external_id: `CLI-${aviso.customerId}`,
    movement_id: movementId(aviso.transactionId),
    kind: aviso.kind,
    amount_cents: aCentavos(aviso.amount),
    occurred_at: new Date().toISOString(),
    description: aviso.description,
  };

  await client.query(
    `INSERT INTO clubpay_outbox (commerce_id, transaction_id, payload)
     VALUES ($1, $2, $3) ON CONFLICT (transaction_id) DO NOTHING`,
    [aviso.commerceId, aviso.transactionId, payload]
  );
}

/** Manda los que estén vencidos. Devuelve cuántos salieron bien. */
export async function despacharPendientes(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT o.id, o.payload, o.intentos, c.clubpay_api_key
       FROM clubpay_outbox o
       JOIN commerces c ON c.id = o.commerce_id
      WHERE o.enviado_at IS NULL
        AND o.intentos < $1
        AND o.proximo_intento <= now()
      ORDER BY o.id
      LIMIT 50`,
    [MAX_INTENTOS]
  );

  let enviados = 0;
  for (const fila of rows) {
    try {
      await empujarMovimiento(fila.clubpay_api_key ?? "", fila.payload);
      await pool.query("UPDATE clubpay_outbox SET enviado_at = now() WHERE id = $1", [fila.id]);
      enviados++;
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      const intentos = fila.intentos + 1;
      await pool.query(
        `UPDATE clubpay_outbox
            SET intentos = $1, ultimo_error = $2,
                proximo_intento = now() + ($3 || ' minutes')::interval
          WHERE id = $4`,
        [intentos, detalle.slice(0, 400), esperaMinutos(intentos), fila.id]
      );
      if (intentos >= MAX_INTENTOS) {
        console.error(
          `[clubpay] movimiento ${fila.payload.movement_id} abandonado tras ${intentos} intentos: ${detalle}`
        );
      }
    }
  }
  return enviados;
}

/**
 * Arranca el worker. Un intervalo alcanza: son pocos movimientos y llegar unos
 * segundos tarde no le cambia nada a nadie.
 */
export function iniciarOutbox(): void {
  if (isMockMode()) {
    console.log("[clubpay] modo mock: los movimientos de cuenta corriente se loguean, no se envían");
  }
  setInterval(() => {
    despacharPendientes().catch((err) => console.error("[clubpay] outbox:", err));
  }, 15_000).unref();
}

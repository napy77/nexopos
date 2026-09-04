import type { PoolClient } from "pg";
import { pool } from "../db.js";
import {
  aCentavos,
  empujarMovimiento,
  isMockMode,
  vincularCliente,
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

  // Y cada minuto se fija si alguno de los que estaban esperando ya aceptó.
  // El filtro por clubpay_checked_at hace que a cada cliente se le pregunte
  // cada MINUTOS_ENTRE_CONSULTAS, no una vez por minuto.
  setInterval(() => {
    refrescarPendientes().catch((err) => console.error("[clubpay] vinculaciones:", err));
  }, 60_000).unref();
}

// ── Enterarse de que la persona aceptó ──────────────────────────────────────

/**
 * ClubPay no avisa cuando alguien acepta la vinculación: la persona toca
 * "aceptar" en su teléfono y de este lado no pasa nada. Si nadie vuelve a
 * preguntar, el POS se queda creyendo que sigue pendiente y deja de mandarle
 * los movimientos —que es justo lo que la persona acaba de pedir ver—.
 *
 * Así que se pregunta solo, cada tanto, por los que están en "propuesta".
 */
const MINUTOS_ENTRE_CONSULTAS = 10;

/**
 * Cuánto para atrás se recuperan los movimientos al aceptar.
 *
 * No es la historia completa: es la ventana donde pudo perderse algo por esta
 * misma demora —la persona ya había aceptado en su teléfono y el POS todavía
 * no se había enterado—. Volcarle un año de fiado a alguien que recién vincula
 * sería otra cosa, y nadie la pidió.
 */
const DIAS_A_RECUPERAR = 30;

/**
 * Vuelve a preguntarle a ClubPay en qué quedó la vinculación de un cliente.
 * Devuelve el estado nuevo, o null si no se pudo consultar.
 *
 * Nunca lanza: se llama desde pantallas y desde el worker, y en ninguno de los
 * dos lados un problema de red de ClubPay puede romper lo que se estaba
 * haciendo.
 */
export async function refrescarVinculacion(
  commerceId: number,
  customerId: number
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT c.doc_number, c.clubpay_status, co.clubpay_api_key
       FROM customers c JOIN commerces co ON co.id = c.commerce_id
      WHERE c.id = $1 AND c.commerce_id = $2`,
    [customerId, commerceId]
  );
  const cliente = rows[0];
  if (!cliente?.doc_number) return null;

  try {
    const r = await vincularCliente(cliente.clubpay_api_key ?? "", {
      dni: cliente.doc_number,
      externalId: `CLI-${customerId}`,
    });
    await pool.query(
      "UPDATE customers SET clubpay_status = $1, clubpay_checked_at = now() WHERE id = $2",
      [r.status, customerId]
    );
    // Recién aceptada: lo que se vendió mientras esperábamos no se había
    // encolado, y sin esto no lo vería nunca.
    if (!vinculacionAceptada(cliente.clubpay_status) && vinculacionAceptada(r.status)) {
      const recuperados = await recuperarMovimientos(commerceId, customerId);
      if (recuperados > 0) {
        console.log(`[clubpay] CLI-${customerId} aceptó: se recuperaron ${recuperados} movimientos`);
      }
    }
    return r.status;
  } catch (err) {
    console.error("[clubpay] no se pudo consultar la vinculación:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Encola los movimientos recientes que quedaron sin avisar */
async function recuperarMovimientos(commerceId: number, customerId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT t.id, t.type, t.amount, t.note, t.created_at
       FROM customer_transactions t
       LEFT JOIN clubpay_outbox o ON o.transaction_id = t.id
      WHERE t.customer_id = $1 AND t.commerce_id = $2
        AND o.id IS NULL
        AND t.created_at > now() - ($3 || ' days')::interval
      ORDER BY t.created_at`,
    [customerId, commerceId, DIAS_A_RECUPERAR]
  );

  for (const t of rows) {
    const amount = Number(t.amount);
    await pool.query(
      `INSERT INTO clubpay_outbox (commerce_id, transaction_id, payload)
       VALUES ($1, $2, $3) ON CONFLICT (transaction_id) DO NOTHING`,
      [commerceId, t.id, {
        external_id: `CLI-${customerId}`,
        movement_id: movementId(t.id),
        kind: kindDeTransaccion(t.type, amount),
        amount_cents: aCentavos(amount),
        // La fecha real del movimiento, no la de ahora: la app los ordena por
        // esto y si mintiéramos aparecerían todos juntos al final.
        occurred_at: new Date(t.created_at).toISOString(),
        description: t.note ?? "",
      }]
    );
  }
  return rows.length;
}

/** El tipo de NexoPOS al `kind` de ClubPay. El signo lo lleva el importe. */
function kindDeTransaccion(type: string, amount: number): MovimientoKind {
  if (type === "payment") return "pago";
  if (type === "sale_credit") return amount >= 0 ? "compra" : "devolucion";
  return amount < 0 ? "devolucion" : "ajuste";
}

/** Repasa los que están esperando respuesta de la persona */
export async function refrescarPendientes(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, commerce_id FROM customers
      WHERE clubpay_status = 'propuesta'
        AND doc_number IS NOT NULL
        AND (clubpay_checked_at IS NULL
             OR clubpay_checked_at < now() - ($1 || ' minutes')::interval)
      LIMIT 25`,
    [MINUTOS_ENTRE_CONSULTAS]
  );
  for (const c of rows) {
    await refrescarVinculacion(Number(c.commerce_id), Number(c.id));
  }
}

import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { hoy, partes, diaDelMes, correrMes, sumarDias, etiquetaPeriodo, ZONA } from "../lib/fechas.js";

type Ejecutor = PoolClient | typeof pool;

/**
 * La cuenta corriente como una pila de períodos.
 *
 * Lo que se está digitalizando no es una deuda, es una relación: el fiado de
 * pueblo funciona por vergüenza y proximidad, no por contrato. El almacenero
 * sabe que Juan cobra el 10 y lo espera, y esa flexibilidad es el producto. Por
 * eso el modelo tiene que dar más instrumentos de flexibilidad, no menos.
 *
 * Dos reglas que sostienen todo lo demás:
 *
 * - **El cierre congela.** Un resumen cerrado no cambia más aunque después
 *   aparezca algo. Un documento que se mueve no se puede pagar ni discutir.
 * - **El mes en curso no se suma con los cerrados.** Son dos objetos distintos:
 *   lo que ya se debe y lo que todavía está pasando. $87.000 de este mes es un
 *   buen cliente con familia grande; $87.000 de hace tres meses es un problema.
 *   Mismo número, significados opuestos.
 */

/** Cómo se llama este resumen para ClubPay */
export const statementId = (periodId: number): string => `nexopos-per-${periodId}`;

export interface Periodo {
  id: number;
  label: string;
  status: "abierto" | "cerrado" | "pagado_parcial" | "pagado";
  periodStart: string;
  periodEnd: string;
  closedAt: string | null;
  dueDate: string | null;
  total: number;
  paid: number;
}

/** Los límites del ciclo que contiene a `fecha`, para un cierre el día `cierre` */
export function cicloDe(fecha: string, cierre: number): { desde: string; hasta: string } {
  const { anio, mes, dia } = partes(fecha);
  // El período termina el día de cierre. Si hoy ya pasó ese día, el ciclo
  // corriente es el que cierra el mes que viene.
  const cierreEsteMes = diaDelMes(anio, mes, cierre);
  if (fecha <= cierreEsteMes) {
    const ant = correrMes(anio, mes, -1);
    return { desde: sumarDias(diaDelMes(ant.anio, ant.mes, cierre), 1), hasta: cierreEsteMes };
  }
  const sig = correrMes(anio, mes, 1);
  return { desde: sumarDias(cierreEsteMes, 1), hasta: diaDelMes(sig.anio, sig.mes, cierre) };
}

/**
 * Cuándo vence un resumen que cerró el `hasta`.
 *
 * Si el día de vencimiento es posterior al de cierre, vence el mismo mes; si no,
 * el siguiente. Así "cierra el 28 y vence el 5" significa lo que parece.
 */
export function vencimientoDe(hasta: string, cierre: number, vence: number): string {
  const { anio, mes } = partes(hasta);
  if (vence > cierre) return diaDelMes(anio, mes, vence);
  const sig = correrMes(anio, mes, 1);
  return diaDelMes(sig.anio, sig.mes, vence);
}

interface ConfigCierre { closing_day: number; due_day: number }

async function configDe(db: Ejecutor, commerceId: number): Promise<ConfigCierre> {
  const { rows } = await db.query(
    "SELECT closing_day, due_day FROM commerces WHERE id = $1",
    [commerceId]
  );
  return { closing_day: Number(rows[0]?.closing_day ?? 31), due_day: Number(rows[0]?.due_day ?? 10) };
}

/**
 * Devuelve el período abierto del cliente, cerrando antes los que ya vencieron.
 *
 * Se llama antes de anotar cualquier movimiento y al mostrar la cuenta. El
 * cierre pasa acá y no en una tarea nocturna porque una tarea que no corrió
 * deja movimientos de septiembre cayendo en el resumen de agosto —y ese resumen
 * ya se le mostró a alguien—. Mirando la fecha, el corte es correcto aunque el
 * servidor haya estado apagado una semana.
 */
export async function periodoAbierto(
  db: Ejecutor,
  commerceId: number,
  customerId: number
): Promise<Periodo> {
  const cfg = await configDe(db, commerceId);
  const ciclo = cicloDe(hoy(), cfg.closing_day);

  const { rows } = await db.query(
    `SELECT * FROM account_periods
      WHERE commerce_id = $1 AND customer_id = $2 AND status = 'abierto'`,
    [commerceId, customerId]
  );
  const abierto = rows[0];
  if (abierto) {
    const fin = new Date(abierto.period_end).toISOString().slice(0, 10);
    if (fin >= ciclo.hasta) return aPeriodo(abierto);
    // Se pasó de fecha: se cierra y se abre el que corresponde a hoy
    await cerrarPeriodo(db, Number(abierto.id), cfg);
  }

  const { rows: creados } = await db.query(
    `INSERT INTO account_periods (commerce_id, customer_id, period_start, period_end, label)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (commerce_id, customer_id) WHERE status = 'abierto' DO NOTHING
     RETURNING *`,
    [commerceId, customerId, ciclo.desde, ciclo.hasta, etiquetaPeriodo(ciclo.desde, ciclo.hasta)]
  );
  if (creados[0]) return aPeriodo(creados[0]);

  // Otra transacción lo creó en el medio: se relee
  const { rows: existentes } = await db.query(
    `SELECT * FROM account_periods
      WHERE commerce_id = $1 AND customer_id = $2 AND status = 'abierto'`,
    [commerceId, customerId]
  );
  return aPeriodo(existentes[0]);
}

/** Congela el período: fija el total con lo que tenga y le pone vencimiento */
export async function cerrarPeriodo(db: Ejecutor, periodId: number, cfg: ConfigCierre): Promise<void> {
  const { rows } = await db.query(
    `SELECT p.id, p.period_end, p.paid AS pagos,
            COALESCE((SELECT SUM(t.amount) FROM customer_transactions t
                       WHERE t.period_id = p.id AND t.type <> 'payment'), 0) AS cargos
       FROM account_periods p WHERE p.id = $1 AND p.status = 'abierto'`,
    [periodId]
  );
  if (!rows[0]) return;

  const fin = new Date(rows[0].period_end).toISOString().slice(0, 10);
  const total = Number(rows[0].cargos);
  const pagado = Number(rows[0].pagos);
  // Un período que cierra sin deuda ya está pagado: no tiene sentido dejarle un
  // vencimiento a alguien que no debe nada.
  const estado = total <= 0 || pagado >= total ? "pagado" : pagado > 0 ? "pagado_parcial" : "cerrado";

  await db.query(
    `UPDATE account_periods
        SET status = $2, total = $3, paid = $4, closed_at = now(), due_date = $5,
            updated_at = now()
      WHERE id = $1`,
    [periodId, estado, total, pagado, vencimientoDe(fin, cfg.closing_day, cfg.due_day)]
  );
}

/**
 * Imputa un pago a los resúmenes, del más viejo al más nuevo.
 *
 * Del más viejo primero porque es lo que hace el cuaderno y lo que espera
 * cualquiera. El comerciante puede forzar otro con `periodId` —a veces dice
 * "no, dejá, esto es lo de este mes"—, pero el que no elige nunca es el
 * comprador: eso no existe en el cuaderno y genera discusiones.
 *
 * Lo que sobra después de cancelar todos los cerrados queda a cuenta del
 * período abierto. La plata no se pierde ni queda colgada.
 */
export async function imputarPago(
  db: Ejecutor,
  commerceId: number,
  customerId: number,
  transactionId: number,
  monto: number,
  periodIdForzado?: number
): Promise<{ periodId: number; amount: number }[]> {
  // El total de un período abierto no está en la columna —se congela al
  // cerrar—, así que para saber cuánto se le puede imputar hay que sumar sus
  // cargos en vivo.
  const { rows: periodos } = await db.query(
    `SELECT p.id, p.status, p.paid,
            CASE WHEN p.status = 'abierto'
                 THEN COALESCE((SELECT SUM(t.amount) FROM customer_transactions t
                                 WHERE t.period_id = p.id AND t.type <> 'payment'), 0)
                 ELSE p.total END AS total
       FROM account_periods p
      WHERE p.commerce_id = $1 AND p.customer_id = $2
        ${periodIdForzado ? "AND p.id = $3" : "AND p.status IN ('cerrado','pagado_parcial','abierto')"}
      -- Los cerrados primero y del más viejo al más nuevo; el abierto último,
      -- porque solo recibe lo que sobre después de cancelar lo que ya se debe.
      ORDER BY (p.status = 'abierto'), p.period_start
      FOR UPDATE`,
    periodIdForzado ? [commerceId, customerId, periodIdForzado] : [commerceId, customerId]
  );

  const aplicados: { periodId: number; amount: number }[] = [];
  let resto = monto;

  for (const p of periodos) {
    if (resto <= 0) break;
    const pendiente = Math.round((Number(p.total) - Number(p.paid)) * 100) / 100;
    if (pendiente <= 0) continue;
    const aplica = Math.min(resto, pendiente);
    const pagadoNuevo = Math.round((Number(p.paid) + aplica) * 100) / 100;

    // A un período abierto se le toca `paid` y nunca `status`: si dejara de
    // estar abierto, las compras de hoy no tendrían dónde caer.
    if (p.status === "abierto") {
      await db.query("UPDATE account_periods SET paid = $2, updated_at = now() WHERE id = $1", [p.id, pagadoNuevo]);
    } else {
      await db.query(
        `UPDATE account_periods
            SET paid = $2, updated_at = now(),
                status = CASE WHEN $2 >= total THEN 'pagado' ELSE 'pagado_parcial' END
          WHERE id = $1`,
        [p.id, pagadoNuevo]
      );
    }
    await db.query(
      `INSERT INTO account_payments (commerce_id, period_id, transaction_id, amount)
       VALUES ($1, $2, $3, $4)`,
      [commerceId, p.id, transactionId, aplica]
    );
    aplicados.push({ periodId: Number(p.id), amount: aplica });
    resto = Math.round((resto - aplica) * 100) / 100;
  }
  return aplicados;
}

/** La pila completa: los cerrados del más viejo al más nuevo, y el abierto */
export async function pilaDe(
  commerceId: number,
  customerId: number
): Promise<{ periods: Periodo[]; abierto: Periodo | null }> {
  await periodoAbierto(pool, commerceId, customerId);
  const { rows } = await pool.query(
    `SELECT p.*,
            COALESCE((SELECT SUM(t.amount) FROM customer_transactions t
                       WHERE t.period_id = p.id AND t.type <> 'payment'), 0) AS vivo
       FROM account_periods p
      WHERE p.commerce_id = $1 AND p.customer_id = $2
      ORDER BY p.period_start`,
    [commerceId, customerId]
  );
  const periods = rows.map((r) => {
    const p = aPeriodo(r);
    // El abierto no tiene total congelado todavía: va lo que lleva acumulado.
    if (p.status === "abierto") p.total = Number(r.vivo);
    return p;
  });
  return { periods, abierto: periods.find((p) => p.status === "abierto") ?? null };
}

function aPeriodo(r: Record<string, unknown>): Periodo {
  const fecha = (v: unknown): string => new Date(v as string).toISOString().slice(0, 10);
  return {
    id: Number(r.id),
    label: String(r.label),
    status: r.status as Periodo["status"],
    periodStart: fecha(r.period_start),
    periodEnd: fecha(r.period_end),
    closedAt: r.closed_at ? new Date(r.closed_at as string).toISOString() : null,
    dueDate: r.due_date ? fecha(r.due_date) : null,
    total: Number(r.total),
    paid: Number(r.paid),
  };
}

// ── Si se puede fiar, y cuánto ──────────────────────────────────────────────

export interface EstadoCredito {
  /** Lo que la persona puede seguir comprando. Se muestra así, nunca el tope. */
  disponible: number | null;
  limite: number | null;
  pausado: boolean;
  /** El comercio habilitó la compra a cuenta desde la tienda online */
  onlineHabilitado: boolean;
  saldo: number;
}

/**
 * Por qué "Disponible: $18.000" y nunca "Tu límite es $20.000".
 *
 * Es el mismo número y son dos objetos sociales distintos: uno es un saldo, el
 * otro es una calificación. En un pueblo donde Juan se entera de que tiene 20 y
 * su primo tiene 80, la segunda versión trae un problema que no necesitamos.
 *
 * `disponible: null` es sin límite, y es el default: el cuaderno no tiene tope,
 * y ponerle uno a todo el mundo el día que se enciende esto sería cambiarle las
 * reglas a relaciones que ya existen.
 */
export async function estadoCredito(
  db: Ejecutor,
  commerceId: number,
  customerId: number
): Promise<EstadoCredito> {
  const { rows } = await db.query(
    `SELECT c.balance, c.credit_limit, c.credit_paused, co.online_credit_enabled
       FROM customers c JOIN commerces co ON co.id = c.commerce_id
      WHERE c.id = $1 AND c.commerce_id = $2`,
    [customerId, commerceId]
  );
  const r = rows[0];
  if (!r) throw new HttpError(404, "Cliente no encontrado");
  const saldo = Number(r.balance);
  const limite = r.credit_limit === null ? null : Number(r.credit_limit);
  return {
    saldo,
    limite,
    disponible: limite === null ? null : Math.round((limite - saldo) * 100) / 100,
    pausado: r.credit_paused,
    onlineHabilitado: r.online_credit_enabled,
  };
}

/**
 * El ritmo de pago de este cliente con este comercio.
 *
 * Describe, no califica. "Pagó 6 de 6 cierres, en promedio el día 9" es un
 * hecho de los datos del comerciante sobre su propio cliente y lo ayuda a
 * decidir; un puntaje decidiría por él.
 *
 * Sin resúmenes cerrados devuelve null en vez de un cero o un "sin datos"
 * disfrazado de dato: si no se puede respaldar, no se afirma.
 */
export async function ritmoDePago(
  commerceId: number,
  customerId: number
): Promise<{ cerrados: number; pagados: number; diaPromedio: number | null } | null> {
  const { rows } = await pool.query(
    `SELECT p.id, p.status,
            (SELECT MAX(ap.created_at) FROM account_payments ap WHERE ap.period_id = p.id) AS ultimo_pago
       FROM account_periods p
      WHERE p.commerce_id = $1 AND p.customer_id = $2 AND p.status <> 'abierto'`,
    [commerceId, customerId]
  );
  if (rows.length === 0) return null;

  const pagados = rows.filter((r) => r.status === "pagado");
  const dias = pagados
    .filter((r) => r.ultimo_pago)
    .map((r) => new Date(r.ultimo_pago).toLocaleDateString("en-CA", { timeZone: ZONA }))
    .map((f) => partes(f).dia);

  return {
    cerrados: rows.length,
    pagados: pagados.length,
    diaPromedio: dias.length > 0 ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : null,
  };
}

import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";

export const cajaRouter = Router();

/** Sesión de caja abierta del comercio, o null si no hay ninguna. */
export async function sesionAbierta(
  commerceId: number,
  client: PoolClient | typeof pool = pool
): Promise<{ id: number; opening_amount: string; opened_at: string } | null> {
  const { rows } = await client.query(
    "SELECT id, opening_amount, opened_at FROM cash_sessions WHERE commerce_id = $1 AND closed_at IS NULL",
    [commerceId]
  );
  return rows[0] ?? null;
}

/**
 * Arqueo de una sesión: qué entró por cada medio de pago, qué se movió a mano
 * y cuánto efectivo debería haber en el cajón.
 *
 * Criterio: solo el efectivo se cuenta físicamente. Las ventas a cuenta
 * corriente no dejan dinero (se cobran después), y tarjeta, transferencia y
 * billetera van a la cuenta bancaria, no al cajón.
 */
async function calcularResumen(commerceId: number, sessionId: number) {
  const [ventas, cobros, movimientos, sesion] = await Promise.all([
    pool.query(
      `SELECT payment_method,
              COUNT(*)::int AS tickets,
              COALESCE(SUM(total), 0) AS total
       FROM sales
       WHERE commerce_id = $1 AND cash_session_id = $2
       GROUP BY payment_method`,
      [commerceId, sessionId]
    ),
    pool.query(
      `SELECT COALESCE(payment_method, 'cash') AS payment_method,
              COALESCE(SUM(-amount), 0) AS total
       FROM customer_transactions
       WHERE commerce_id = $1 AND cash_session_id = $2 AND type = 'payment'
       GROUP BY COALESCE(payment_method, 'cash')`,
      [commerceId, sessionId]
    ),
    pool.query(
      `SELECT type, COALESCE(SUM(amount), 0) AS total
       FROM cash_movements WHERE session_id = $1 GROUP BY type`,
      [sessionId]
    ),
    pool.query("SELECT opening_amount, opened_at, closed_at FROM cash_sessions WHERE id = $1", [sessionId]),
  ]);

  const porMedio: Record<string, { tickets: number; total: number }> = {};
  for (const m of ["cash", "wallet", "card", "transfer", "account"]) porMedio[m] = { tickets: 0, total: 0 };
  for (const r of ventas.rows) {
    porMedio[r.payment_method] = { tickets: Number(r.tickets), total: Number(r.total) };
  }

  const cobrosCtaCte: Record<string, number> = {};
  for (const r of cobros.rows) cobrosCtaCte[r.payment_method] = Number(r.total);

  const ingresos = Number(movimientos.rows.find((r) => r.type === "ingreso")?.total ?? 0);
  const egresos = Number(movimientos.rows.find((r) => r.type === "egreso")?.total ?? 0);
  const apertura = Number(sesion.rows[0]?.opening_amount ?? 0);

  const ventasEfectivo = porMedio.cash.total;
  const cobrosEfectivo = cobrosCtaCte.cash ?? 0;
  const efectivoEsperado = apertura + ventasEfectivo + cobrosEfectivo + ingresos - egresos;

  const totalVendido = Object.values(porMedio).reduce((a, v) => a + v.total, 0);
  const totalTickets = Object.values(porMedio).reduce((a, v) => a + v.tickets, 0);

  return {
    apertura,
    ventasPorMedio: porMedio,
    cobrosCuentaCorriente: cobrosCtaCte,
    totalCobrosCuentaCorriente: Object.values(cobrosCtaCte).reduce((a, v) => a + v, 0),
    ingresos,
    egresos,
    totalVendido,
    totalTickets,
    efectivoEsperado,
  };
}

/**
 * GET /api/caja
 * Estado actual: si hay caja abierta devuelve su arqueo en vivo.
 */
cajaRouter.get("/", async (req, res, next) => {
  try {
    const sesion = await sesionAbierta(req.auth.commerceId);
    if (!sesion) {
      res.json({ abierta: false });
      return;
    }
    const resumen = await calcularResumen(req.auth.commerceId, sesion.id);
    const { rows: movimientos } = await pool.query(
      `SELECT id, type, amount, note, created_at FROM cash_movements
       WHERE session_id = $1 ORDER BY created_at DESC`,
      [sesion.id]
    );
    res.json({ abierta: true, sesion, resumen, movimientos });
  } catch (err) {
    next(err);
  }
});

const abrirSchema = z.object({
  openingAmount: z.coerce.number().nonnegative().default(0),
  note: z.string().optional(),
});

/** POST /api/caja/abrir */
cajaRouter.post("/abrir", async (req, res, next) => {
  try {
    const body = abrirSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    if (await sesionAbierta(commerceId)) throw new HttpError(400, "Ya hay una caja abierta");

    const {
      rows: [sesion],
    } = await pool.query(
      `INSERT INTO cash_sessions (commerce_id, opening_amount, opening_note)
       VALUES ($1, $2, $3) RETURNING id, opened_at, opening_amount`,
      [commerceId, body.openingAmount, body.note ?? null]
    );
    await audit(commerceId, "caja.abrir", "cash_sessions", sesion.id, { openingAmount: body.openingAmount });
    res.status(201).json({ sesion });
  } catch (err) {
    next(err);
  }
});

const movimientoSchema = z.object({
  type: z.enum(["ingreso", "egreso"]),
  amount: z.coerce.number().positive(),
  note: z.string().min(1),
});

/** POST /api/caja/movimiento — retiro, pago a proveedor, ingreso extra */
cajaRouter.post("/movimiento", async (req, res, next) => {
  try {
    const body = movimientoSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    const sesion = await sesionAbierta(commerceId);
    if (!sesion) throw new HttpError(400, "No hay una caja abierta");

    const {
      rows: [mov],
    } = await pool.query(
      `INSERT INTO cash_movements (commerce_id, session_id, type, amount, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [commerceId, sesion.id, body.type, body.amount, body.note]
    );
    await audit(commerceId, `caja.${body.type}`, "cash_movements", mov.id, body);
    res.status(201).json({ ok: true, id: mov.id });
  } catch (err) {
    next(err);
  }
});

const cerrarSchema = z.object({
  countedAmount: z.coerce.number().nonnegative(),
  note: z.string().optional(),
});

/**
 * POST /api/caja/cerrar
 * Cierra con el efectivo contado y congela el arqueo en la sesión.
 */
cajaRouter.post("/cerrar", async (req, res, next) => {
  try {
    const body = cerrarSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    const sesion = await sesionAbierta(commerceId);
    if (!sesion) throw new HttpError(400, "No hay una caja abierta");

    const resumen = await calcularResumen(commerceId, sesion.id);
    const diferencia = body.countedAmount - resumen.efectivoEsperado;
    const cierre = { ...resumen, contado: body.countedAmount, diferencia };

    await pool.query(
      `UPDATE cash_sessions
       SET closed_at = now(), counted_amount = $1, closing_note = $2, closing_summary = $3
       WHERE id = $4`,
      [body.countedAmount, body.note ?? null, JSON.stringify(cierre), sesion.id]
    );
    await audit(commerceId, "caja.cerrar", "cash_sessions", sesion.id, { diferencia });
    res.json({ ok: true, sessionId: sesion.id, cierre });
  } catch (err) {
    next(err);
  }
});

/** GET /api/caja/historial — cierres anteriores */
cajaRouter.get("/historial", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, opened_at, closed_at, opening_amount, counted_amount, closing_note, closing_summary
       FROM cash_sessions
       WHERE commerce_id = $1 AND closed_at IS NOT NULL
       ORDER BY closed_at DESC LIMIT 60`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

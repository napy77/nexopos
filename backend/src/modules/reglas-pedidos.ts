import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { consultarCuenta } from "../integrations/clubpay.js";
import { enTransaccion } from "./clubpay-sync.js";

/**
 * Las reglas de los pedidos de la tienda que se pagan en mano (CR-0003).
 *
 * Un correo verificado prueba que hay una casilla detrás, no quién es. Lo que
 * protege al comercio de un pedido falso de cincuenta productos «para pagar al
 * retirar» son los topes, y que el primer pedido grande de alguien nuevo lo
 * mire antes de armarlo.
 *
 * Sólo cuentan los pedidos en efectivo (`efectivo_entrega`). Mercado Pago está
 * pago antes de que se arme nada, y la libreta tiene sus propios límites.
 */

type Ejecutor = Pick<PoolClient, "query">;

export interface ReglaNivel {
  level: number;
  pickupCash: boolean;
  deliveryCash: boolean;
  /** En pesos. null = sin tope */
  maxTotal: number | null;
  /** Renglones del pedido. null = sin tope */
  maxItems: number | null;
}

export interface Reglas {
  enabled: boolean;
  levels: ReglaNivel[];
  /** Pedidos de cuentas sin retiros previos por encima de esto se revisan */
  reviewThreshold: number;
  /** Retiros entregados que hacen falta para pagar al recibir un reparto */
  deliveryCashRequiresPickups: number;
}

/**
 * Los valores de ejemplo, aprobados por German el 13/10/2026.
 *
 * No salen de estadística —había 22 tickets de mostrador, todos de Jure— sino
 * de criterio: $40.000 es casi el doble del ticket alto de Jure, para que entre
 * la compra grande que se hace online; 15 renglones frena el pedido absurdo
 * sin molestar a nadie real. Los niveles 2 y 3 todavía no existen en ClubPay:
 * quedan cargados para cuando lleguen.
 *
 * Viven acá y no copiados en cada comercio: un comercio que no tocó nada toma
 * el ejemplo vigente, y corregir el ejemplo le llega sin migrar datos.
 */
export const EJEMPLO: Omit<Reglas, "enabled"> = {
  levels: [
    { level: 0, pickupCash: false, deliveryCash: false, maxTotal: null, maxItems: null },
    { level: 1, pickupCash: true, deliveryCash: true, maxTotal: 40000, maxItems: 15 },
    { level: 2, pickupCash: true, deliveryCash: true, maxTotal: 80000, maxItems: 30 },
    { level: 3, pickupCash: true, deliveryCash: true, maxTotal: 160000, maxItems: null },
  ],
  reviewThreshold: 20000,
  deliveryCashRequiresPickups: 1,
};

/** Las reglas de un comercio: lo que cambió el comerciante, y el ejemplo en lo demás. */
export async function reglasDe(commerceId: number, db: Ejecutor = pool): Promise<Reglas> {
  const [{ rows: [com] }, { rows: filas }] = await Promise.all([
    db.query(
      `SELECT identity_rules_enabled, review_threshold, delivery_cash_min_pickups
         FROM commerces WHERE id = $1`, [commerceId]
    ),
    db.query(
      `SELECT verification_level, pickup_cash, delivery_cash, max_total, max_items
         FROM commerce_order_limits WHERE commerce_id = $1`, [commerceId]
    ),
  ]);
  const propias = new Map(filas.map((f) => [Number(f.verification_level), f]));
  return {
    enabled: Boolean(com?.identity_rules_enabled),
    levels: EJEMPLO.levels.map((ej) => {
      const f = propias.get(ej.level);
      return f ? {
        level: ej.level,
        pickupCash: f.pickup_cash,
        deliveryCash: f.delivery_cash,
        maxTotal: f.max_total === null ? null : Number(f.max_total),
        maxItems: f.max_items === null ? null : Number(f.max_items),
      } : ej;
    }),
    reviewThreshold: com?.review_threshold != null ? Number(com.review_threshold) : EJEMPLO.reviewThreshold,
    deliveryCashRequiresPickups: com?.delivery_cash_min_pickups != null
      ? Number(com.delivery_cash_min_pickups) : EJEMPLO.deliveryCashRequiresPickups,
  };
}

const centavos = (pesos: number): number => Math.round(pesos * 100);

/**
 * Lo que ve NexoTienda en `orderRules`. La tienda sólo mira el nivel 0 para
 * decidir si pide identificarse; los topes no los adelanta, espera el rechazo.
 * Apagado va `{ enabled: false }` y nada más, que es lo que la tienda lee como
 * "como hoy".
 */
export function orderRulesPublico(r: Reglas) {
  if (!r.enabled) return { enabled: false };
  return {
    enabled: true,
    levels: r.levels.map((n) => ({
      level: n.level,
      pickupCash: n.pickupCash,
      deliveryCash: n.deliveryCash,
      ...(n.maxTotal !== null ? { maxTotalCents: centavos(n.maxTotal) } : {}),
      ...(n.maxItems !== null ? { maxItems: n.maxItems } : {}),
    })),
    deliveryCashRequiresPickups: r.deliveryCashRequiresPickups,
  };
}

// ── Evaluar un pedido ───────────────────────────────────────────────────────

export interface Cuenta {
  id: number;
  origen: string;
  clubpayAccountId: string | null;
}

export interface Identidad {
  /** null cuando no hay cuenta o cuando no se le pudo preguntar a ClubPay */
  level: number | null;
  /** ClubPay no contestó: el pedido entra igual, marcado para revisar */
  sinRespuesta: boolean;
}

/**
 * El nivel de verificación de quien compra, preguntado a ClubPay en el momento
 * del pedido. No se le cree a la tienda: el nivel es lo que protege al
 * comercio, y la tienda es otro servidor.
 *
 * Se pregunta ANTES de abrir la transacción del pedido, para no tener filas
 * tomadas mientras esperamos la red.
 */
export async function identidadDe(apiKey: string | null, cuenta: Cuenta | null): Promise<Identidad> {
  if (!cuenta) return { level: null, sinRespuesta: false };
  // Alguien que el comerciante dio de alta en el mostrador lo conoce en
  // persona, que es más que un DNI con foto.
  if (cuenta.origen === "mostrador") return { level: 3, sinRespuesta: false };
  if (!cuenta.clubpayAccountId || !apiKey) return { level: 0, sinRespuesta: false };
  try {
    const c = await consultarCuenta(apiKey, cuenta.clubpayAccountId);
    return { level: Number(c.verification_level) || 0, sinRespuesta: false };
  } catch (err) {
    // Desvinculada, o de otro comercio: para este comercio, nadie verificado.
    if (err instanceof HttpError && err.status === 404) return { level: 0, sinRespuesta: false };
    // ClubPay no contestó. Perder la venta por un problema de red es peor que
    // pedirle al comerciante que la mire: entra con el nivel 1, marcada.
    console.warn("[reglas] no se pudo preguntar el nivel a ClubPay:", err instanceof Error ? err.message : err);
    return { level: 1, sinRespuesta: true };
  }
}

/** Retiros entregados de esta persona en este comercio */
export async function retirosDe(db: Ejecutor, commerceId: number, customerId: number): Promise<number> {
  const { rows: [r] } = await db.query(
    `SELECT count(*)::int AS n FROM orders
      WHERE commerce_id = $1 AND customer_id = $2 AND slot_kind = 'retiro' AND status = 'entregado'`,
    [commerceId, customerId]
  );
  return Number(r.n);
}

export type MotivoRevision = "cuenta_nueva_monto_alto" | "identidad_no_disponible";

/**
 * Si el pedido entra, y si entra marcado para revisión. Tira el rechazo con su
 * `code` si no entra.
 *
 * El texto de cada rechazo lo lee el comprador tal cual (NexoTienda no lo
 * reescribe): dice qué puede hacer, no qué hizo mal.
 */
export async function evaluarPedido(db: Ejecutor, p: {
  reglas: Reglas;
  commerceId: number;
  cuenta: Cuenta | null;
  identidad: Identidad;
  slotKind: "retiro" | "reparto";
  total: number;
  renglones: number;
  /** Si el comercio cobra con Mercado Pago: sólo así se le ofrece como salida */
  ofreceMP: boolean;
}): Promise<{ review: MotivoRevision | null }> {
  const { reglas, cuenta, identidad } = p;
  // "Pagá con Mercado Pago" en un comercio que no lo cobra es mandar al
  // comprador a una puerta cerrada.
  const oMP = p.ofreceMP ? " o pagá con Mercado Pago" : "";
  const tambienMP = p.ofreceMP ? " También podés pagar con Mercado Pago." : "";
  const campo = p.slotKind === "retiro" ? "pickupCash" : "deliveryCash";
  const habilitan = reglas.levels.filter((n) => n[campo]);
  const minimo = habilitan.length ? Math.min(...habilitan.map((n) => n.level)) : null;
  const queCosa = p.slotKind === "retiro" ? "pagar al retirar" : "pagar al recibir";

  if (minimo === null) {
    throw new HttpError(409, `Este comercio no está tomando pedidos para ${queCosa}.${tambienMP}`,
      "nivel_insuficiente");
  }
  if (!cuenta) {
    // El nivel 0 lo permite: es la configuración del comerciante, se respeta.
    if (minimo > 0) {
      throw new HttpError(409, `Para ${queCosa} en este comercio, identificate con ClubPay.${tambienMP}`,
        "requiere_cuenta", { requiredLevel: minimo });
    }
  }

  const nivel = cuenta ? (identidad.level ?? 0) : 0;
  if (nivel < minimo) {
    throw new HttpError(409,
      `Para ${queCosa} en este comercio tu cuenta de ClubPay tiene que estar verificada. Verificala y volvé${oMP}.`,
      "nivel_insuficiente", { requiredLevel: minimo, currentLevel: nivel });
  }

  // Las reglas del nivel más alto que alcanza la persona. Comparar con >=,
  // como pidió ClubPay: el que tiene nivel 2 puede todo lo del 1.
  const regla = [...reglas.levels].reverse().find((n) => n.level <= nivel)!;

  if (regla.maxItems !== null && p.renglones > regla.maxItems) {
    throw new HttpError(409,
      `Para ${queCosa}, este comercio toma pedidos de hasta ${regla.maxItems} productos distintos. Sacá algunos${oMP}.`,
      "excede_tope_productos", { maxItems: regla.maxItems });
  }
  if (regla.maxTotal !== null && p.total > regla.maxTotal) {
    const tope = regla.maxTotal.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
    throw new HttpError(409,
      `Para ${queCosa}, este comercio toma pedidos de hasta ${tope}. Sacá algo${oMP}.`,
      "excede_tope_monto", { maxTotalCents: centavos(regla.maxTotal) });
  }

  // Quien el comerciante conoce del mostrador no es una cuenta nueva.
  const conocido = cuenta?.origen === "mostrador";
  const retiros = cuenta && !conocido ? await retirosDe(db, p.commerceId, cuenta.id) : 0;

  if (p.slotKind === "reparto" && !conocido && retiros < reglas.deliveryCashRequiresPickups) {
    throw new HttpError(409,
      `Para pagar al recibir, este comercio pide haber retirado antes algún pedido en el local. Elegí retirarlo${oMP}.`,
      "reparto_requiere_historial", { requiredPickups: reglas.deliveryCashRequiresPickups });
  }

  if (identidad.sinRespuesta) return { review: "identidad_no_disponible" };
  if (cuenta && !conocido && retiros === 0 && p.total > reglas.reviewThreshold) {
    return { review: "cuenta_nueva_monto_alto" };
  }
  return { review: null };
}

// ── La configuración, desde la pantalla del comerciante ─────────────────────

export const reglasRouter = Router();

/** GET /api/reglas-pedidos */
reglasRouter.get("/", async (req, res, next) => {
  try {
    res.json({ ...(await reglasDe(req.auth.commerceId)), ejemplo: EJEMPLO });
  } catch (err) {
    next(err);
  }
});

const nivelSchema = z.object({
  level: z.number().int().min(0).max(3),
  pickupCash: z.boolean(),
  deliveryCash: z.boolean(),
  maxTotal: z.number().positive().nullable(),
  maxItems: z.number().int().positive().nullable(),
});

const reglasSchema = z.object({
  enabled: z.boolean().optional(),
  levels: z.array(nivelSchema).max(4).optional(),
  reviewThreshold: z.number().nonnegative().optional(),
  deliveryCashRequiresPickups: z.number().int().min(0).max(20).optional(),
  /** Volver a los valores de ejemplo */
  restaurar: z.boolean().optional(),
});

/** PUT /api/reglas-pedidos */
reglasRouter.put("/", async (req, res, next) => {
  try {
    const body = reglasSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    await enTransaccion(async (c) => {
      if (body.restaurar) {
        await c.query("DELETE FROM commerce_order_limits WHERE commerce_id = $1", [commerceId]);
        await c.query(
          "UPDATE commerces SET review_threshold = NULL, delivery_cash_min_pickups = NULL WHERE id = $1",
          [commerceId]
        );
      }
      for (const n of body.levels ?? []) {
        await c.query(
          `INSERT INTO commerce_order_limits
             (commerce_id, verification_level, pickup_cash, delivery_cash, max_total, max_items)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (commerce_id, verification_level) DO UPDATE SET
             pickup_cash = EXCLUDED.pickup_cash, delivery_cash = EXCLUDED.delivery_cash,
             max_total = EXCLUDED.max_total, max_items = EXCLUDED.max_items`,
          [commerceId, n.level, n.pickupCash, n.deliveryCash, n.maxTotal, n.maxItems]
        );
      }
      await c.query(
        `UPDATE commerces SET
           identity_rules_enabled = COALESCE($2::boolean, identity_rules_enabled),
           review_threshold = COALESCE($3::numeric, review_threshold),
           delivery_cash_min_pickups = COALESCE($4::int, delivery_cash_min_pickups)
         WHERE id = $1`,
        [commerceId, body.enabled ?? null, body.reviewThreshold ?? null,
         body.deliveryCashRequiresPickups ?? null]
      );
    });
    await audit(commerceId, "settings.reglas_pedidos", "commerces", commerceId, body);
    res.json({ ...(await reglasDe(commerceId)), ejemplo: EJEMPLO });
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";

export const disponibilidadRouter = Router();

/**
 * Disponibilidad de un producto (A1).
 *
 * Dos formas de control sobre el mismo objeto, no dos tipos de producto:
 *
 * - `stock`: lo que se compra hecho. Inventario real, el POS lo sabe porque
 *   registra las ventas.
 * - `declared`: lo que el comercio hace —la pizza, el pan, la copia de llave—.
 *   Una declaración, no un inventario. **Nunca descuenta insumos.**
 *
 * Por qué la pizza no descuenta queso: el consumo de cocina es estocástico y
 * una receta lo modela como determinístico. Cambia la marca de jamón, el
 * cocinero usa más hoy, se queman dos, a la noche tiran lo que sobró. Cuando el
 * comerciante ve que el sistema dice 8 kg y en la heladera hay 3, deja de
 * creerle al módulo entero, incluidos los 600 productos donde el POS es
 * infalible. Se pierde lo que funciona para sostener lo que nunca iba a
 * funcionar.
 */

/** La forma que espera NexoTienda. Ver types.ts de ese repo. */
export type Availability =
  | { policy: "stock"; onHand: number }
  | { policy: "declared"; state: "available" | "out"; quota?: { total: number; remaining: number } }
  | { policy: "unknown" };

/** Fila de stock_items con lo que hace falta para resolver disponibilidad */
export interface FilaDisponibilidad {
  availability_policy: string | null;
  quantity: string | number;
  declared_state: string;
  quota_total: number | null;
  quota_remaining: number | null;
  quota_day: string | Date | null;
}

/** Hoy en Argentina. Las fechas sin hora son del país, no del servidor. */
export function hoyLocal(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });
}

const mismoDia = (d: string | Date | null): boolean =>
  d !== null && new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" }) === hoyLocal();

/**
 * El cupo del día, ya repuesto si cambió la fecha.
 *
 * La reposición se resuelve mirando la fecha y no con una tarea programada: una
 * tarea que corre a las 00:00 no corre si el servidor estaba caído, y entonces
 * la tienda amanece en cero y parece cerrada. Mirando la fecha, el cupo está
 * bien aunque no haya corrido nada.
 */
export function cupoVigente(fila: FilaDisponibilidad): { total: number; remaining: number } | undefined {
  if (fila.quota_total === null) return undefined;
  const remaining = mismoDia(fila.quota_day) ? (fila.quota_remaining ?? 0) : fila.quota_total;
  return { total: fila.quota_total, remaining: Math.max(0, remaining) };
}

/** Traduce una fila de stock a lo que ve la tienda */
export function disponibilidadDe(fila: FilaDisponibilidad | null | undefined): Availability {
  // `unknown` no es cero: es que no sabemos, y hay que decirlo en vez de
  // inventar un número. La tienda muestra "consultá disponibilidad" y deja
  // pedir igual, porque lo confirma el comercio al aceptar.
  if (!fila || !fila.availability_policy) return { policy: "unknown" };

  if (fila.availability_policy === "declared") {
    const cupo = cupoVigente(fila);
    // Un cupo agotado es "sin stock" aunque nadie haya tocado el botón: el
    // contador ya dijo que no quedan.
    const sinCupo = cupo !== undefined && cupo.remaining <= 0;
    const state = fila.declared_state === "out" || sinCupo ? "out" : "available";
    return cupo ? { policy: "declared", state, quota: cupo } : { policy: "declared", state };
  }
  return { policy: "stock", onHand: Number(fila.quantity) };
}

/**
 * Descuenta el cupo del día por una venta.
 *
 * Se llama dentro de la transacción de la venta. Los productos por `stock`
 * descuentan inventario; los `declared` con cupo descuentan el contador, y los
 * `declared` sin cupo no descuentan nada —no hay qué descontar—.
 *
 * Nunca frena la venta: si alguien vendió la pizza 21 de un cupo de 20, la
 * vendió, y el mostrador no es lugar para discutir con el software.
 */
export async function descontarCupo(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: FilaDisponibilidad[] }> },
  commerceId: number,
  productId: number,
  cantidad: number
): Promise<void> {
  const { rows } = await client.query(
    `SELECT availability_policy, quantity, declared_state, quota_total, quota_remaining, quota_day
       FROM stock_items WHERE commerce_id = $1 AND product_id = $2`,
    [commerceId, productId]
  );
  const fila = rows[0];
  if (!fila || fila.availability_policy !== "declared" || fila.quota_total === null) return;

  const cupo = cupoVigente(fila)!;
  await client.query(
    `UPDATE stock_items SET quota_remaining = $3, quota_day = $4, updated_at = now()
      WHERE commerce_id = $1 AND product_id = $2`,
    [commerceId, productId, Math.max(0, cupo.remaining - Math.ceil(cantidad)), hoyLocal()]
  );
}

// ── Lo que toca el comerciante ──────────────────────────────────────────────

const politicaSchema = z.object({
  policy: z.enum(["stock", "declared"]).optional(),
  esInsumo: z.boolean().optional(),
  /** null borra el cupo y deja el producto en "disponible sin contador" */
  quotaTotal: z.coerce.number().int().nonnegative().nullable().optional(),
});

/** PUT /api/disponibilidad/:productId — cómo se controla este producto */
disponibilidadRouter.put("/:productId", async (req, res, next) => {
  try {
    const body = politicaSchema.parse(req.body);
    const productId = Number(req.params.productId);
    const commerceId = req.auth.commerceId;

    const sets: string[] = [];
    const vals: unknown[] = [commerceId, productId];
    if (body.policy !== undefined) { vals.push(body.policy); sets.push(`availability_policy = $${vals.length}`); }
    if (body.esInsumo !== undefined) { vals.push(body.esInsumo); sets.push(`es_insumo = $${vals.length}`); }
    if (body.quotaTotal !== undefined) {
      vals.push(body.quotaTotal); sets.push(`quota_total = $${vals.length}`);
      // Un cupo nuevo arranca entero hoy, no con el remanente de ayer
      vals.push(body.quotaTotal); sets.push(`quota_remaining = $${vals.length}`);
      vals.push(hoyLocal()); sets.push(`quota_day = $${vals.length}`);
    }
    if (sets.length === 0) throw new HttpError(400, "No hay nada que cambiar");

    const { rows } = await pool.query(
      `UPDATE stock_items SET ${sets.join(", ")}, updated_at = now()
        WHERE commerce_id = $1 AND product_id = $2
        RETURNING availability_policy, quantity, declared_state, quota_total, quota_remaining, quota_day, es_insumo`,
      vals
    );
    if (!rows[0]) throw new HttpError(404, "El producto no está en el stock de este comercio");
    await audit(commerceId, "disponibilidad.politica", "stock_items", productId, body);
    res.json({ availability: disponibilidadDe(rows[0]), esInsumo: rows[0].es_insumo });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/disponibilidad/:productId/agotado — "se acabó la milanesa"
 *
 * Es la regla que define si toda la pata de comidas vive o muere: marcar que se
 * acabó tiene que costar UN gesto desde el teléfono. El tipo tiene las manos en
 * la masa; si son cuatro pantallas no lo hace, alguien pide algo que no existe,
 * queda mal con su vecino y apaga la tienda.
 *
 * Por eso es un toggle sin cuerpo: un botón, nada que completar.
 */
disponibilidadRouter.post("/:productId/agotado", async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    const commerceId = req.auth.commerceId;
    const { rows } = await pool.query(
      `UPDATE stock_items
          SET declared_state = CASE WHEN declared_state = 'out' THEN 'available' ELSE 'out' END,
              -- Volver a haber implica reponer el cupo: si dice que hay, hay.
              quota_remaining = CASE WHEN declared_state = 'out' THEN quota_total ELSE quota_remaining END,
              quota_day = CASE WHEN declared_state = 'out' THEN $3::date ELSE quota_day END,
              updated_at = now()
        WHERE commerce_id = $1 AND product_id = $2
        RETURNING availability_policy, quantity, declared_state, quota_total, quota_remaining, quota_day`,
      [commerceId, productId, hoyLocal()]
    );
    if (!rows[0]) throw new HttpError(404, "El producto no está en el stock de este comercio");
    await audit(commerceId, "disponibilidad.agotado", "stock_items", productId, {
      estado: rows[0].declared_state,
    });
    res.json({ availability: disponibilidadDe(rows[0]) });
  } catch (err) {
    next(err);
  }
});

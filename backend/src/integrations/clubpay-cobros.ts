import { randomUUID } from "node:crypto";
import { HttpError } from "../middleware/error.js";
import { config } from "../config.js";
import { api, apiGet, isMockMode } from "./clubpay.js";

/** El simulador corre sólo si se pidió explícitamente; ver config.clubpay.simuladorCobros */
export const simulandoCobros = (): boolean => isMockMode() && config.clubpay.simuladorCobros;

function sinClubPay(): never {
  throw new HttpError(409, "Mercado Pago no está disponible: este servidor no tiene ClubPay configurado.");
}

/**
 * Cobros con Mercado Pago a través del vínculo que el comercio ya hizo en
 * ClubPay.
 *
 * El comercio conecta su Mercado Pago una sola vez, en ClubPay, por OAuth.
 * NexoPOS nunca ve esas credenciales: le pide el cobro a ClubPay con la clave
 * `pos_…` del comercio y ClubPay lo crea a su nombre. La plata va directo del
 * cliente a la cuenta del comercio.
 *
 * Contrato: docs/RESPUESTA-COBROS-MERCADOPAGO-DE-CLUBPAY.md. Donde difiere de
 * nuestro pedido, manda la respuesta, y el simulador de abajo la sigue en eso
 * también: un simulador más amable que la API esconde justo los casos que hay
 * que manejar.
 */

export type CanalCobro = "mostrador" | "tienda";
export type EstadoCobro = "pending" | "paid" | "rejected" | "expired" | "cancelled" | "refunded";

export interface CobroMP {
  payment_id: string;
  external_reference: string;
  channel: CanalCobro;
  status: EstadoCobro;
  amount_cents: number;
  fee_cents: number;
  refunded_cents: number;
  paid_at: string | null;
  mp_payment_id: string | null;
  error: string | null;
  /** Sólo en el mostrador: el texto EMVCo que se dibuja como QR */
  qr_data?: string | null;
  /** Sólo en la tienda */
  checkout_url?: string | null;
  expires_at?: string | null;
}

export interface EstadoCuentaMP {
  mercadopago: "connected" | "disconnected" | "expired";
  enabled_for_pos: boolean;
  /** Sin la dirección del local cargada en ClubPay no hay QR de mostrador */
  mostrador_listo: boolean;
}

// ── Simulador ────────────────────────────────────────────────────────────────

/**
 * Cómo se comporta, y por qué:
 *
 * - En el mostrador el cliente "paga" solo a los pocos segundos.
 * - En la tienda el link lleva a una página nuestra que aprueba o rechaza a
 *   elección (ver modules/mercadopago.ts), para probar los dos caminos.
 * - `rejected` no es final, y un `cancelled` o `expired` puede terminar en
 *   `paid`: es lo que dijo ClubPay y lo que más fácil se rompe del lado
 *   nuestro. `mockResolverCheckout` lo provoca a mano.
 * - Mismo `external_reference` con otro importe o canal → 409.
 * - Cancelar uno pagado → 409. Devolver más de lo que queda → 409.
 */
const mock = new Map<string, CobroMP & { creado: number }>();
const mockRefs = new Map<string, string>();
const MOCK_SEGUNDOS_HASTA_PAGO = 8;
const VIGENCIA_MIN: Record<CanalCobro, number> = { mostrador: 5, tienda: 30 };
let mockBaseUrl = "http://localhost:4000";

/** La URL pública de este backend, para armar el link del checkout simulado */
export const configurarSimulador = (baseUrl: string): void => { mockBaseUrl = baseUrl; };

function mockActualizar(c: CobroMP & { creado: number }): CobroMP {
  const seg = (Date.now() - c.creado) / 1000;
  if (c.status === "pending" && c.channel === "mostrador" && seg >= MOCK_SEGUNDOS_HASTA_PAGO) {
    c.status = "paid";
    c.paid_at = new Date().toISOString();
    c.mp_payment_id = String(Math.floor(Math.random() * 9e10));
  }
  if (c.status === "pending" && seg > VIGENCIA_MIN[c.channel] * 60) c.status = "expired";
  const { creado: _, ...publico } = c;
  return { ...publico };
}

function mockTraer(id: string): CobroMP & { creado: number } {
  const c = mock.get(id);
  if (!c) throw new HttpError(404, "Cobro no encontrado");
  return c;
}

/** Simulador: lo que haría Mercado Pago cuando el comprador decide en el checkout */
export function mockResolverCheckout(id: string, aprobar: boolean): CobroMP {
  const c = mockTraer(id);
  if (aprobar) {
    // Pasa a `paid` aunque estuviera rechazado, cancelado o vencido: es el
    // caso del cliente que ya estaba pagando cuando se canceló.
    c.status = "paid";
    c.paid_at = new Date().toISOString();
    c.mp_payment_id = String(Math.floor(Math.random() * 9e10));
    c.error = null;
  } else if (c.status === "pending") {
    c.status = "rejected";
    c.error = "Tu tarjeta rechazó el pago. Probá con otra o con dinero en cuenta.";
  }
  return mockActualizar(c);
}

// ── API ──────────────────────────────────────────────────────────────────────

export async function estadoCuentaMP(apiKey: string): Promise<EstadoCuentaMP> {
  if (simulandoCobros()) return { mercadopago: "connected", enabled_for_pos: true, mostrador_listo: true };
  if (isMockMode()) return { mercadopago: "disconnected", enabled_for_pos: false, mostrador_listo: false };
  return apiGet<EstadoCuentaMP>("/pos/payments/status", apiKey);
}

export async function crearCobroMP(
  apiKey: string,
  datos: {
    amountCents: number;
    externalReference: string;
    channel: CanalCobro;
    description: string;
    returnUrl?: string | null;
  }
): Promise<CobroMP> {
  if (isMockMode() && !simulandoCobros()) sinClubPay();
  if (isMockMode()) {
    const ya = mockRefs.get(datos.externalReference);
    if (ya) {
      const c = mockTraer(ya);
      if (c.amount_cents !== datos.amountCents || c.channel !== datos.channel) {
        throw new HttpError(409, "Ya existe un cobro con esa referencia y otro importe.");
      }
      return mockActualizar(c);
    }
    const id = `pay_demo_${randomUUID().slice(0, 12)}`;
    const c: CobroMP & { creado: number } = {
      creado: Date.now(),
      payment_id: id,
      external_reference: datos.externalReference,
      channel: datos.channel,
      status: "pending",
      amount_cents: datos.amountCents,
      fee_cents: 0,
      refunded_cents: 0,
      paid_at: null,
      mp_payment_id: null,
      error: null,
      // Con la forma del QR real (EMVCo), aunque ninguna billetera lo pague
      qr_data: datos.channel === "mostrador"
        ? `00020101021243650016COM.MERCADOLIBRE0201306364${id}5204970053030325802AR6304DEMO`
        : null,
      checkout_url: datos.channel === "tienda"
        ? `${mockBaseUrl}/api/mercadopago/simulador/${id}` +
          (datos.returnUrl ? `?vuelta=${encodeURIComponent(datos.returnUrl)}` : "")
        : null,
      expires_at: new Date(Date.now() + VIGENCIA_MIN[datos.channel] * 60_000).toISOString(),
    };
    mock.set(id, c);
    mockRefs.set(datos.externalReference, id);
    return mockActualizar(c);
  }
  return api<CobroMP>("/pos/payments", apiKey, {
    amount_cents: datos.amountCents,
    external_reference: datos.externalReference,
    channel: datos.channel,
    description: datos.description.slice(0, 200),
    return_url: datos.returnUrl ?? null,
  });
}

export async function consultarCobroMP(apiKey: string, paymentId: string): Promise<CobroMP> {
  if (isMockMode() && !simulandoCobros()) sinClubPay();
  if (isMockMode()) return mockActualizar(mockTraer(paymentId));
  return apiGet<CobroMP>(`/pos/payments/${encodeURIComponent(paymentId)}`, apiKey);
}

/**
 * Cancela un cobro pendiente y devuelve cómo quedó.
 *
 * Si mientras tanto se pagó, ClubPay contesta 409 con el cobro en `paid`. Acá
 * eso no es un error: se relee y se devuelve, para que quien llamó vea que hay
 * un pago y no lo pierda porque el cajero apretó cancelar un segundo tarde.
 */
export async function cancelarCobroMP(apiKey: string, paymentId: string): Promise<CobroMP> {
  if (isMockMode() && !simulandoCobros()) sinClubPay();
  if (isMockMode()) {
    const c = mockTraer(paymentId);
    const actual = mockActualizar(c);
    if (actual.status === "pending") c.status = "cancelled";
    return mockActualizar(c);
  }
  try {
    return await api<CobroMP>(`/pos/payments/${encodeURIComponent(paymentId)}/cancel`, apiKey, {});
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return consultarCobroMP(apiKey, paymentId);
    throw err;
  }
}

/**
 * Devuelve al que pagó, por Mercado Pago. Sin importe, devuelve lo que falte.
 * Idempotente por `externalReference`: reintentar no devuelve dos veces.
 */
export async function devolverCobroMP(
  apiKey: string,
  paymentId: string,
  datos: { externalReference: string; amountCents?: number }
): Promise<CobroMP> {
  if (isMockMode() && !simulandoCobros()) sinClubPay();
  if (isMockMode()) {
    const c = mockTraer(paymentId);
    mockActualizar(c);
    const clave = `refund:${datos.externalReference}`;
    if (mockRefs.has(clave)) return mockActualizar(c);
    if (c.status !== "paid" && c.status !== "refunded") {
      throw new HttpError(409, "Solo se puede devolver un cobro pagado.");
    }
    const resto = c.amount_cents - c.refunded_cents;
    const monto = datos.amountCents ?? resto;
    if (monto > resto) {
      throw new HttpError(409, `Se pueden devolver hasta $${(resto / 100).toLocaleString("es-AR")}.`);
    }
    c.refunded_cents += monto;
    c.status = "refunded";
    mockRefs.set(clave, paymentId);
    return mockActualizar(c);
  }
  return api<CobroMP>(`/pos/payments/${encodeURIComponent(paymentId)}/refunds`, apiKey, {
    external_reference: datos.externalReference,
    ...(datos.amountCents !== undefined ? { amount_cents: datos.amountCents } : {}),
  });
}

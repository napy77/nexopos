import { config } from "../config.js";
import { HttpError } from "../middleware/error.js";

/**
 * Cliente de ClubPay (https://api.clubpay.com.ar).
 *
 * Regla que sostiene toda la integración: **ClubPay decide cuánto se
 * descuenta y NexoPOS aplica lo que contesta**. Un beneficio no es "20%": es
 * un acuerdo entre la institución y el comercio que puede tener tope por
 * compra, tope mensual por socio, base máxima y días en que corre. Si el POS
 * calculara el porcentaje por su cuenta, esos topes serían decorativos y
 * tanto el comercio como el socio perderían lo que aceptaron.
 *
 * Por eso acá no hay ninguna cuenta de porcentajes: se pregunta y se aplica.
 *
 * Autenticación: header X-API-Key con la clave de POS del comercio (se la da
 * ClubPay al activar el servicio en NexoB2B, y es propia de cada comercio).
 */

/** Los importes de ClubPay son centavos enteros: $100.000 → 10000000 */
export const aCentavos = (pesos: number): number => Math.round(pesos * 100);
export const aPesos = (centavos: number): number => centavos / 100;

export interface ClubPaySocio {
  membership_id: number;
  name: string;
  member_number: string;
  club_id: number;
  club_name: string;
  points: number;
}

export interface ClubPayOferta {
  id: number;
  description: string;
  discount_percent: number;
  points_per_use: number;
  valid_until: string | null;
  /** La letra chica en palabras, para que el cajero pueda explicarla */
  condiciones: string[];
  aplica_hoy: boolean;
  /** Por qué no aplica hoy. Está escrito para leérselo al cliente tal cual */
  motivo: string;
  /** Importe a descontar, ya con los topes aplicados por ClubPay */
  discount_cents?: number;
  neto_cents?: number;
}

export interface ClubPayValidacion {
  valid: boolean;
  member: ClubPaySocio;
  offers: ClubPayOferta[];
}

export interface ClubPayTransaccion {
  transaction_id: number;
  discount_percent: number;
  ticket_total_cents: number;
  discount_cents: number;
  neto_cents: number;
  /** Qué tope recortó el descuento: "", "base", "por_compra" o "mensual" */
  recorte: string;
  points_earned: number;
  new_balance: number;
}

export const RECORTE_TEXTO: Record<string, string> = {
  base: "Se aplicó sobre el monto máximo que cubre el beneficio",
  por_compra: "Se alcanzó el tope por compra",
  mensual: "Se alcanzó el tope mensual del socio",
};

export const isMockMode = (): boolean => !config.clubpay.apiUrl;

async function api<T>(path: string, apiKey: string, body: unknown): Promise<T> {
  if (!apiKey) {
    throw new HttpError(400, "Este comercio todavía no tiene configurado ClubPay.");
  }

  let res: Response;
  try {
    res = await fetch(`${config.clubpay.apiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const detalle = err instanceof Error ? err.message : "error de red";
    throw new HttpError(502, `No se pudo conectar con ClubPay: ${detalle}`);
  }

  if (!res.ok) {
    const crudo = await res.text();
    let mensaje = `ClubPay respondió ${res.status}`;
    try {
      const data = JSON.parse(crudo) as { error?: string; message?: string };
      // Los mensajes de ClubPay están escritos para que el cajero se los lea
      // al cliente: se muestran tal cual, sin traducir ni acortar.
      mensaje = data.error ?? data.message ?? mensaje;
    } catch { /* cuerpo no JSON */ }
    console.error(`[clubpay] POST ${path} → ${res.status}: ${crudo.slice(0, 400)}`);

    if (res.status === 401) {
      throw new HttpError(400, "La clave de ClubPay del comercio es inválida. Revisá la configuración.");
    }
    throw new HttpError(res.status >= 500 ? 502 : res.status, mensaje);
  }
  return res.json() as Promise<T>;
}

// ── Mock: cubre los casos que hay que poder probar sin la API real ──────────

const MOCK_SOCIOS: Record<string, { member: ClubPaySocio; offers: ClubPayOferta[]; error?: { status: number; msg: string } }> = {
  // 20% sin condiciones
  "QR-SIMPLE": {
    member: { membership_id: 1, name: "Pedro Gómez", member_number: "CU-00001", club_id: 1, club_name: "Club Unión", points: 0 },
    offers: [{
      id: 1, description: "20% de descuento", discount_percent: 20, points_per_use: 0,
      valid_until: null, condiciones: [], aplica_hoy: true, motivo: "",
    }],
  },
  // 20% con tope de $8.000 por compra
  "QR-TOPE": {
    member: { membership_id: 1, name: "Pedro Gómez", member_number: "CU-00001", club_id: 1, club_name: "Club Unión", points: 0 },
    offers: [{
      id: 7, description: "20% con tope de $8.000", discount_percent: 20, points_per_use: 0,
      valid_until: null, condiciones: ["Hasta $8.000 por compra"], aplica_hoy: true, motivo: "",
    }],
  },
  // Beneficio que hoy no corre
  "QR-MIERCOLES": {
    member: { membership_id: 2, name: "Ana Ruiz", member_number: "CU-00002", club_id: 1, club_name: "Club Unión", points: 30 },
    offers: [{
      id: 9, description: "25% los miércoles", discount_percent: 25, points_per_use: 0,
      valid_until: null, condiciones: ["Solo los miércoles"],
      aplica_hoy: false, motivo: "Este beneficio corre solo los miércoles",
    }],
  },
  // Socio válido, sin beneficios en este comercio
  "QR-SIN-OFERTAS": {
    member: { membership_id: 3, name: "Luis Paz", member_number: "CU-00003", club_id: 2, club_name: "Club Atlético", points: 10 },
    offers: [],
  },
  // El plan del socio no permite descuentos
  "QR-PLAN": {
    member: { membership_id: 4, name: "Sofía Díaz", member_number: "CU-00004", club_id: 1, club_name: "Club Unión", points: 0 },
    offers: [],
    error: { status: 403, msg: "El plan de este socio no incluye descuentos en comercios" },
  },
  // Membresía dada de baja
  "QR-INACTIVO": {
    member: { membership_id: 5, name: "Juan Cruz", member_number: "CU-00005", club_id: 1, club_name: "Club Unión", points: 0 },
    offers: [],
    error: { status: 404, msg: "Membresía inactiva" },
  },
};

/** Tope por compra del mock, en centavos (para la oferta QR-TOPE) */
const MOCK_TOPE_POR_COMPRA = 800000;

function mockCalcular(oferta: ClubPayOferta, totalCents: number): { discount: number; recorte: string } {
  let discount = Math.round((totalCents * oferta.discount_percent) / 100);
  let recorte = "";
  if (oferta.id === 7 && discount > MOCK_TOPE_POR_COMPRA) {
    discount = MOCK_TOPE_POR_COMPRA;
    recorte = "por_compra";
  }
  return { discount, recorte };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Valida el QR del socio y devuelve sus beneficios. Si se manda el total del
 * ticket, cada oferta viene con el importe exacto a descontar.
 *
 * El QR vence a los 60 segundos: es lo que evita que una captura reenviada
 * sirva para que otro use el beneficio. No se guarda ni se cachea.
 */
export async function validarQR(
  apiKey: string,
  qrToken: string,
  ticketTotalCents?: number
): Promise<ClubPayValidacion> {
  if (isMockMode()) {
    const token = qrToken.trim().toUpperCase();
    if (token === "QR-VENCIDO") throw new HttpError(400, "QR inválido o expirado");
    const entry = MOCK_SOCIOS[token];
    if (!entry) throw new HttpError(400, "QR inválido o expirado");
    if (entry.error) throw new HttpError(entry.error.status, entry.error.msg);

    const offers = entry.offers.map((o) => {
      if (ticketTotalCents === undefined || !o.aplica_hoy) return { ...o };
      const { discount } = mockCalcular(o, ticketTotalCents);
      return { ...o, discount_cents: discount, neto_cents: ticketTotalCents - discount };
    });
    return { valid: true, member: entry.member, offers };
  }

  return api<ClubPayValidacion>("/pos/qr/validate", apiKey, {
    qr_token: qrToken,
    ...(ticketTotalCents !== undefined ? { ticket_total_cents: ticketTotalCents } : {}),
  });
}

/**
 * Registra la venta en ClubPay. **Esta llamada es la que manda**: ClubPay
 * recalcula con las condiciones vigentes en este momento, así que el importe
 * del comprobante sale de acá y no de la validación previa —entre una y otra
 * pudo pasar la medianoche o el socio pudo haber usado el beneficio en otra
 * caja.
 */
export async function registrarTransaccion(
  apiKey: string,
  datos: { membershipId: number; offerId: number; ticketTotalCents: number }
): Promise<ClubPayTransaccion> {
  if (isMockMode()) {
    const oferta = Object.values(MOCK_SOCIOS)
      .flatMap((s) => s.offers)
      .find((o) => o.id === datos.offerId);
    if (!oferta) throw new HttpError(404, "El beneficio ya no está disponible");
    if (!oferta.aplica_hoy) throw new HttpError(409, oferta.motivo || "El beneficio hoy no aplica");

    const { discount, recorte } = mockCalcular(oferta, datos.ticketTotalCents);
    return {
      transaction_id: Math.floor(Math.random() * 9000) + 1000,
      discount_percent: oferta.discount_percent,
      ticket_total_cents: datos.ticketTotalCents,
      discount_cents: discount,
      neto_cents: datos.ticketTotalCents - discount,
      recorte,
      points_earned: oferta.points_per_use,
      new_balance: oferta.points_per_use,
    };
  }

  return api<ClubPayTransaccion>("/pos/transactions", apiKey, {
    membership_id: datos.membershipId,
    offer_id: datos.offerId,
    ticket_total_cents: datos.ticketTotalCents,
  });
}

// ── QR mostrado por el comercio ──────────────────────────────────────────────

/**
 * En el mostrador real el comercio casi nunca puede escanear el QR del socio:
 * tiene un lector láser de código de barras, que lee 1D, y un QR es 2D. El
 * flujo se da vuelta: el POS muestra un QR con el comercio y el importe, y el
 * socio lo escanea con su teléfono, que sí tiene cámara y ya tiene la app.
 *
 * Contrato en docs/CLUBPAY-QR-DEL-COMERCIO.md. Mientras ClubPay no publique
 * estos endpoints, el simulador de abajo permite usarlo igual.
 */

export type EstadoCharge = "pending" | "applied" | "rejected" | "expired" | "cancelled";

export interface ClubPayCharge {
  charge_id: string;
  /** Texto que el POS codifica en el QR que muestra en pantalla */
  qr_payload: string;
  expires_at: string;
  status: EstadoCharge;
}

export interface ClubPayChargeEstado {
  charge_id: string;
  status: EstadoCharge;
  member?: ClubPaySocio | null;
  offer?: Pick<ClubPayOferta, "id" | "description" | "discount_percent" | "condiciones"> | null;
  transaction_id?: number;
  ticket_total_cents?: number;
  discount_cents?: number;
  neto_cents?: number;
  recorte?: string;
  points_earned?: number;
  /** Motivo cuando el socio escaneó pero no le corresponde beneficio */
  error?: string;
}

async function apiGet<T>(path: string, apiKey: string): Promise<T> {
  if (!apiKey) throw new HttpError(400, "Este comercio todavía no tiene configurado ClubPay.");
  let res: Response;
  try {
    res = await fetch(`${config.clubpay.apiUrl}${path}`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const detalle = err instanceof Error ? err.message : "error de red";
    throw new HttpError(502, `No se pudo conectar con ClubPay: ${detalle}`);
  }
  if (!res.ok) {
    const crudo = await res.text();
    let mensaje = `ClubPay respondió ${res.status}`;
    try {
      const data = JSON.parse(crudo) as { error?: string; message?: string };
      mensaje = data.error ?? data.message ?? mensaje;
    } catch { /* cuerpo no JSON */ }
    console.error(`[clubpay] GET ${path} → ${res.status}: ${crudo.slice(0, 400)}`);
    throw new HttpError(res.status >= 500 ? 502 : res.status, mensaje);
  }
  return res.json() as Promise<T>;
}

/** Simulador: el charge pasa a "applied" a los pocos segundos, como si el socio hubiera escaneado */
const mockCharges = new Map<string, { creado: number; totalCents: number; qr: string }>();
const MOCK_SEGUNDOS_HASTA_ESCANEO = 6;
const MOCK_MINUTOS_VIGENCIA = 3;

export async function crearCharge(
  apiKey: string,
  datos: { ticketTotalCents: number; externalReference: string }
): Promise<ClubPayCharge> {
  if (isMockMode()) {
    const id = `chg_demo_${Date.now().toString(36)}`;
    mockCharges.set(id, {
      creado: Date.now(),
      totalCents: datos.ticketTotalCents,
      qr: `clubpay://charge/${id}`,
    });
    return {
      charge_id: id,
      qr_payload: `clubpay://charge/${id}`,
      expires_at: new Date(Date.now() + MOCK_MINUTOS_VIGENCIA * 60_000).toISOString(),
      status: "pending",
    };
  }
  return api<ClubPayCharge>("/pos/charges", apiKey, {
    ticket_total_cents: datos.ticketTotalCents,
    external_reference: datos.externalReference,
  });
}

export async function consultarCharge(apiKey: string, chargeId: string): Promise<ClubPayChargeEstado> {
  if (isMockMode()) {
    const ch = mockCharges.get(chargeId);
    if (!ch) throw new HttpError(404, "Cobro no encontrado");
    const segundos = (Date.now() - ch.creado) / 1000;
    if (segundos > MOCK_MINUTOS_VIGENCIA * 60) {
      return { charge_id: chargeId, status: "expired" };
    }
    if (segundos < MOCK_SEGUNDOS_HASTA_ESCANEO) {
      return { charge_id: chargeId, status: "pending" };
    }
    // El socio escaneó y confirmó: 20% con tope de $8.000
    const bruto = Math.round(ch.totalCents * 0.2);
    const discount = Math.min(bruto, 800000);
    return {
      charge_id: chargeId,
      status: "applied",
      member: { membership_id: 1, name: "Pedro Gómez", member_number: "CU-00001", club_id: 1, club_name: "Club Unión", points: 0 },
      offer: { id: 7, description: "20% con tope de $8.000", discount_percent: 20, condiciones: ["Hasta $8.000 por compra"] },
      transaction_id: Math.floor(Math.random() * 9000) + 1000,
      ticket_total_cents: ch.totalCents,
      discount_cents: discount,
      neto_cents: ch.totalCents - discount,
      recorte: discount < bruto ? "por_compra" : "",
      points_earned: 0,
    };
  }
  return apiGet<ClubPayChargeEstado>(`/pos/charges/${chargeId}`, apiKey);
}

export async function cancelarCharge(apiKey: string, chargeId: string): Promise<void> {
  if (isMockMode()) {
    mockCharges.delete(chargeId);
    return;
  }
  await api(`/pos/charges/${chargeId}/cancel`, apiKey, {});
}

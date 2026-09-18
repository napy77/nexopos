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
  // El contrato del cobro no incluye `condiciones`: la letra chica se
  // explica con `recorte`, que dice qué tope actuó.
  offer?: Pick<ClubPayOferta, "id" | "description" | "discount_percent"> & { condiciones?: string[] } | null;
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
/** external_reference → charge_id, para que el simulador sea idempotente como la API real */
const mockRefs = new Map<string, string>();
const MOCK_SEGUNDOS_HASTA_ESCANEO = 6;
const MOCK_MINUTOS_VIGENCIA = 3;

export async function crearCharge(
  apiKey: string,
  datos: { ticketTotalCents: number; externalReference: string }
): Promise<ClubPayCharge> {
  if (isMockMode()) {
    // Idempotente por external_reference, igual que la API real: reintentar
    // devuelve el mismo cobro y no uno nuevo por la misma compra. El
    // simulador lo respeta para que esto se pueda probar sin salir a la red;
    // un mock que se porta distinto del contrato esconde justo los errores
    // que tendría que hacer visibles.
    const yaCreado = mockRefs.get(datos.externalReference);
    if (yaCreado) {
      const ch = mockCharges.get(yaCreado)!;
      return {
        charge_id: yaCreado,
        qr_payload: ch.qr,
        expires_at: new Date(ch.creado + MOCK_MINUTOS_VIGENCIA * 60_000).toISOString(),
        status: "pending",
      };
    }
    const id = `chg_demo_${Date.now().toString(36)}`;
    // Con la misma forma que el de verdad: una URL https. El QR real es una
    // URL a propósito, para que quien escanee con la cámara sin tener la app
    // caiga en una página que le explica qué es. Un esquema propio tipo
    // clubpay:// no lo abre nadie y el QR parece roto — y si el simulador
    // usara uno, probar acá no diría nada sobre lo que va a pasar afuera.
    const payload = `https://api.clubpay.com.ar/c/${id}`;
    mockCharges.set(id, { creado: Date.now(), totalCents: datos.ticketTotalCents, qr: payload });
    mockRefs.set(datos.externalReference, id);
    return {
      charge_id: id,
      qr_payload: payload,
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

// ── Cuenta corriente del cliente en la app ───────────────────────────────────

/**
 * El cliente de un almacén ve en ClubPay lo que hoy está en un cuaderno: qué
 * compró en cuenta y cuánto debe. NexoPOS es la fuente de verdad y le empuja
 * los hechos a ClubPay a medida que pasan; ClubPay guarda una copia para
 * mostrarla rápido.
 *
 * Dos cosas que no son detalles de implementación:
 *
 * - **No hay períodos.** NexoPOS lleva saldo corriente, sin cierre mensual ni
 *   vencimientos, porque el almacenero cobra cuando el cliente pasa y no el
 *   día 10. Por eso acá no viaja ningún `period` ni existen los resúmenes: un
 *   campo que parece contable pero es un mes derivado de la fecha, tarde o
 *   temprano alguien lo lee como un corte.
 *
 * - **Van con la clave del comercio**, no con una de plataforma. Son
 *   operaciones de un comercio sobre sus propios clientes, así que si la clave
 *   se filtra el alcance del daño es ese comercio y no el ecosistema entero.
 *
 * Contrato en docs/CLUBPAY-CUENTA-CORRIENTE.md.
 */

/** Los cuatro hechos que le pueden pasar a una cuenta corriente */
export type MovimientoKind = "compra" | "pago" | "ajuste" | "devolucion";

export interface MovimientoCuenta {
  external_id: string;
  movement_id: string;
  kind: MovimientoKind;
  /**
   * Con signo: positivo aumenta la deuda, negativo la baja. El signo va acá y
   * no en el `kind` porque un ajuste que sube y uno que baja son el mismo
   * hecho —una corrección— y separarlos en dos tipos sería decir dos veces lo
   * mismo.
   */
  amount_cents: number;
  occurred_at: string;
  description: string;
}

export interface VinculacionCliente {
  encontrado: boolean;
  /**
   * En la base de ClubPay el vínculo aceptado se llama `vinculada`; en su
   * documentación aparece como `aceptada`. Se aceptan las dos.
   */
  status: "sin_cuenta" | "propuesta" | "vinculada" | "aceptada" | "rechazada";
  persona?: string;
  mensaje?: string;
}

/**
 * Si la persona aceptó ver esta cuenta en su teléfono.
 *
 * Las dos formas conviven a propósito. Ya nos pasó con los estados de las
 * órdenes de NexoB2B: la guarda comparaba contra la palabra de la
 * documentación, la API mandaba otra, y como la comparación simplemente
 * nunca daba verdadero no falló nada —siguió de largo—. Un vínculo que no
 * matchea acá no rompe nada tampoco: deja de mandar movimientos y el cliente
 * ve una cuenta vacía sin que nadie se entere.
 */
export const vinculacionAceptada = (status: string | null | undefined): boolean =>
  status === "vinculada" || status === "aceptada";

/**
 * Le propone a una persona vincular su cuenta corriente de este comercio con
 * su cuenta de ClubPay.
 *
 * Nace como propuesta y no como vínculo hecho porque en el mostrador se tipean
 * DNI mal, y un dígito de más hace que el match caiga en otra persona que abre
 * la app y ve la deuda de un desconocido. Hasta que la persona confirma,
 * ClubPay no le muestra ningún saldo.
 *
 * Que el DNI no esté en ClubPay tampoco es un error: la mayoría de los
 * clientes de un almacén no tienen la app y la cuenta anda igual.
 */
export async function vincularCliente(
  apiKey: string,
  datos: { dni: string; externalId: string }
): Promise<VinculacionCliente> {
  if (isMockMode()) {
    // El último dígito del DNI elige el caso, para poder probar los tres:
    // 0 = no está en ClubPay, 9 = ya aceptó, el resto queda propuesto.
    if (datos.dni.endsWith("0")) {
      return { encontrado: false, status: "sin_cuenta", mensaje: "El DNI no tiene cuenta en ClubPay" };
    }
    if (datos.dni.endsWith("9")) {
      return { encontrado: true, status: "vinculada", persona: "Germán Yovan" };
    }
    return {
      encontrado: true,
      status: "propuesta",
      persona: "Germán Yovan",
      mensaje: "Le propusimos la vinculación: la ve en su app y decide si la acepta",
    };
  }
  return api<VinculacionCliente>("/pos/customers", apiKey, {
    dni: datos.dni,
    external_id: datos.externalId,
  });
}

/**
 * Avisa un movimiento de cuenta corriente. Idempotente por `movement_id`: si
 * la red se corta después de que ClubPay lo recibió, el reintento no duplica.
 */
export async function empujarMovimiento(apiKey: string, mov: MovimientoCuenta): Promise<void> {
  if (isMockMode()) {
    console.log(`[clubpay:mock] movimiento ${mov.movement_id} ${mov.kind} ${mov.amount_cents} → ${mov.external_id}`);
    return;
  }
  await api<unknown>("/pos/account/movements", apiKey, mov);
}

/**
 * Consulta en qué quedó una vinculación, sin proponer nada y sin mandar DNI.
 *
 * Es la ruta que pedimos y que resuelve el problema de fondo: hasta ahora, para
 * saber el estado había que volver a llamar a la que escribe, y escribir
 * implica mandar el documento. Con esto el DNI viaja una sola vez en la vida de
 * la relación, que es lo que dice el acuerdo.
 */
export async function consultarVinculacion(
  apiKey: string,
  externalId: string
): Promise<VinculacionCliente & { account_id?: string }> {
  if (isMockMode()) {
    return { encontrado: true, status: "propuesta", persona: "Germán Yovan" };
  }
  return apiGet<VinculacionCliente & { account_id?: string }>(
    `/pos/customers/${encodeURIComponent(externalId)}`,
    apiKey
  );
}

/** Un resumen cerrado. Se reenvía cada vez que cambia lo pagado. */
export interface ResumenCuenta {
  external_id: string;
  statement_id: string;
  label: string;
  period_start: string;
  period_end: string;
  total_cents: number;
  paid_cents: number;
  due_date: string | null;
  closed_at: string | null;
}

export async function empujarResumen(apiKey: string, resumen: ResumenCuenta): Promise<void> {
  if (isMockMode()) {
    console.log(`[clubpay:mock] resumen ${resumen.statement_id} total ${resumen.total_cents} pagado ${resumen.paid_cents} → ${resumen.external_id}`);
    return;
  }
  await api<unknown>("/pos/account/statements", apiKey, resumen);
}

// ── Handoff: la persona salta de ClubPay a la tienda ────────────────────────

export interface SesionTienda {
  account_id: string;
  external_id: string;
  persona?: string | null;
}

/**
 * Le pregunta a ClubPay de quién es este token de entrada.
 *
 * El token lo emite ClubPay cuando la persona toca "Ir a la tienda" en su app;
 * NexoTienda nos lo trae y nosotros preguntamos. **Preguntar es mejor que que
 * nos lo empujen al emitirlo**, que era lo que habíamos propuesto: así el token
 * vive en un solo sistema —el que lo creó— y no existe el estado "emitido allá,
 * no llegado acá", que es el que alguien tendría que diagnosticar a las once de
 * la noche porque un cliente no puede entrar.
 *
 * Va con la clave del comercio, no con una de plataforma, y eso es lo que hace
 * que un token emitido para un comercio no pueda abrir la tienda de otro:
 * ClubPay lo valida contra la clave y no coincide.
 */
export async function canjearTokenTienda(apiKey: string, token: string): Promise<SesionTienda> {
  if (isMockMode()) {
    // En demo, el token es el external_id: alcanza para probar el circuito
    // entero sin ClubPay, y un token que no empieza con CLI- se rechaza.
    if (!token.startsWith("CLI-")) throw new HttpError(401, "Token inválido o vencido");
    return { account_id: `acc_mock_${token}`, external_id: token, persona: "Germán Yovan" };
  }
  return saltoAClubPay("el token de entrada", () =>
    api<SesionTienda>("/pos/tienda/sessions", apiKey, { token }));
}

// ── Emparejar dos pantallas ─────────────────────────────────────────────────

export interface PedidoEmparejamiento {
  request_id: string;
  code: string;
  expira_at: string;
}

/**
 * Lo que devuelve ClubPay, leído con tolerancia de nombres.
 *
 * No tenemos su especificación escrita: la forma nos llega contada por
 * NexoTienda. Aceptar las dos convenciones de nombre cuesta cinco líneas y
 * ahorra un ida y vuelta de tres equipos, que es lo que ya costó una vez.
 */
function leerPedido(d: Record<string, unknown>): PedidoEmparejamiento {
  const str = (...claves: string[]): string => {
    for (const k of claves) if (typeof d[k] === "string" && d[k]) return d[k] as string;
    return "";
  };
  const pedido = {
    request_id: str("request_id", "requestId", "id"),
    code: str("code", "codigo"),
    expira_at: str("expira_at", "expires_at", "expiresAt"),
  };
  if (!pedido.request_id || !pedido.code) {
    console.error("[clubpay] emparejamiento con forma inesperada:", JSON.stringify(d).slice(0, 300));
    throw new HttpError(502, "ClubPay devolvió un pedido de emparejamiento que no entendemos.");
  }
  return pedido;
}

/**
 * Un 404 de ClubPay NO puede salir como 404 nuestro.
 *
 * Esto costó un ida y vuelta entre tres equipos: NexoTienda lee un 404 como
 * "la ruta de NexoPOS no existe" —y está bien que lo lea así— mientras que acá
 * significaba "ClubPay no tiene esa ruta". Dos causas opuestas, el mismo número,
 * y cada equipo señalando al de al lado.
 *
 * Hacia afuera es 502: el pedido de quien nos llamó estaba bien, lo que falló
 * fue el salto de atrás. Y el mensaje dice cuál.
 */
async function saltoAClubPay<T>(que: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError(502, `ClubPay no reconoce ${que}. La ruta de NexoPOS existe; lo que falta está del otro lado.`);
    }
    throw err;
  }
}

export type EstadoEmparejamiento =
  | { status: "pendiente" }
  | { status: "listo"; token: string }
  | { status: "vencido" };

/**
 * Pide un código corto para abrir la libreta en otra pantalla.
 *
 * El caso: la tienda abierta en la computadora de casa y ClubPay en el
 * teléfono. El handoff no sirve —abre la tienda EN el teléfono— y la compu no
 * tiene con qué demostrar quién es. Un QR tampoco: nadie escanea su propia
 * pantalla.
 *
 * `dispositivo` es lo que el navegador dice de sí mismo y viaja tal cual, sin
 * agregarle nada. Sirve para que la persona reconozca su propia compu en la
 * pantalla de confirmación. **No es una prueba**: en el ataque que este
 * mecanismo tiene que resistir, el que pide es el atacante, así que ese texto lo
 * escribe él. Lo que la persona sí puede creer es el nombre del comercio, que
 * ClubPay deduce de la clave y no de lo que le mandamos.
 */
const mockPares = new Map<string, { creado: number; commerceId: number }>();

export async function pedirEmparejamiento(
  apiKey: string, datos: { dispositivo?: string; commerceId: number }
): Promise<PedidoEmparejamiento> {
  if (isMockMode()) {
    const id = `par_mock_${Date.now()}`;
    mockPares.set(id, { creado: Date.now(), commerceId: datos.commerceId });
    return {
      request_id: id,
      // Sin I, O, 0 ni 1: alguien tiene que leer esto en voz alta o copiarlo de
      // una pantalla a un teléfono.
      code: "VRCCX",
      expira_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }
  /*
   * El nombre de la ruta lo dijo NexoTienda, que lo habló con ClubPay. Nosotros
   * habíamos inventado uno en inglés —`/pos/tienda/pairings`— y ClubPay
   * contestaba 404, que es exactamente el síntoma que los tres estábamos
   * mirando sin entender.
   */
  const d = await saltoAClubPay(
    "el pedido de emparejamiento",
    () => api<Record<string, unknown>>("/pos/tienda/emparejar", apiKey, {
      device: datos.dispositivo ?? null,
      client_hint: datos.dispositivo ?? null,
    })
  );
  return leerPedido(d);
}

/** ¿Ya lo aprobó desde la app? */
export async function estadoEmparejamiento(
  apiKey: string, requestId: string, resolverTokenMock?: () => Promise<string | null>
): Promise<EstadoEmparejamiento> {
  if (isMockMode()) {
    const p = mockPares.get(requestId);
    if (!p) return { status: "vencido" };
    // Se da por aprobado a los cinco segundos, como el cobro por QR del mock:
    // alcanza para probar el circuito entero sin la app.
    if (Date.now() - p.creado < 5_000) return { status: "pendiente" };
    const token = resolverTokenMock ? await resolverTokenMock() : null;
    if (!token) return { status: "vencido" };
    mockPares.delete(requestId);
    return { status: "listo", token };
  }
  return saltoAClubPay(
    "ese pedido de emparejamiento",
    () => apiGet<EstadoEmparejamiento>(
      `/pos/tienda/emparejar/${encodeURIComponent(requestId)}`, apiKey
    )
  );
}

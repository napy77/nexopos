/** Lo que devuelve el backend, tal cual. Los NUMERIC de Postgres llegan como string. */

export interface StockItem {
  product_id: number; name: string; ean: string | null; category: string | null;
  pasillo_nombre: string | null; rubro_nombre: string | null; subrubro_nombre: string | null;
  image_url: string | null; quantity: string; sale_price: string | null;
  origen: string; plu: string | null; venta_por_peso: boolean;
  // Los usa la pantalla de Productos; el mostrador no los necesita
  unit?: string; brand?: string | null; descripcion?: string | null;
  cost?: string | null; min_stock?: string; low_stock?: boolean;
  pasillo_id?: string | null; rubro_id?: string | null; subrubro_id?: string | null;
}

export interface Customer {
  id: number; name: string; balance: string;
  doc_number?: string | null; phone?: string | null; email?: string | null;
}

export interface Sale {
  id: number; ticket_number: number; payment_method: string; total: string;
  created_at: string; customer_name: string | null; refund_of: number | null; refunded_by: number | null;
  operado_por?: string | null;
}

export interface Resumen {
  apertura: number;
  ventasPorMedio: Record<string, { tickets: number; total: number }>;
  cobrosCuentaCorriente: Record<string, number>;
  totalCobrosCuentaCorriente: number;
  cuponesEntregados: number;
  ingresos: number;
  egresos: number;
  totalVendido: number;
  totalTickets: number;
  efectivoEsperado: number;
}

export interface Cierre extends Resumen { contado: number; diferencia: number }

export interface EstadoCaja {
  abierta: boolean;
  sesion?: { id: number; opened_at: string; opening_amount: string };
  resumen?: Resumen;
  movimientos?: { id: number; type: string; amount: string; note: string; created_at: string }[];
}

export interface SesionCerrada {
  id: number; opened_at: string; closed_at: string;
  opening_amount: string; counted_amount: string; closing_note: string | null;
  closing_summary: Cierre | null;
}

export const MEDIO_LABEL: Record<string, string> = {
  cash: "Efectivo", wallet: "Billetera", card: "Tarjeta", transfer: "Transferencia",
  account: "Cuenta corriente", mercadopago: "Mercado Pago", coupon: "Cupón ClubPay",
};

/** Fecha y hora del negocio, siempre en Córdoba (CLAUDE.md, regla 3) */
export const fechaHora = (v: string | Date) =>
  new Date(v).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone: "America/Argentina/Cordoba",
  });

// ── ClubPay (copia de frontend/lib/clubpay.ts) ───────────────────────────────

export interface ClubPaySocio {
  membership_id: number; name: string; member_number: string;
  club_id: number; club_name: string; points: number;
}

export interface ClubPayOferta {
  id: number; description: string; discount_percent: number; points_per_use: number;
  valid_until: string | null;
  /** La letra chica, en palabras, para poder explicarla en el mostrador */
  condiciones: string[];
  aplica_hoy: boolean;
  /** Por qué hoy no corre. Está escrito para leérselo al cliente */
  motivo: string;
  discount_cents?: number;
  neto_cents?: number;
}

export interface ClubPayValidacion { valid: boolean; member: ClubPaySocio; offers: ClubPayOferta[] }

export interface ClubPayElegido { socio: ClubPaySocio; oferta: ClubPayOferta; descuento: number }

export type EstadoCobro = "pending" | "applied" | "rejected" | "expired" | "cancelled";

export interface ClubPayCobro {
  charge_id: string; qr_data_url: string; qr_payload: string; expires_at: string; status: EstadoCobro;
}

export interface ClubPayCobroEstado {
  charge_id: string; status: EstadoCobro;
  member?: ClubPaySocio | null;
  offer?: { id: number; description: string; discount_percent: number; condiciones?: string[] } | null;
  descuento: number | null; neto: number | null; recorteTexto: string | null; error?: string;
}

/** El cobro con Mercado Pago en pantalla. Ver backend/src/modules/mercadopago.ts */
export interface CobroMP {
  paymentId: string; qrDataUrl: string; qrData?: string; expiresAt?: string | null; monto: number;
  status: "pending" | "paid" | "rejected" | "expired" | "cancelled" | "refunded";
  error?: string | null;
}

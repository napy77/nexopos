"use client";

/** Tipos de ClubPay tal como los devuelve el backend del POS. */

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
  /** La letra chica, en palabras, para poder explicarla en el mostrador */
  condiciones: string[];
  aplica_hoy: boolean;
  /** Por qué hoy no corre. Se muestra tal cual: está escrito para leérselo al cliente */
  motivo: string;
  discount_cents?: number;
  neto_cents?: number;
}

export interface ClubPayValidacion {
  valid: boolean;
  member: ClubPaySocio;
  offers: ClubPayOferta[];
}

/** El descuento elegido para esta venta, tal como lo devolvió ClubPay */
export interface ClubPayElegido {
  socio: ClubPaySocio;
  oferta: ClubPayOferta;
  /** Importe en pesos que ClubPay calculó para este ticket */
  descuento: number;
}

export const centavosAPesos = (c: number): number => c / 100;

// ── QR mostrado por el comercio ──────────────────────────────────────────────

export type EstadoCobro = "pending" | "applied" | "rejected" | "expired" | "cancelled";

export interface ClubPayCobro {
  charge_id: string;
  /** El QR ya dibujado por el backend, listo para mostrar en pantalla */
  qr_data_url: string;
  expires_at: string;
  status: EstadoCobro;
}

export interface ClubPayCobroEstado {
  charge_id: string;
  status: EstadoCobro;
  member?: ClubPaySocio | null;
  offer?: { id: number; description: string; discount_percent: number; condiciones: string[] } | null;
  transaction_id?: number;
  descuento: number | null;
  neto: number | null;
  recorteTexto: string | null;
  error?: string;
}

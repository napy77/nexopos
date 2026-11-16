"use client";

/**
 * La venta que se está armando en el mostrador, guardada en esta caja.
 *
 * Sin esto vive sólo en memoria: un corte de luz, una recarga o cerrar la
 * ventana con internet caído se llevan lo que el cajero ya había escaneado.
 *
 * Se guardan los renglones y el cliente, nada más. El descuento de ClubPay y
 * el QR de Mercado Pago vencen en minutos y se piden de nuevo al cobrar.
 */

const KEY = "nexopos_venta_en_curso";
// Una venta de ayer no es una venta en curso: los precios y el stock ya son
// otros, y nadie se acuerda de a quién era.
const VENCE_MS = 12 * 60 * 60 * 1000;

interface Guardada<L> {
  /** De qué comercio es: otra cuenta en la misma PC no la tiene que ver. */
  commerceId: number | null;
  cuando: number;
  lines: L[];
  customerId: number | "";
}

function comercioActual(): number | null {
  try {
    return JSON.parse(localStorage.getItem("nexopos_commerce") ?? "{}").id ?? null;
  } catch {
    return null;
  }
}

export function guardarVentaEnCurso<L>(lines: L[], customerId: number | ""): void {
  try {
    if (lines.length === 0) {
      localStorage.removeItem(KEY);
      return;
    }
    const dato: Guardada<L> = { commerceId: comercioActual(), cuando: Date.now(), lines, customerId };
    localStorage.setItem(KEY, JSON.stringify(dato));
  } catch {
    /* sin lugar o sin permiso: la venta sigue en memoria, como antes */
  }
}

export function leerVentaEnCurso<L>(): { lines: L[]; customerId: number | "" } | null {
  try {
    const dato = JSON.parse(localStorage.getItem(KEY) ?? "null") as Guardada<L> | null;
    if (!dato || !Array.isArray(dato.lines) || dato.lines.length === 0) return null;
    if (dato.commerceId !== comercioActual() || Date.now() - dato.cuando > VENCE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { lines: dato.lines, customerId: dato.customerId ?? "" };
  } catch {
    return null;
  }
}

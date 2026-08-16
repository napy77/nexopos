"use client";

import { getToken } from "./api";

/**
 * Preferencias de impresión. Se guardan por DISPOSITIVO (localStorage), no
 * por comercio: cada caja puede tener su propia impresora y su propio papel.
 */
export interface PrintSettings {
  /** Imprimir automáticamente al emitir el ticket */
  autoPrint: boolean;
  /** Ancho del papel: ticketera térmica o impresora común */
  width: "80mm" | "58mm" | "auto";
}

const KEY = "nexopos_print_settings";

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { autoPrint: true, width: "80mm" };

export function loadPrintSettings(): PrintSettings {
  if (typeof window === "undefined") return DEFAULT_PRINT_SETTINGS;
  try {
    return { ...DEFAULT_PRINT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintSettings(settings: PrintSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

/**
 * Manda el ticket a la impresora sin descargar nada: pide el HTML a la API
 * (con el token en el header, por eso no se puede apuntar el iframe a la URL
 * directamente), lo monta en un iframe oculto y dispara print() sobre él.
 *
 * El navegador siempre muestra su diálogo de impresión, salvo que Chrome
 * corra con --kiosk-printing, que imprime en la impresora predeterminada
 * sin preguntar (es la configuración recomendada para la caja).
 */
export async function printTicket(saleId: number, settings?: PrintSettings): Promise<void> {
  const { width } = settings ?? loadPrintSettings();
  return printDesdeApi(`/api/sales/${saleId}/ticket.html?width=${width}`);
}

/**
 * Imprime el resumen de un turno de caja: el cierre completo si ya cerró, o
 * un corte parcial si sigue abierto. Sale con el mismo ancho de papel que
 * los tickets.
 */
export async function printCierreCaja(sessionId: number, settings?: PrintSettings): Promise<void> {
  const { width } = settings ?? loadPrintSettings();
  return printDesdeApi(`/api/caja/${sessionId}/resumen.html?width=${width}`);
}

/** Pide el HTML a la API (con el token) y lo manda a la impresora. */
async function printDesdeApi(path: string): Promise<void> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("No se pudo generar el documento para imprimir");
  const html = await res.text();

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    iframe.srcdoc = html;
  });

  const win = iframe.contentWindow;
  if (win) {
    win.focus();
    win.print();
  }
  // Dar tiempo al diálogo de impresión antes de desmontar el iframe
  setTimeout(() => iframe.remove(), 60_000);
}

/** Abre el ticket en PDF en una pestaña nueva (guardar o reimprimir). */
export async function openTicketPdf(saleId: number): Promise<void> {
  const res = await fetch(`/api/sales/${saleId}/ticket.pdf`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), "_blank");
}

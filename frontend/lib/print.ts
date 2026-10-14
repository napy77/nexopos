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
  return printHtml(await res.text());
}

const escapar = (t: string): string =>
  t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Lo que cambia entre el papel de ClubPay y el de Mercado Pago */
const PAPEL_QR = {
  clubpay: {
    titulo: "Descuento para socios ClubPay",
    instruccion: "Escaneá este código con la app ClubPay",
  },
  mercadopago: {
    titulo: "Pagá con Mercado Pago",
    instruccion: "Escaneá este código con Mercado Pago o cualquier billetera que lea QR",
  },
} as const;

/**
 * El QR de un cobro en papel —el descuento de ClubPay o el pago con Mercado
 * Pago— para la caja donde la pantalla no da hacia el cliente: se corta, se le
 * da, y lo escanea con su teléfono.
 *
 * Se arma acá y no en el backend porque el QR ya está dibujado en la pantalla
 * y vive unos minutos. Los márgenes y el
 * ancho siguen a `estilosImpresion` de backend/src/modules/ticket-render.ts,
 * para que salga igual que un ticket.
 *
 * El papel dice hasta qué hora sirve. Un QR impreso parece que vale para
 * siempre, y éste vence a los pocos minutos: el cliente que lo guarda en el
 * bolsillo y lo escanea en la vereda tiene que saber por qué no anda.
 */
export async function printQrCobro(datos: {
  medio: keyof typeof PAPEL_QR;
  qrDataUrl: string;
  total: string;
  /** Si no se sabe, el papel no promete una hora */
  venceA: string | null;
}, settings?: PrintSettings): Promise<void> {
  const papel = PAPEL_QR[datos.medio];
  const { width } = settings ?? loadPrintSettings();
  const esTermica = width !== "auto";
  const contenido = width === "80mm" ? "72mm" : width === "58mm" ? "50mm" : "100%";
  const lado = width === "58mm" ? "40mm" : "50mm";
  let comercio = "";
  try {
    comercio = JSON.parse(localStorage.getItem("nexopos_commerce") ?? "{}").name ?? "";
  } catch { /* sin nombre, sale igual */ }
  const hora = datos.venceA ? new Date(datos.venceA).toLocaleTimeString("es-AR", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Cordoba",
  }) : null;

  return printHtml(`<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${esTermica ? `${width} auto` : "auto"}; margin: ${esTermica ? "0" : "10mm"}; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: ${esTermica ? "4mm 2mm" : "0"}; width: ${contenido};
           font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
           font-size: 12px; line-height: 1.35; color: #000; background: #fff; text-align: center; }
    .comercio { font-size: 15px; font-weight: 700; }
    .sep { border-top: 1px solid #000; margin: 6px 0; }
    img { width: ${lado}; height: ${lado}; image-rendering: pixelated; margin: 4px auto; display: block; }
    .total { font-size: 17px; font-weight: 700; }
    .vence { font-weight: 700; margin-top: 6px; }
  </style></head><body>
    <div class="comercio">${escapar(comercio)}</div>
    <div>${papel.titulo}</div>
    <div class="sep"></div>
    <div>${papel.instruccion}</div>
    <img src="${datos.qrDataUrl}" alt="">
    <div>Total de la compra</div>
    <div class="total">${escapar(datos.total)}</div>
    <div class="sep"></div>
    ${hora ? `<div class="vence">Vale hasta las ${hora}</div>` : ""}
    <div>Si se vence, pedí otro en la caja.</div>
  </body></html>`);
}

/** Monta el HTML en un iframe oculto y lo manda a la impresora. */
async function printHtml(html: string): Promise<void> {
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

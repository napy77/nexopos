/**
 * Ticket de venta y resumen de caja en ESC/POS, para la app de tablet y
 * celular (`mobile/`), que manda los bytes tal cual a la térmica por red o por
 * Bluetooth.
 *
 * Se arma acá y no en la app por lo mismo que el HTML: el formato del ticket
 * vive en un solo lugar y cambia con un deploy. La app pasa por las tiendas
 * para cada versión, y una app vieja instalada en un mostrador seguiría
 * imprimiendo el ticket viejo.
 *
 * El contenido sigue a `renderTicketHtml` y `renderCierreHtml` renglón por
 * renglón. Si se agrega un dato a uno, va en el otro.
 */

import { ZONA } from "../lib/fechas.js";
import { fmtMoney, fmtQty, PAYMENT_LABEL, type TicketData } from "./ticket-render.js";
import type { CierreData } from "./caja-render.js";

export type AnchoTermica = "80mm" | "58mm";

/** Caracteres por renglón en la fuente A, la que trae de fábrica toda térmica */
const COLUMNAS: Record<AnchoTermica, number> = { "80mm": 48, "58mm": 32 };

/*
 * Página de códigos PC850 (ESC t 2): la que traen las térmicas genéricas y
 * Epson para español. Sin esto la «ñ» y los acentos salen como basura, porque
 * la impresora no sabe nada de UTF-8.
 */
const PC850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, "¡": 0xad, "¿": 0xa8, º: 0xa7, ª: 0xa6, "°": 0xf8, "·": 0xfa,
};

/** Lo tipográfico que trae el catálogo («Gaseosa — 1,5 L») y la térmica no tiene */
const REEMPLAZOS: Record<string, string> = {
  "—": "-", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", " ": " ",
};

function codificar(texto: string): number[] {
  const out: number[] = [];
  for (const ch of [...texto].map((c) => REEMPLAZOS[c] ?? c).join("")) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) out.push(code);
    else if (PC850[ch] !== undefined) out.push(PC850[ch]);
    else {
      // Lo que la página no tiene se imprime sin el acento antes que como «?»
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out.push(...[...base].map((c) => (c.charCodeAt(0) < 0x7f ? c.charCodeAt(0) : 0x3f)));
    }
  }
  return out;
}

/** Arma el documento de a renglones; `ancho` son columnas de la fuente A. */
class Escpos {
  private bytes: number[] = [0x1b, 0x40, 0x1b, 0x74, 0x02];
  constructor(readonly ancho: number) {}

  private raw(...b: number[]) { this.bytes.push(...b); return this; }
  alinear(a: "izq" | "centro") { return this.raw(0x1b, 0x61, a === "centro" ? 1 : 0); }
  negrita(on: boolean) { return this.raw(0x1b, 0x45, on ? 1 : 0); }
  /** Doble alto: no cambia el ancho, así las columnas siguen cuadrando */
  alto(on: boolean) { return this.raw(0x1d, 0x21, on ? 0x01 : 0x00); }

  texto(t: string) {
    for (const renglon of partir(t, this.ancho)) this.raw(...codificar(renglon), 0x0a);
    return this;
  }
  /** Etiqueta a la izquierda y valor a la derecha, como `.linea` del HTML */
  fila(etiqueta: string, valor: string) {
    const espacio = this.ancho - valor.length - 1;
    if (etiqueta.length > espacio) {
      this.texto(etiqueta);
      return this.raw(...codificar(valor.padStart(this.ancho)), 0x0a);
    }
    return this.raw(...codificar(etiqueta.padEnd(this.ancho - valor.length) + valor), 0x0a);
  }
  separador(c = "-") { return this.raw(...codificar(c.repeat(this.ancho)), 0x0a); }
  cortar() { return this.raw(0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00); }
  base64() { return Buffer.from(this.bytes).toString("base64"); }
}

/** Corta por palabras; una palabra más larga que el renglón se parte igual. */
function partir(t: string, ancho: number): string[] {
  const renglones: string[] = [];
  let actual = "";
  for (const palabra of t.split(/\s+/).filter(Boolean)) {
    let p = palabra;
    while (p.length > ancho) {
      if (actual) { renglones.push(actual); actual = ""; }
      renglones.push(p.slice(0, ancho));
      p = p.slice(ancho);
    }
    if (!actual) actual = p;
    else if (actual.length + 1 + p.length <= ancho) actual += " " + p;
    else { renglones.push(actual); actual = p; }
  }
  if (actual || renglones.length === 0) renglones.push(actual);
  return renglones;
}

const fecha = (v: string | Date, angosto: boolean) =>
  new Date(v).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", ...(angosto ? {} : { year: "numeric" }),
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONA,
  });

const plata = (v: string | number) => `$${fmtMoney(v)}`;

export function renderTicketEscpos(sale: TicketData, width: AnchoTermica): string {
  const doc = new Escpos(COLUMNAS[width]);
  const angosto = width === "58mm";

  doc.alinear("centro").negrita(true).alto(true).texto(sale.commerce_name).alto(false);
  if (sale.refund_of) doc.texto("** REEMBOLSO **");
  doc.negrita(false).texto("Ticket no fiscal").alinear("izq");

  doc.separador();
  doc.fila("Ticket", `#${sale.ticket_number}`);
  doc.fila("Fecha", fecha(sale.created_at, angosto));
  if (sale.offline_code) doc.fila("Provisorio", sale.offline_code);
  if (sale.customer_name) doc.fila("Cliente", sale.customer_name);
  doc.separador();

  for (const item of sale.items) {
    const importe = Number(item.quantity) * Number(item.unit_price);
    doc.negrita(true).texto(item.name).negrita(false);
    doc.fila(`  ${fmtQty(item.quantity)} x ${plata(item.unit_price)}`, plata(importe));
  }

  doc.separador();
  if (Number(sale.discount) > 0) {
    doc.fila("Subtotal", plata(sale.subtotal));
    doc.fila("Descuento", `-${plata(sale.discount)}`);
  }
  doc.negrita(true).alto(true).fila("TOTAL", plata(sale.total)).alto(false).negrita(false);

  const descuentoClub = Number(sale.clubpay_discount ?? 0);
  const aCobrar = Number(sale.total) - descuentoClub;
  if (descuentoClub > 0) {
    doc.fila("Beneficio ClubPay", `-${plata(descuentoClub)}`);
    if (sale.clubpay_member) {
      doc.fila("Socio", sale.clubpay_member + (sale.clubpay_club ? ` · ${sale.clubpay_club}` : ""));
    }
    doc.negrita(true).fila("A pagar", plata(aCobrar)).negrita(false);
  }
  doc.fila("Pago", PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method);
  if (sale.paid_amount != null && Number(sale.paid_amount) >= aCobrar) {
    doc.fila("Paga con", plata(sale.paid_amount));
    doc.negrita(true).fila("Vuelto", plata(Number(sale.paid_amount) - aCobrar)).negrita(false);
  }
  doc.separador("=");
  doc.alinear("centro").texto("¡Gracias por su compra!").alinear("izq");
  return doc.cortar().base64();
}

export function renderCierreEscpos(data: CierreData, width: AnchoTermica): string {
  const doc = new Escpos(COLUMNAS[width]);
  const angosto = width === "58mm";
  const r = data.resumen;
  const esCierre = data.closedAt !== null;

  doc.alinear("centro").negrita(true).alto(true).texto(data.commerceName).alto(false);
  doc.texto(esCierre ? "CIERRE DE CAJA" : "RESUMEN PARCIAL").negrita(false);
  doc.texto(`Turno #${data.sessionId}`).alinear("izq");

  doc.separador();
  doc.fila("Apertura", fecha(data.openedAt, angosto));
  doc.fila(esCierre ? "Cierre" : "Impreso", fecha(esCierre ? data.closedAt! : new Date(), angosto));
  doc.separador();
  doc.fila("Fondo inicial", plata(r.apertura));

  doc.separador();
  doc.negrita(true).texto("VENTAS POR MEDIO DE PAGO").negrita(false);
  // Mismo orden y mismo filtro que el HTML: sólo los medios con movimiento
  const ORDEN_MEDIOS = ["cash", "wallet", "card", "transfer", "account", "clubpay", "mercadopago"];
  let hubo = false;
  for (const medio of ORDEN_MEDIOS) {
    const v = r.ventasPorMedio[medio];
    if (!v || (v.total === 0 && v.tickets === 0)) continue;
    hubo = true;
    doc.fila(`${PAYMENT_LABEL[medio] ?? medio} (${v.tickets})`, plata(v.total));
  }
  if (!hubo) doc.fila("Sin ventas", plata(0));
  doc.separador();
  doc.negrita(true).fila("Total vendido", plata(r.totalVendido)).negrita(false);
  if (r.cuponesEntregados) doc.fila("Descuentos ClubPay", `-${plata(r.cuponesEntregados)}`);
  doc.fila("Tickets", String(r.totalTickets));

  if (r.totalCobrosCuentaCorriente || r.ingresos || r.egresos) {
    doc.separador();
    doc.negrita(true).texto("OTROS MOVIMIENTOS").negrita(false);
    if (r.totalCobrosCuentaCorriente) {
      doc.fila("Cobros cta. corriente", plata(r.totalCobrosCuentaCorriente));
      for (const medio of ORDEN_MEDIOS) {
        const total = r.cobrosCuentaCorriente?.[medio] ?? 0;
        if (total !== 0) doc.fila(`  en ${PAYMENT_LABEL[medio] ?? medio}`, plata(total));
      }
    }
    if (r.ingresos) doc.fila("Ingresos", plata(r.ingresos));
    if (r.egresos) doc.fila("Retiros y pagos", `-${plata(r.egresos)}`);
  }

  doc.separador("=");
  doc.negrita(true).texto("ARQUEO DEL CAJÓN");
  doc.fila("Efectivo esperado", plata(r.efectivoEsperado)).negrita(false);
  if (r.contado !== undefined) doc.fila("Efectivo contado", plata(r.contado));
  if (r.diferencia !== undefined) {
    doc.negrita(true).alto(true)
      .fila("DIFERENCIA", `${r.diferencia > 0 ? "+" : ""}${plata(r.diferencia)}`)
      .alto(false).negrita(false);
    doc.alinear("centro").texto(
      r.diferencia === 0 ? "La caja cierra exacta" : r.diferencia > 0 ? "Sobra dinero en el cajón" : "Falta dinero en el cajón"
    ).alinear("izq");
  }
  if (data.note) { doc.separador(); doc.texto(`Nota: ${data.note}`); }

  if (esCierre) {
    doc.texto("").texto("").separador().alinear("centro").texto("Firma del responsable");
  } else {
    doc.separador("=").alinear("centro").texto("Resumen informativo · la caja sigue abierta");
  }
  return doc.alinear("izq").cortar().base64();
}

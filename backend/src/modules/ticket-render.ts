/**
 * Render del ticket de venta en HTML, pensado para impresión directa en
 * ticketera térmica (80mm o 58mm) o en impresora común (A4).
 *
 * Se sirve como HTML —y no como PDF— porque el navegador puede mandarlo a
 * la impresora sin pasos intermedios: el POS lo carga en un iframe oculto
 * y dispara print(). El PDF sigue disponible para guardar o reimprimir.
 */

export interface TicketData {
  commerce_name: string;
  ticket_number: number;
  created_at: string | Date;
  customer_name: string | null;
  payment_method: string;
  subtotal: string | number;
  discount: string | number;
  total: string | number;
  paid_amount?: string | number | null;
  refund_of: number | null;
  clubpay_member?: string | null;
  clubpay_club?: string | null;
  clubpay_discount?: string | number | null;
  items: { name: string; ean: string | null; quantity: string | number; unit_price: string | number }[];
}

export const PAYMENT_LABEL: Record<string, string> = {
  cash: "Efectivo",
  wallet: "Billetera",
  card: "Tarjeta",
  transfer: "Transferencia",
  account: "Cuenta corriente",
  clubpay: "ClubPay (app)",
};

/** 1.000 → "1" ; 1.750 → "1,75" (la cantidad es NUMERIC(12,3) en la base) */
export function fmtQty(q: string | number): string {
  const n = Number(q);
  return n.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

export function fmtMoney(v: string | number): string {
  return Number(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const escape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export type AnchoImpresion = "80mm" | "58mm" | "auto";

/**
 * Estilos comunes de los documentos que salen por la impresora del POS
 * (ticket de venta, cierre de caja). El ancho define si se imprime en
 * ticketera térmica o en una hoja común.
 */
export function estilosImpresion(width: AnchoImpresion): string {
  const esTermica = width !== "auto";
  const contentWidth = width === "80mm" ? "72mm" : width === "58mm" ? "50mm" : "100%";
  return `
  @page { size: ${esTermica ? `${width} auto` : "auto"}; margin: ${esTermica ? "0" : "10mm"}; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: ${esTermica ? "4mm 2mm" : "0"};
    width: ${contentWidth};
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: ${esTermica ? "12px" : "13px"};
    line-height: 1.35;
    color: #000;
    background: #fff;
  }
  .centro { text-align: center; }
  .comercio { font-size: ${esTermica ? "15px" : "18px"}; font-weight: 700; }
  .tipo { font-size: 11px; margin-bottom: 6px; }
  .sep { border-top: 1px solid #000; margin: 6px 0; }
  .sep-doble { border-top: 3px double #000; margin: 6px 0; }
  .linea { display: flex; justify-content: space-between; gap: 8px; }
  .linea .val { white-space: nowrap; }
  .titulo-bloque { font-weight: 700; margin-top: 4px; }
  .total { display: flex; justify-content: space-between; font-size: ${esTermica ? "17px" : "20px"}; font-weight: 700; margin: 4px 0; }
  .destacado { font-weight: 700; }
  .pie { margin-top: 10px; font-size: 11px; }`;
}

/**
 * @param width  "80mm" | "58mm" para ticketera térmica, "auto" para
 *               impresora común (hoja completa).
 * @param autoPrint  dispara la impresión al cargar (uso desde el POS).
 */
export function renderTicketHtml(
  sale: TicketData,
  opts: { width?: AnchoImpresion; autoPrint?: boolean } = {}
): string {
  const width = opts.width ?? "80mm";
  const esTermica = width !== "auto";

  const fecha = new Date(sale.created_at).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const filas = sale.items
    .map((item) => {
      const cantidad = fmtQty(item.quantity);
      const importe = Number(item.quantity) * Number(item.unit_price);
      return `
        <div class="item">
          <div class="item-nombre">${escape(item.name)}</div>
          <div class="item-detalle">
            <span>${cantidad} x $${fmtMoney(item.unit_price)}</span>
            <span class="importe">$${fmtMoney(importe)}</span>
          </div>
        </div>`;
    })
    .join("");

  const descuentoClub = Number(sale.clubpay_discount ?? 0);

  // El vuelto se muestra solo si el cajero anotó con cuánto le pagaron
  const aCobrar = Number(sale.total) - descuentoClub;
  const vuelto =
    sale.paid_amount != null && Number(sale.paid_amount) >= aCobrar
      ? Number(sale.paid_amount) - aCobrar
      : null;

  const descuento = Number(sale.discount) > 0
    ? `<div class="linea"><span>Subtotal</span><span>$${fmtMoney(sale.subtotal)}</span></div>
       <div class="linea"><span>Descuento</span><span>-$${fmtMoney(sale.discount)}</span></div>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Ticket ${sale.ticket_number}</title>
<style>
  ${estilosImpresion(width)}
  .item { margin-bottom: 4px; }
  .item-nombre { font-weight: 600; word-break: break-word; }
  .item-detalle { display: flex; justify-content: space-between; gap: 8px; padding-left: 8px; }
  .importe { white-space: nowrap; }
  .reembolso { font-weight: 700; letter-spacing: 1px; }
</style>
</head>
<body>
  <div class="centro comercio">${escape(sale.commerce_name)}</div>
  <div class="centro tipo">
    ${sale.refund_of ? '<span class="reembolso">** REEMBOLSO **</span><br>' : ""}
    Ticket no fiscal
  </div>

  <div class="sep"></div>
  <div class="linea"><span>Ticket</span><span>#${sale.ticket_number}</span></div>
  <div class="linea"><span>Fecha</span><span>${fecha}</span></div>
  ${sale.customer_name ? `<div class="linea"><span>Cliente</span><span>${escape(sale.customer_name)}</span></div>` : ""}
  <div class="sep"></div>

  ${filas}

  <div class="sep"></div>
  ${descuento}
  <div class="total"><span>TOTAL</span><span>$${fmtMoney(sale.total)}</span></div>
  ${descuentoClub > 0 ? `
    <div class="linea"><span>Beneficio ClubPay</span><span>-$${fmtMoney(descuentoClub)}</span></div>
    ${sale.clubpay_member ? `<div class="linea" style="font-size:10px"><span>Socio</span><span>${escape(sale.clubpay_member)}${sale.clubpay_club ? ` · ${escape(sale.clubpay_club)}` : ""}</span></div>` : ""}
    <div class="linea destacado"><span>A pagar</span><span>$${fmtMoney(Number(sale.total) - descuentoClub)}</span></div>` : ""}
  <div class="linea"><span>Pago</span><span>${PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method}</span></div>
  ${vuelto !== null ? `
    <div class="linea"><span>Paga con</span><span>$${fmtMoney(sale.paid_amount!)}</span></div>
    <div class="linea destacado"><span>Vuelto</span><span>$${fmtMoney(vuelto)}</span></div>` : ""}
  <div class="sep-doble"></div>

  <div class="centro pie">¡Gracias por su compra!</div>
</body>
${opts.autoPrint ? "<script>window.onload = function () { window.print(); };<\/script>" : ""}
</html>`;
}

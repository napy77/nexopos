import {
  estilosImpresion, escape, fmtMoney, PAYMENT_LABEL,
  type AnchoImpresion,
} from "./ticket-render.js";

/**
 * Resumen de caja para imprimir en la ticketera (o en hoja común), con el
 * mismo formato que el ticket de venta.
 *
 * Sirve para dos momentos: el cierre del turno (Z, con el efectivo contado y
 * la diferencia) y un corte parcial con la caja todavía abierta (X), que el
 * dueño usa para ver cómo viene el día sin cortar la venta.
 */

export interface ResumenCaja {
  apertura: number;
  ventasPorMedio: Record<string, { tickets: number; total: number }>;
  cobrosCuentaCorriente: Record<string, number>;
  totalCobrosCuentaCorriente: number;
  ingresos: number;
  egresos: number;
  totalVendido: number;
  totalTickets: number;
  efectivoEsperado: number;
  contado?: number;
  diferencia?: number;
}

export interface CierreData {
  commerceName: string;
  sessionId: number;
  openedAt: string | Date;
  closedAt: string | Date | null;
  resumen: ResumenCaja;
  note?: string | null;
}

/** En 58mm no entra la fecha completa: se acorta a día/mes y hora. */
const fecha = (v: string | Date, angosto: boolean) =>
  new Date(v).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit",
    ...(angosto ? {} : { year: "numeric" }),
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });

const fila = (etiqueta: string, valor: string, clase = "") =>
  `<div class="linea ${clase}"><span>${etiqueta}</span><span class="val">${valor}</span></div>`;

export function renderCierreHtml(
  data: CierreData,
  opts: { width?: AnchoImpresion; autoPrint?: boolean } = {}
): string {
  const width = opts.width ?? "80mm";
  const angosto = width === "58mm";
  const { resumen: r } = data;
  const esCierre = data.closedAt !== null;

  // Orden fijo: el resumen guardado es JSONB y Postgres no conserva el orden
  // en que se escribieron las claves. Solo se listan los medios con
  // movimiento, para no llenar el ticket de ceros.
  const ORDEN_MEDIOS = ["cash", "wallet", "card", "transfer", "account"];
  const ventas = ORDEN_MEDIOS
    .map((medio) => [medio, r.ventasPorMedio[medio]] as const)
    .filter(([, v]) => v && (v.total !== 0 || v.tickets !== 0))
    .map(([medio, v]) =>
      fila(
        `${PAYMENT_LABEL[medio] ?? medio} <span style="font-size:10px">(${v.tickets})</span>`,
        `$${fmtMoney(v.total)}`
      )
    )
    .join("");

  const cobros = ORDEN_MEDIOS
    .map((medio) => [medio, r.cobrosCuentaCorriente?.[medio] ?? 0] as const)
    .filter(([, total]) => total !== 0)
    .map(([medio, total]) =>
      fila(`&nbsp;&nbsp;en ${PAYMENT_LABEL[medio] ?? medio}`, `$${fmtMoney(total)}`)
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esCierre ? "Cierre" : "Resumen"} de caja ${data.sessionId}</title>
<style>
  ${estilosImpresion(width)}
  ${angosto ? `
    body { font-size: 11px; }
    .total { font-size: 14px; }
    .linea { gap: 4px; }
  ` : ""}
  .firma { margin-top: 14px; border-top: 1px solid #000; padding-top: 3px; font-size: 10px; }
</style>
</head>
<body>
  <div class="centro comercio">${escape(data.commerceName)}</div>
  <div class="centro tipo">
    <strong>${esCierre ? "CIERRE DE CAJA" : "RESUMEN PARCIAL"}</strong><br>
    Turno #${data.sessionId}
  </div>

  <div class="sep"></div>
  ${fila("Apertura", fecha(data.openedAt, angosto))}
  ${esCierre ? fila("Cierre", fecha(data.closedAt!, angosto)) : fila("Impreso", fecha(new Date(), angosto))}
  <div class="sep"></div>

  ${fila("Fondo inicial", `$${fmtMoney(r.apertura)}`)}

  <div class="sep"></div>
  <div class="titulo-bloque">VENTAS POR MEDIO DE PAGO</div>
  ${ventas || '<div class="linea"><span>Sin ventas</span><span class="val">$0,00</span></div>'}
  <div class="sep"></div>
  ${fila("Total vendido", `$${fmtMoney(r.totalVendido)}`, "destacado")}
  ${fila("Tickets", String(r.totalTickets))}

  ${r.totalCobrosCuentaCorriente || r.ingresos || r.egresos ? `
  <div class="sep"></div>
  <div class="titulo-bloque">OTROS MOVIMIENTOS</div>
  ${r.totalCobrosCuentaCorriente ? fila("Cobros cta. corriente", `$${fmtMoney(r.totalCobrosCuentaCorriente)}`) + cobros : ""}
  ${r.ingresos ? fila("Ingresos", `$${fmtMoney(r.ingresos)}`) : ""}
  ${r.egresos ? fila("Retiros y pagos", `-$${fmtMoney(r.egresos)}`) : ""}
  ` : ""}

  <div class="sep-doble"></div>
  <div class="titulo-bloque">ARQUEO DEL CAJÓN</div>
  ${fila("Efectivo esperado", `$${fmtMoney(r.efectivoEsperado)}`, "destacado")}
  ${r.contado !== undefined ? fila("Efectivo contado", `$${fmtMoney(r.contado)}`) : ""}
  ${r.diferencia !== undefined ? `
    <div class="total">
      <span>DIFERENCIA</span>
      <span class="val">${r.diferencia > 0 ? "+" : ""}$${fmtMoney(r.diferencia)}</span>
    </div>
    <div class="centro" style="font-size:11px">
      ${r.diferencia === 0 ? "La caja cierra exacta" : r.diferencia > 0 ? "Sobra dinero en el cajón" : "Falta dinero en el cajón"}
    </div>` : ""}

  ${data.note ? `<div class="sep"></div><div style="font-size:11px">Nota: ${escape(data.note)}</div>` : ""}

  ${esCierre
    ? '<div class="centro firma">Firma del responsable</div>'
    : '<div class="sep-doble"></div><div class="centro pie">Resumen informativo · la caja sigue abierta</div>'}
</body>
${opts.autoPrint ? "<script>window.onload = function () { window.print(); };<\/script>" : ""}
</html>`;
}

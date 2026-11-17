import { api } from "../api";
import { useSesion } from "../sesion";
import { Documento } from "./bytes";
import { columnas, useImpresora } from "./config";
import { enviar } from "./transporte";

export { useImpresora } from "./config";

const config = () => useImpresora.getState().config;

/** El ticket de una venta, armado por el backend (ticket-escpos.ts). */
export async function imprimirTicket(saleId: number): Promise<void> {
  const c = config();
  const { base64 } = await api<{ base64: string }>(`/api/sales/${saleId}/ticket.escpos?width=${c.ancho}`);
  await enviar(c, base64);
}

/** Cierre del turno, o corte parcial si la caja sigue abierta. */
export async function imprimirCierre(sessionId: number): Promise<void> {
  const c = config();
  const { base64 } = await api<{ base64: string }>(`/api/caja/${sessionId}/resumen.escpos?width=${c.ancho}`);
  await enviar(c, base64);
}

const PAPEL_QR = {
  clubpay: { titulo: "Descuento para socios ClubPay", instruccion: "Escaneá este código con la app ClubPay" },
  mercadopago: {
    titulo: "Pagá con Mercado Pago",
    instruccion: "Escaneá este código con Mercado Pago o cualquier billetera que lea QR",
  },
} as const;

/**
 * El QR de un cobro en papel, para cuando la pantalla no da hacia el cliente.
 * Dice hasta qué hora sirve: un QR impreso parece que vale para siempre, y
 * éste vence a los pocos minutos. Mismo texto que `frontend/lib/print.ts`.
 */
export async function imprimirQr(datos: {
  medio: keyof typeof PAPEL_QR; contenido: string; total: string; venceA: string | null;
}): Promise<void> {
  const c = config();
  const papel = PAPEL_QR[datos.medio];
  const hora = datos.venceA ? new Date(datos.venceA).toLocaleTimeString("es-AR", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Cordoba",
  }) : null;
  const doc = new Documento().centro()
    .negrita(true).linea(useSesion.getState().comercio?.name ?? "").negrita(false)
    .linea(papel.titulo).separador(columnas(c))
    .linea(papel.instruccion)
    .qr(datos.contenido, c.ancho === "58mm" ? 5 : 7)
    .linea("Total de la compra")
    .negrita(true).grande(true).linea(datos.total).grande(false).negrita(false)
    .separador(columnas(c));
  if (hora) doc.negrita(true).linea(`Vale hasta las ${hora}`).negrita(false);
  await enviar(c, doc.linea("Si se vence, pedí otro en la caja.").cortar());
}

export async function imprimirPrueba(): Promise<void> {
  const c = config();
  await enviar(c, new Documento().centro()
    .negrita(true).grande(true).linea("NexoPOS").grande(false).negrita(false)
    .linea("Prueba de impresión")
    .separador(columnas(c))
    .izquierda()
    .linea(`Papel: ${c.ancho} · ${columnas(c)} columnas`)
    .linea("Acentos: á é í ó ú ñ Ñ ¡ ¿")
    .linea("1234567890".repeat(columnas(c) / 10 + 1).slice(0, columnas(c)))
    .cortar());
}

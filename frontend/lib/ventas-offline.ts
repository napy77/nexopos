"use client";

import { useSyncExternalStore } from "react";
import { marcarConConexion, marcarSinConexion } from "./conexion";

/**
 * La cola de ventas cobradas sin conexión.
 *
 * Cada venta es plata que ya está en el cajón. De ahí salen las tres reglas
 * de este archivo:
 *
 *  1. Una venta sale de la cola sólo cuando el servidor contestó que la tiene.
 *  2. Si el servidor la rechaza, no se borra: queda a la vista con el motivo.
 *  3. La cola no es parte de la sesión. Sobrevive a cerrar sesión y al token
 *     vencido, y se manda en el próximo ingreso del mismo comercio.
 *
 * El `id` de cada venta lo inventa la caja y viaja en cada intento: es lo que
 * le permite al backend reconocer un reenvío (ver POST /api/sales).
 */

export interface VentaOffline {
  id: string;
  commerceId: number | null;
  /** Comprobante provisorio que se llevó el cliente: P-0007 */
  code: string;
  soldAt: string;
  items: { productId: number; name: string; quantity: number; unitPrice: number }[];
  total: number;
  paidAmount: number | null;
  /** Si el cajero había elegido un cliente. En efectivo es sólo un dato. */
  customerId: number | null;
  /** Sólo si el servidor la rechazó: por qué. Espera que alguien la mire. */
  motivo?: string;
}

const KEY = "nexopos_ventas_sin_enviar";
const KEY_NUMERO = "nexopos_provisorio_numero";

const oyentes = new Set<() => void>();
let cache: VentaOffline[] | null = null;
let enviando = false;

function comercioActual(): number | null {
  try {
    return JSON.parse(localStorage.getItem("nexopos_commerce") ?? "{}").id ?? null;
  } catch {
    return null;
  }
}

function leer(): VentaOffline[] {
  if (cache) return cache;
  try {
    const dato = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(dato) ? dato : [];
  } catch {
    cache = [];
  }
  return cache!;
}

/** Tira si no pudo escribir: el que llama no puede dar la venta por guardada. */
function escribir(cola: VentaOffline[]): void {
  localStorage.setItem(KEY, JSON.stringify(cola));
  cache = cola;
  oyentes.forEach((f) => f());
}

/**
 * Guarda una venta cobrada sin conexión. Si no se pudo escribir en disco
 * lanza el error: cobrar sin dejar registro es peor que no cobrar.
 */
export function encolarVenta(
  venta: Pick<VentaOffline, "items" | "total" | "paidAmount" | "customerId">
): VentaOffline {
  // El número es de esta caja y no vuelve a empezar: dos comprobantes con el
  // mismo código en el mismo mostrador no se pueden distinguir después.
  const numero = Number(localStorage.getItem(KEY_NUMERO) ?? "0") + 1;
  const nueva: VentaOffline = {
    ...venta,
    id: crypto.randomUUID(),
    commerceId: comercioActual(),
    code: `P-${String(numero).padStart(4, "0")}`,
    soldAt: new Date().toISOString(),
  };
  escribir([...leer(), nueva]);
  localStorage.setItem(KEY_NUMERO, String(numero));
  return nueva;
}

/** Saca de la lista una venta rechazada que el comercio ya resolvió a mano. */
export function descartarRechazada(id: string): void {
  escribir(leer().filter((v) => !(v.id === id && v.motivo)));
}

/**
 * Manda la cola al servidor, de a una y en orden. Se puede llamar las veces
 * que haga falta: si ya hay un envío en curso, no hace nada.
 */
export async function enviarCola(): Promise<void> {
  if (enviando) return;
  enviando = true;
  try {
    const comercio = comercioActual();
    const token = localStorage.getItem("nexopos_token");
    if (!token || comercio === null) return;

    for (const venta of leer().filter((v) => v.commerceId === comercio && !v.motivo)) {
      let res: Response;
      try {
        res = await fetch("/api/sales", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            items: venta.items.map((i) => ({
              productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice,
            })),
            paymentMethod: "cash",
            discount: 0,
            paidAmount: venta.paidAmount ?? undefined,
            customerId: venta.customerId ?? undefined,
            offline: { id: venta.id, soldAt: venta.soldAt, code: venta.code },
          }),
        });
      } catch {
        marcarSinConexion();
        return;
      }
      if (res.status >= 502 && res.status <= 504) {
        marcarSinConexion();
        return;
      }
      marcarConConexion();

      if (res.ok) {
        escribir(leer().filter((v) => v.id !== venta.id));
        continue;
      }
      // Sesión vencida, caja cerrada o un error del servidor: la venta no
      // tiene nada de malo, hay que esperar. Se corta acá para no desordenar.
      const cuerpo = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status >= 500 || cuerpo.code === "caja_cerrada") return;

      // El servidor la miró y dijo que no (un producto que ya no existe).
      // Reintentar da lo mismo: queda marcada para que alguien la resuelva.
      escribir(leer().map((v) =>
        v.id === venta.id ? { ...v, motivo: cuerpo.error ?? "El servidor no la aceptó" } : v
      ));
    }
  } finally {
    enviando = false;
  }
}

function suscribir(f: () => void): () => void {
  // Otra pestaña de la misma caja también escribe la cola
  const otraPestana = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      f();
    }
  };
  oyentes.add(f);
  window.addEventListener("storage", otraPestana);
  return () => {
    oyentes.delete(f);
    window.removeEventListener("storage", otraPestana);
  };
}

const VACIA: VentaOffline[] = [];

/** Las ventas sin enviar de este comercio, incluidas las rechazadas. */
export function useVentasOffline(): VentaOffline[] {
  const todas = useSyncExternalStore(suscribir, leer, () => VACIA);
  const comercio = typeof window === "undefined" ? null : comercioActual();
  return todas.filter((v) => v.commerceId === comercio);
}

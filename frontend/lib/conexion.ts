"use client";

import { useSyncExternalStore } from "react";

/**
 * ¿Se llega al servidor de NexoPOS?
 *
 * No alcanza con `navigator.onLine`: dice que hay red aunque el router esté
 * sin salida a internet, que es el corte típico de un comercio. Lo que vale
 * es si el servidor contesta. Por eso el estado sale de las llamadas reales:
 * `api()` avisa cuando una no llega, y desde ahí se pregunta cada pocos
 * segundos hasta que vuelva.
 *
 * No importa `lib/api.ts` a propósito: `api.ts` importa este archivo.
 */

const CADA_MS = 5_000;

let hayConexion = true;
let sonda: ReturnType<typeof setInterval> | null = null;
const oyentes = new Set<() => void>();

function cambiar(valor: boolean): void {
  if (hayConexion === valor) return;
  hayConexion = valor;
  oyentes.forEach((f) => f());
}

/**
 * Una llamada barata a la API. Cualquier respuesta del backend —incluso un
 * 401— prueba que se llega; un 502/503/504 es nginx diciendo que no.
 */
async function sondear(): Promise<void> {
  try {
    const token = localStorage.getItem("nexopos_token");
    const res = await fetch("/api/caja", {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status < 502 || res.status > 504) volvio();
  } catch {
    /* sigue sin llegar */
  }
}

function volvio(): void {
  if (sonda) clearInterval(sonda);
  sonda = null;
  cambiar(true);
}

/** Lo llama `api()` cuando una llamada no llegó al servidor. */
export function marcarSinConexion(): void {
  cambiar(false);
  if (!sonda) sonda = setInterval(sondear, CADA_MS);
}

/** Lo llama `api()` con cada respuesta: si el servidor contestó, hay conexión. */
export function marcarConConexion(): void {
  if (!hayConexion) volvio();
}

function suscribir(f: () => void): () => void {
  if (oyentes.size === 0) {
    window.addEventListener("offline", marcarSinConexion);
    // "online" sólo dice que volvió la red local: se confirma preguntando.
    window.addEventListener("online", sondear);
  }
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
    if (oyentes.size === 0) {
      window.removeEventListener("offline", marcarSinConexion);
      window.removeEventListener("online", sondear);
    }
  };
}

/** `true` mientras el servidor contesta. En el render del servidor, siempre. */
export function useConexion(): boolean {
  return useSyncExternalStore(suscribir, () => hayConexion, () => true);
}

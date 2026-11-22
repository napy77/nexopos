import { useSesion } from "./sesion";

/**
 * Dónde está el backend. En producción, nexopos.app; para probar contra el
 * backend local se pisa con EXPO_PUBLIC_API_URL en `.env.local`.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://nexopos.app").replace(/\/$/, "");

/** Error con el `code` que manda el backend, para decidir sin comparar textos. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/**
 * Cliente HTTP: el mismo contrato que `frontend/lib/api.ts`. La app es
 * siempre online, así que un fallo de red es un error que se le muestra al
 * cajero, no algo que se encola.
 */
export async function api<T = unknown>(path: string, init?: {
  method?: string; body?: unknown;
  /** Sin el JWT: para verificar una contraseña sin que un 401 cierre la sesión abierta. */
  anonimo?: boolean;
}): Promise<T> {
  const token = init?.anonimo ? null : useSesion.getState().token;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("Sin conexión con NexoPOS. Revisá internet y probá de nuevo.", 0);
  }
  // 502/503/504 los contesta nginx cuando no llega al backend
  if (res.status >= 502 && res.status <= 504) {
    throw new ApiError("NexoPOS no está respondiendo. Probá de nuevo en unos segundos.", res.status);
  }
  if (res.status === 401 && token) {
    // El JWT dura 12 h: vencido, se vuelve al login (el layout lo detecta)
    await useSesion.getState().salir();
    throw new ApiError("La sesión venció. Volvé a ingresar.", 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string; code?: string }));
    throw new ApiError(body.error ?? "Error de servidor", res.status, body.code);
  }
  return res.json() as Promise<T>;
}

export const mensaje = (err: unknown, porDefecto = "Algo salió mal"): string =>
  err instanceof Error ? err.message : porDefecto;

export function money(n: number | string): string {
  return `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Referencia corta para los cobros con QR: identifica el intento, no es secreta. */
export const referencia = (): string => Math.random().toString(36).slice(2, 10);

/** "1.234,5" o "1234.5" → 1234.5; vacío o inválido → null */
export function leerNumero(t: string): number | null {
  const limpio = t.trim().replace(/\./g, (m, i, s) => (s.includes(",") ? "" : m)).replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

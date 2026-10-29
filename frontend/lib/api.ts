"use client";

/** Cliente HTTP mínimo: agrega el JWT y redirige al login si expira. */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("nexopos_token") : null;
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    borrarSesion();
    window.location.href = "/login";
    throw new Error("Sesión expirada");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Error de servidor");
  }
  return res.json() as Promise<T>;
}

/**
 * Sesión del equipo Nexo dentro de la caja de un comercio (`/entrar`).
 * Se guarda aparte del token para que la franja la lea sin decodificar el JWT.
 */
export interface Soporte { adminEmail: string | null; desde: string; vence: string }

export function getSoporte(): Soporte | null {
  try {
    const raw = localStorage.getItem("nexopos_soporte");
    return raw ? (JSON.parse(raw) as Soporte) : null;
  } catch {
    return null;
  }
}

/** Todo lo que es de la sesión. Un login nuevo empieza de cero, sin restos. */
export function borrarSesion(): void {
  localStorage.removeItem("nexopos_token");
  localStorage.removeItem("nexopos_commerce");
  localStorage.removeItem("nexopos_soporte");
}

export function getToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("nexopos_token") : null;
}

export function money(n: number | string): string {
  return `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

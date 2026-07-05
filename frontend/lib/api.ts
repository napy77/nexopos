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
    localStorage.removeItem("nexopos_token");
    window.location.href = "/login";
    throw new Error("Sesión expirada");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Error de servidor");
  }
  return res.json() as Promise<T>;
}

export function getToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("nexopos_token") : null;
}

export function money(n: number | string): string {
  return `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

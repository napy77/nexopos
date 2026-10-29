"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { borrarSesion } from "@/lib/api";

/**
 * El código se lee una sola vez por carga de página. En desarrollo React monta
 * dos veces el efecto: la segunda ya no encontraría el código en la URL (lo
 * sacamos en la primera) y mandaría al login a alguien que entró bien.
 */
let canje: Promise<Response> | null = null;

/**
 * GET /entrar?token=… — entrada sin contraseña desde NexoB2B.
 *
 * Hoy la usa el equipo Nexo (modo soporte); más adelante, el «Abrir NexoPOS»
 * del propio comercio. El código es de un solo uso y vence a los 2 minutos.
 * Contrato: docs/PEDIDO-A-NEXOPOS-ENTRAR.md.
 */
export default function EntrarPage() {
  const router = useRouter();
  const [suspendido, setSuspendido] = useState(false);

  useEffect(() => {
    if (!canje) {
      const token = new URLSearchParams(window.location.search).get("token") ?? "";
      // Lo primero: sacar el código de la URL, antes de cualquier otra cosa.
      // Si queda, una recarga lo vuelve a canjear (410) y queda en el historial.
      window.history.replaceState(null, "", "/entrar");
      canje = fetch("/api/auth/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    }

    let vivo = true;
    canje
      .then(async (res) => {
        const data = await res.clone().json().catch(() => ({}));
        if (!vivo) return;
        if (res.ok) {
          // Si había otra sesión abierta en este navegador, la reemplaza.
          borrarSesion();
          localStorage.setItem("nexopos_token", data.token);
          localStorage.setItem("nexopos_commerce", JSON.stringify(data.commerce));
          if (data.soporte) localStorage.setItem("nexopos_soporte", JSON.stringify(data.soporte));
          router.replace("/dashboard");
        } else if (data.code === "comercio_suspendido") {
          setSuspendido(true);
        } else {
          router.replace("/login");
        }
      })
      .catch(() => vivo && router.replace("/login"));
    return () => {
      vivo = false;
    };
  }, [router]);

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="card" style={{ textAlign: "center" }}>
          <h1>
            Nexo<span style={{ color: "var(--primary)" }}>POS</span>
          </h1>
          {suspendido ? (
            <>
              <p className="error">El comercio está suspendido.</p>
              <p className="muted">No se puede entrar a su caja mientras siga así.</p>
            </>
          ) : (
            <p className="muted">Entrando…</p>
          )}
        </div>
        {suspendido && (
          <p className="login-volver">
            <Link href="/">← Volver a nexopos.app</Link>
          </p>
        )}
      </div>
    </div>
  );
}

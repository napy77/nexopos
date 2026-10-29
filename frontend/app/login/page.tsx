"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NEXOB2B_REGISTRO_URL } from "@/lib/sitio";
import { borrarSesion } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error de login");
      borrarSesion();
      localStorage.setItem("nexopos_token", data.token);
      localStorage.setItem("nexopos_commerce", JSON.stringify(data.commerce));
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="card">
          <h1 style={{ textAlign: "center" }}>
            Nexo<span style={{ color: "var(--primary)" }}>POS</span>
          </h1>
          <p className="muted" style={{ textAlign: "center" }}>
            Ingresá con tus credenciales de NexoB2B
          </p>
          <form onSubmit={submit}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={loading}>
              {loading ? "Ingresando…" : "Ingresar"}
            </button>
          </form>
          <p className="muted login-alta">
            ¿Todavía no tenés cuenta?{" "}
            <a href={NEXOB2B_REGISTRO_URL}>Creala gratis en NexoB2B</a> y activá NexoPOS
            desde tu perfil.
          </p>
        </div>
        <p className="login-volver">
          <Link href="/">← Volver a nexopos.app</Link>
        </p>
      </div>
    </div>
  );
}

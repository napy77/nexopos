"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { B2BMayorista } from "@/lib/b2b-types";

const ESTADO_SOLICITUD: Record<string, { label: string; cls: string }> = {
  aceptado: { label: "Con alta", cls: "ok" },
  pendiente: { label: "Solicitud pendiente", cls: "warn" },
  rechazado: { label: "Rechazada", cls: "err" },
};

export default function MayoristasPage() {
  const [busqueda, setBusqueda] = useState("");
  const [mayoristas, setMayoristas] = useState<B2BMayorista[]>([]);
  const [solicitando, setSolicitando] = useState<B2BMayorista | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    const params = busqueda.trim() ? `?busqueda=${encodeURIComponent(busqueda.trim())}` : "";
    const data = await api<{ mayoristas: B2BMayorista[] }>(`/api/mayoristas${params}`);
    setMayoristas(data.mayoristas);
  }, [busqueda]);

  useEffect(() => {
    const t = setTimeout(() => { load().catch(console.error); }, 300);
    return () => clearTimeout(t);
  }, [load]);

  async function enviarSolicitud() {
    if (!solicitando) return;
    setError("");
    try {
      await api("/api/mayoristas/solicitudes", {
        method: "POST",
        body: JSON.stringify({ mayoristaId: solicitando.id, mensaje }),
      });
      setOk(`Solicitud enviada a ${solicitando.nombre}. Te avisarán cuando la acepten.`);
      setSolicitando(null);
      setMensaje("");
      load();
      setTimeout(() => setOk(""), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar la solicitud");
    }
  }

  return (
    <div>
      <h1>Mayoristas</h1>
      <p className="muted">
        Para poder comprarle a un mayorista necesitás tener el alta aceptada. Solicitala desde acá.
      </p>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, ciudad, provincia…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>
      {ok && <p className="badge ok" style={{ fontSize: 14 }}>{ok}</p>}
      {error && <p className="error">{error}</p>}

      {solicitando && (
        <div className="card" style={{ border: "2px solid var(--primary)" }}>
          <h2>Solicitar alta con {solicitando.nombre}</h2>
          <div className="toolbar">
            <input
              placeholder="Mensaje de presentación (opcional)"
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              style={{ flex: 1 }}
              autoFocus
            />
            <button onClick={enviarSolicitud}>Enviar solicitud</button>
            <button className="secondary" onClick={() => setSolicitando(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="row">
        {mayoristas.map((m) => {
          const estado = m.solicitud ? ESTADO_SOLICITUD[m.solicitud.estado] : null;
          return (
            <div key={m.id} className="card" style={{ minWidth: 300 }}>
              <div className="toolbar" style={{ marginBottom: 8 }}>
                {m.logo_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={m.logo_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8 }} />
                  : <span style={{ fontSize: 28 }}>🏬</span>}
                <div>
                  <strong>{m.nombre}</strong>
                  <div className="muted">
                    {[m.ciudad, m.provincia].filter(Boolean).join(", ")}
                    {m.distancia_km != null && ` · ${m.distancia_km} km`}
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                {m.rubros.map((r) => <span key={r} className="badge info" style={{ marginRight: 4 }}>{r}</span>)}
              </div>
              <div style={{ marginBottom: 8 }}>
                {estado
                  ? <span className={`badge ${estado.cls}`}>{estado.label}</span>
                  : <span className="badge" style={{ background: "#e5e7eb" }}>Sin relación</span>}
              </div>
              {m.solicitud?.estado === "aceptado" && m.contacto && (
                <p className="muted" style={{ margin: "4px 0" }}>
                  {m.contacto.es_vendedor ? "Vendedor: " : "Contacto: "}
                  <strong>{m.contacto.nombre}</strong>
                  {m.contacto.celular && <> · <a href={`https://wa.me/${m.contacto.celular.replace(/\D/g, "")}`} target="_blank">{m.contacto.celular}</a></>}
                </p>
              )}
              {(!m.solicitud || m.solicitud.estado === "rechazado") && (
                <button className="small" onClick={() => setSolicitando(m)}>Solicitar alta</button>
              )}
            </div>
          );
        })}
        {mayoristas.length === 0 && <p className="muted">No se encontraron mayoristas.</p>}
      </div>
    </div>
  );
}

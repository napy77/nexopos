"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money } from "@/lib/api";

/**
 * Los pedidos que entran por la tienda online.
 *
 * El modo de falla que esta pantalla tiene que evitar no es que el comerciante
 * no se entere: es que se entere, no haga nada en cuarenta minutos, y el que
 * pidió no sepa si va o no va. Nadie se enoja porque tarde una hora si se lo
 * dijeron.
 *
 * Por eso los pendientes van arriba, con el reloj a la vista, y aceptar es un
 * gesto con el tiempo ya sugerido.
 */

interface Linea { name: string; quantity: string; unitPrice: string }
interface Pedido {
  id: number; code: string; status: string; total: string;
  slot_label: string; slot_kind: "retiro" | "reparto"; address: string | null;
  payment_method: string; payment_status: string;
  ready_estimate: string | null; notes: string | null;
  contact_name: string | null; contact_phone: string | null;
  customer_name: string | null; created_at: string; cancel_reason: string | null;
  lines: Linea[] | null;
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  recibido: { texto: "Sin aceptar", clase: "warn" },
  aceptado: { texto: "Preparando", clase: "" },
  listo: { texto: "Listo", clase: "ok" },
  en_camino: { texto: "En camino", clase: "ok" },
  entregado: { texto: "Entregado", clase: "ok" },
  cancelado: { texto: "Cancelado", clase: "" },
};

const PAGO: Record<string, string> = {
  efectivo_entrega: "Efectivo al recibir",
  online: "Pagado online",
  cuenta_corriente: "A la libreta",
};

/** Sugerencias de un toque. Escribir a mano también se puede. */
const TIEMPOS = ["15 minutos", "30 minutos", "1 hora", "Hoy a la tarde", "Mañana"];
const MOTIVOS = ["No me queda stock", "No llego con el horario", "Cerramos por hoy"];

const ABIERTOS = ["recibido", "aceptado", "listo", "en_camino"];

function hace(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

export default function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState<number | null>(null);

  const cargar = useCallback(() => {
    api<Pedido[]>("/api/pedidos").then(setPedidos).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    cargar();
    // Cada 20 segundos: un pedido que entra mientras el comerciante mira otra
    // cosa tiene que aparecer solo, no cuando se le ocurra recargar.
    const t = setInterval(cargar, 20_000);
    return () => clearInterval(t);
  }, [cargar]);

  async function accion(id: number, ruta: string, body?: unknown) {
    setError(""); setTrabajando(id);
    try {
      await api(`/api/pedidos/${id}/${ruta}`, {
        method: "POST", body: JSON.stringify(body ?? {}),
      });
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo");
    } finally {
      setTrabajando(null);
    }
  }

  const abiertos = pedidos.filter((p) => ABIERTOS.includes(p.status));
  const cerrados = pedidos.filter((p) => !ABIERTOS.includes(p.status));

  return (
    <div>
      <h1>Pedidos de la tienda</h1>
      {error && <p className="error">{error}</p>}

      {abiertos.length === 0 && (
        <div className="card">
          <p className="muted">
            No hay pedidos esperando. Los que entren por tu tienda aparecen acá.
          </p>
        </div>
      )}

      {abiertos.map((p) => (
        <Tarjeta key={p.id} p={p} trabajando={trabajando === p.id} onAccion={accion} />
      ))}

      {cerrados.length > 0 && (
        <div className="card">
          <h2>Cerrados</h2>
          <table>
            <tbody>
              {cerrados.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{p.code}</td>
                  <td>{p.contact_name ?? p.customer_name}</td>
                  <td>
                    <span className={`badge ${ESTADO[p.status]?.clase}`}>
                      {ESTADO[p.status]?.texto ?? p.status}
                    </span>
                    {p.cancel_reason && (
                      <span className="muted" style={{ fontSize: 11 }}> · {p.cancel_reason}</span>
                    )}
                  </td>
                  <td className="num">{money(p.total)}</td>
                  <td className="muted" style={{ fontSize: 11 }}>{hace(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tarjeta({ p, trabajando, onAccion }: {
  p: Pedido; trabajando: boolean;
  onAccion: (id: number, ruta: string, body?: unknown) => void;
}) {
  const [tiempo, setTiempo] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const urgente = p.status === "recibido";

  return (
    <div className="card" style={urgente ? { borderLeft: "4px solid var(--warn, #d97706)" } : undefined}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>{p.contact_name ?? p.customer_name ?? "Sin nombre"}</strong>
        <span className={`badge ${ESTADO[p.status]?.clase}`}>{ESTADO[p.status]?.texto}</span>
        <span className="muted" style={{ fontSize: 12 }}>{p.code} · {hace(p.created_at)}</span>
        <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 700 }}>{money(p.total)}</span>
      </div>

      <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
        {p.slot_label}{p.address ? ` · ${p.address}` : ""} · {PAGO[p.payment_method] ?? p.payment_method}
        {p.contact_phone ? ` · ${p.contact_phone}` : ""}
      </p>
      {p.notes && <p style={{ fontSize: 13, margin: "2px 0" }}>📝 {p.notes}</p>}

      <table style={{ fontSize: 13, margin: "6px 0" }}>
        <tbody>
          {(p.lines ?? []).map((l, i) => (
            <tr key={i}>
              <td style={{ width: 40 }}>{Number(l.quantity)}×</td>
              <td>{l.name}</td>
              <td className="num">{money(Number(l.quantity) * Number(l.unitPrice))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {p.ready_estimate && (
        <p className="muted" style={{ fontSize: 12 }}>Le dijiste: <strong>{p.ready_estimate}</strong></p>
      )}

      {cancelando ? (
        <div style={{ background: "#fff7ed", padding: 8, borderRadius: 6 }}>
          <p style={{ fontSize: 12, margin: "0 0 6px" }}>
            Lo que escribas lo lee el cliente. Decile cómo seguir, no solo que no va:
          </p>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
            {MOTIVOS.map((m) => (
              <button key={m} type="button" className="ghost" style={{ fontSize: 12 }}
                onClick={() => setMotivo(m)}>{m}</button>
            ))}
          </div>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus
            placeholder="No me quedan de ananá, tengo de muzzarella. Pasá igual y te las hago."
            style={{ width: "100%", marginBottom: 6 }} />
          <button type="button" disabled={!motivo.trim() || trabajando}
            onClick={() => onAccion(p.id, "cancelar", { motivo })}>Cancelar el pedido</button>
          <button type="button" className="ghost" onClick={() => setCancelando(false)}>Volver</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {p.status === "recibido" && (
            <>
              <span style={{ fontSize: 13 }}>¿Para cuándo lo tenés?</span>
              {TIEMPOS.map((t) => (
                <button key={t} type="button" className={tiempo === t ? "" : "ghost"}
                  style={{ fontSize: 12 }} onClick={() => setTiempo(t)}>{t}</button>
              ))}
              <input value={tiempo} onChange={(e) => setTiempo(e.target.value)}
                placeholder="o escribilo" style={{ width: 130 }} />
              <button type="button" disabled={!tiempo.trim() || trabajando}
                onClick={() => onAccion(p.id, "aceptar", { readyEstimate: tiempo })}>
                Aceptar
              </button>
            </>
          )}
          {p.status === "aceptado" && (
            <button type="button" disabled={trabajando} onClick={() => onAccion(p.id, "listo")}>
              Está listo
            </button>
          )}
          {p.status === "listo" && p.slot_kind === "reparto" && (
            <button type="button" disabled={trabajando} onClick={() => onAccion(p.id, "en-camino")}>
              Salió para allá
            </button>
          )}
          {(p.status === "listo" || p.status === "en_camino") && (
            <button type="button" disabled={trabajando} onClick={() => onAccion(p.id, "entregado")}>
              {p.payment_method === "efectivo_entrega" ? "Entregado y cobrado" : "Entregado"}
            </button>
          )}
          <button type="button" className="ghost" style={{ marginLeft: "auto" }}
            onClick={() => setCancelando(true)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

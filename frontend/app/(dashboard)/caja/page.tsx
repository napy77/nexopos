"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { printCierreCaja } from "@/lib/print";

interface Resumen {
  apertura: number;
  ventasPorMedio: Record<string, { tickets: number; total: number }>;
  cobrosCuentaCorriente: Record<string, number>;
  totalCobrosCuentaCorriente: number;
  /** Lo que el comercio entregó en beneficios y no cobró en dinero */
  cuponesEntregados: number;
  ingresos: number;
  egresos: number;
  totalVendido: number;
  totalTickets: number;
  efectivoEsperado: number;
}
interface Movimiento { id: number; type: string; amount: string; note: string; created_at: string }
interface Estado {
  abierta: boolean;
  sesion?: { id: number; opened_at: string; opening_amount: string };
  resumen?: Resumen;
  movimientos?: Movimiento[];
}
interface Cierre extends Resumen { contado: number; diferencia: number; sessionId?: number }
interface SesionCerrada {
  id: number; opened_at: string; closed_at: string;
  opening_amount: string; counted_amount: string; closing_note: string | null;
  closing_summary: Cierre | null;
}

const MEDIOS = [
  { id: "cash", label: "Efectivo", icon: "💵", enCajon: true },
  { id: "wallet", label: "Billetera", icon: "📱", enCajon: false },
  { id: "card", label: "Tarjeta", icon: "💳", enCajon: false },
  { id: "transfer", label: "Transferencia", icon: "🏦", enCajon: false },
  { id: "account", label: "Cuenta corriente", icon: "📒", enCajon: false },
];

export default function CajaPage() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [historial, setHistorial] = useState<SesionCerrada[]>([]);
  const [ultimoCierre, setUltimoCierre] = useState<Cierre | null>(null);
  const [mostrarCierre, setMostrarCierre] = useState(false);
  const [contado, setContado] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const [e, h] = await Promise.all([
      api<Estado>("/api/caja"),
      api<SesionCerrada[]>("/api/caja/historial"),
    ]);
    setEstado(e);
    setHistorial(h);
  }, []);

  useEffect(() => { cargar().catch(console.error); }, [cargar]);

  async function abrir(form: FormData) {
    setError("");
    setBusy(true);
    try {
      await api("/api/caja/abrir", {
        method: "POST",
        body: JSON.stringify({
          openingAmount: Number(form.get("openingAmount") ?? 0),
          note: String(form.get("note") || "") || undefined,
        }),
      });
      setUltimoCierre(null);
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la caja");
    } finally {
      setBusy(false);
    }
  }

  async function registrarMovimiento(form: FormData) {
    setError("");
    try {
      await api("/api/caja/movimiento", {
        method: "POST",
        body: JSON.stringify({
          type: String(form.get("type")),
          amount: Number(form.get("amount")),
          note: String(form.get("note")),
        }),
      });
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el movimiento");
    }
  }

  async function imprimirResumen(sessionId: number) {
    try {
      await printCierreCaja(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo imprimir el resumen");
    }
  }

  async function cerrar() {
    setError("");
    setBusy(true);
    try {
      const r = await api<{ cierre: Cierre; sessionId: number }>("/api/caja/cerrar", {
        method: "POST",
        body: JSON.stringify({ countedAmount: Number(contado || 0) }),
      });
      setUltimoCierre({ ...r.cierre, sessionId: r.sessionId });
      setMostrarCierre(false);
      setContado("");
      cargar();
      // El cierre sale por la impresora apenas se confirma
      imprimirResumen(r.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar la caja");
    } finally {
      setBusy(false);
    }
  }

  const resumen = estado?.resumen;
  const esperado = resumen?.efectivoEsperado ?? 0;
  const diferenciaPrevia = contado !== "" ? Number(contado) - esperado : null;

  return (
    <div>
      <h1>Caja</h1>
      {error && <p className="error">{error}</p>}

      {/* ── Cierre recién hecho ── */}
      {ultimoCierre && (
        <div className="card" style={{ border: "2px solid var(--success)" }}>
          <h2>Caja cerrada</h2>
          <ResumenArqueo r={ultimoCierre} />
          <div className="total-caja" style={{ marginTop: 8 }}>
            <span>Efectivo contado</span><strong>{money(ultimoCierre.contado)}</strong>
          </div>
          <div className="total-caja">
            <span>Diferencia</span>
            <strong className={ultimoCierre.diferencia === 0 ? "" : "dif"}>
              {ultimoCierre.diferencia > 0 ? "+" : ""}{money(ultimoCierre.diferencia)}
              {ultimoCierre.diferencia === 0 && " ✓"}
            </strong>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            {ultimoCierre.sessionId && (
              <button onClick={() => imprimirResumen(ultimoCierre.sessionId!)}>
                🖨 Imprimir cierre
              </button>
            )}
            <button className="secondary" onClick={() => setUltimoCierre(null)}>Entendido</button>
          </div>
        </div>
      )}

      {/* ── Sin caja abierta ── */}
      {estado && !estado.abierta && !ultimoCierre && (
        <div className="card">
          <h2>Abrir caja del día</h2>
          <p className="muted">
            Anotá con cuánto efectivo arrancás. Al cerrar vas a ver cuánto tendría que
            haber en el cajón y el detalle por medio de pago.
          </p>
          <form action={abrir} className="toolbar">
            <input
              name="openingAmount" type="number" step="0.01" min="0"
              placeholder="Fondo inicial" style={{ width: 180, fontSize: 16 }} autoFocus
            />
            <input name="note" placeholder="Nota (opcional)" style={{ flex: 1, minWidth: 180 }} />
            <button type="submit" disabled={busy}>Abrir caja</button>
          </form>
        </div>
      )}

      {/* ── Caja abierta ── */}
      {estado?.abierta && resumen && (
        <>
          <div className="row">
            <div className="card">
              <div className="metric-label">Abierta desde</div>
              <div className="metric" style={{ fontSize: 20 }}>
                {new Date(estado.sesion!.opened_at).toLocaleString("es-AR", {
                  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                })}
              </div>
              <div className="muted">Fondo inicial: {money(resumen.apertura)}</div>
            </div>
            <div className="card">
              <div className="metric-label">Vendido en el turno</div>
              <div className="metric">{money(resumen.totalVendido)}</div>
              <div className="muted">{resumen.totalTickets} tickets</div>
            </div>
            <div className="card" style={{ background: "#f0fdf4" }}>
              <div className="metric-label">Efectivo esperado en el cajón</div>
              <div className="metric">{money(esperado)}</div>
              <div className="muted">Fondo + efectivo cobrado − retiros</div>
            </div>
          </div>

          <div className="row">
            <div className="card" style={{ minWidth: 340 }}>
              <h2>Detalle del turno</h2>
              <ResumenArqueo r={resumen} />
            </div>

            <div className="card" style={{ minWidth: 320 }}>
              <h2>Movimientos de dinero</h2>
              <p className="muted">
                Retiros, pagos a proveedores o ingresos que no son ventas.
              </p>
              <form action={registrarMovimiento} className="toolbar">
                <select name="type" defaultValue="egreso">
                  <option value="egreso">Sale de la caja</option>
                  <option value="ingreso">Entra a la caja</option>
                </select>
                <input name="amount" type="number" step="0.01" min="0.01" required placeholder="Monto" style={{ width: 120 }} />
                <input name="note" required placeholder="Motivo" style={{ flex: 1, minWidth: 140 }} />
                <button type="submit">Registrar</button>
              </form>
              <table>
                <tbody>
                  {(estado.movimientos ?? []).map((m) => (
                    <tr key={m.id}>
                      <td>{new Date(m.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</td>
                      <td>{m.note}</td>
                      <td className="num" style={{ color: m.type === "egreso" ? "var(--danger)" : "var(--success)" }}>
                        {m.type === "egreso" ? "−" : "+"}{money(m.amount)}
                      </td>
                    </tr>
                  ))}
                  {(estado.movimientos ?? []).length === 0 && (
                    <tr><td className="muted">Sin movimientos.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            {!mostrarCierre ? (
              <div className="toolbar">
                <button onClick={() => setMostrarCierre(true)}>Cerrar caja</button>
                <button className="secondary" onClick={() => imprimirResumen(estado.sesion!.id)}>
                  🖨 Imprimir resumen parcial
                </button>
                <span className="muted">Cómo viene el turno, sin cerrarlo</span>
              </div>
            ) : (
              <>
                <h2>Cerrar caja</h2>
                <p className="muted">Contá el efectivo del cajón y anotá cuánto hay:</p>
                <div className="toolbar">
                  <input
                    type="number" step="0.01" min="0" value={contado}
                    onChange={(e) => setContado(e.target.value)}
                    placeholder="Efectivo contado" style={{ width: 200, fontSize: 16 }} autoFocus
                  />
                  <button onClick={cerrar} disabled={busy || contado === ""}>Confirmar cierre</button>
                  <button className="secondary" onClick={() => { setMostrarCierre(false); setContado(""); }}>
                    Cancelar
                  </button>
                </div>
                {diferenciaPrevia !== null && (
                  <p style={{ marginTop: 8 }}>
                    Esperado {money(esperado)} ·{" "}
                    <strong className={diferenciaPrevia === 0 ? "" : "dif"}>
                      {diferenciaPrevia === 0
                        ? "coincide ✓"
                        : `${diferenciaPrevia > 0 ? "sobran" : "faltan"} ${money(Math.abs(diferenciaPrevia))}`}
                    </strong>
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Historial ── */}
      <div className="card">
        <h2>Cierres anteriores</h2>
        <table>
          <thead>
            <tr>
              <th>Apertura</th><th>Cierre</th><th className="num">Fondo</th>
              <th className="num">Vendido</th><th className="num">Contado</th><th className="num">Diferencia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {historial.map((s) => {
              const dif = s.closing_summary?.diferencia ?? 0;
              return (
                <tr key={s.id}>
                  <td>{new Date(s.opened_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{new Date(s.closed_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="num">{money(s.opening_amount)}</td>
                  <td className="num">{money(s.closing_summary?.totalVendido ?? 0)}</td>
                  <td className="num">{money(s.counted_amount)}</td>
                  <td className="num">
                    <span className={`badge ${dif === 0 ? "ok" : "err"}`}>
                      {dif > 0 ? "+" : ""}{money(dif)}
                    </span>
                  </td>
                  <td>
                    <button className="small secondary" onClick={() => imprimirResumen(s.id)}>🖨</button>
                  </td>
                </tr>
              );
            })}
            {historial.length === 0 && (
              <tr><td colSpan={7} className="muted">Todavía no cerraste ninguna caja.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResumenArqueo({ r }: { r: Resumen }) {
  return (
    <table>
      <tbody>
        <tr>
          <td className="muted">Fondo inicial</td>
          <td className="num">{money(r.apertura)}</td>
        </tr>
        {MEDIOS.map((m) => {
          const v = r.ventasPorMedio[m.id] ?? { tickets: 0, total: 0 };
          return (
            <tr key={m.id}>
              <td>
                {m.icon} {m.label}
                <span className="muted" style={{ fontSize: 12 }}> · {v.tickets} tickets</span>
                {!m.enCajon && v.total > 0 && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {m.id === "account" ? " (no entró dinero)" : " (no está en el cajón)"}
                  </span>
                )}
              </td>
              <td className="num">{money(v.total)}</td>
            </tr>
          );
        })}
        {r.totalCobrosCuentaCorriente > 0 && (
          <tr>
            <td>📥 Cobros de cuenta corriente</td>
            <td className="num">{money(r.totalCobrosCuentaCorriente)}</td>
          </tr>
        )}
        {r.ingresos > 0 && (
          <tr><td>➕ Otros ingresos</td><td className="num">{money(r.ingresos)}</td></tr>
        )}
        {r.egresos > 0 && (
          <tr><td>➖ Retiros y pagos</td><td className="num" style={{ color: "var(--danger)" }}>−{money(r.egresos)}</td></tr>
        )}
        <tr>
          <td><strong>Total vendido</strong></td>
          <td className="num"><strong>{money(r.totalVendido)}</strong></td>
        </tr>
        {/* Sin esta línea el turno no cierra a la vista: se vendió por más de
            lo que entró, y la diferencia no falta, se entregó en beneficios. */}
        {r.cuponesEntregados > 0 && (
          <tr>
            <td>
              🎟️ Descuentos ClubPay
              <span className="muted" style={{ fontSize: 11 }}> · no entró dinero, lo cubre ClubPay</span>
            </td>
            <td className="num" style={{ color: "var(--danger)" }}>−{money(r.cuponesEntregados)}</td>
          </tr>
        )}
        <tr style={{ background: "#f0fdf4" }}>
          <td><strong>Efectivo que debería haber</strong></td>
          <td className="num"><strong>{money(r.efectivoEsperado)}</strong></td>
        </tr>
      </tbody>
    </table>
  );
}

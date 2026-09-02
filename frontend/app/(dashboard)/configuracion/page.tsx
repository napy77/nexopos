"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  loadPrintSettings, savePrintSettings, printTicket,
  DEFAULT_PRINT_SETTINGS, type PrintSettings,
} from "@/lib/print";
import { leerCodigoBalanza, BALANZA_DEFAULT, type BalanzaConfig } from "@/lib/balanza";

interface Commerce {
  id: number; nexob2b_id: string | null; name: string; email: string;
  tax_id: string | null; estado: string | null;
  ciudad: string | null; provincia: string | null; created_at: string;
}
interface Sale { id: number; ticket_number: number }

const ANCHOS = [
  { id: "80mm", label: "Ticketera 80mm", detalle: "El formato más común de comandera térmica" },
  { id: "58mm", label: "Ticketera 58mm", detalle: "Térmica angosta, tipo mini impresora" },
  { id: "auto", label: "Impresora común", detalle: "Hoja A4 o Carta, para impresora de oficina" },
] as const;

export default function ConfiguracionPage() {
  const [commerce, setCommerce] = useState<Commerce | null>(null);
  const [mockMode, setMockMode] = useState(false);
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [ultimaVenta, setUltimaVenta] = useState<Sale | null>(null);
  const [balanza, setBalanza] = useState<BalanzaConfig>(BALANZA_DEFAULT);
  const [pruebaCodigo, setPruebaCodigo] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [clubpay, setClubpay] = useState<{ configurado: boolean; mockMode: boolean; clavePreview: string | null } | null>(null);
  const [clubpayKey, setClubpayKey] = useState("");

  useEffect(() => {
    setSettings(loadPrintSettings());
    api<{ balanza: BalanzaConfig }>("/api/settings/balanza")
      .then((d) => setBalanza(d.balanza))
      .catch(console.error);
    api<{ configurado: boolean; mockMode: boolean; clavePreview: string | null }>("/api/clubpay/estado")
      .then(setClubpay)
      .catch(console.error);
    api<{ commerce: Commerce; mockMode: boolean }>("/api/auth/me")
      .then((d) => { setCommerce(d.commerce); setMockMode(d.mockMode); })
      .catch(console.error);
    api<Sale[]>("/api/sales")
      .then((ventas) => setUltimaVenta(ventas[0] ?? null))
      .catch(console.error);
  }, []);

  function update(cambio: Partial<PrintSettings>) {
    const next = { ...settings, ...cambio };
    setSettings(next);
    savePrintSettings(next);
    setMsg("Preferencias guardadas en esta caja.");
    setTimeout(() => setMsg(""), 2500);
  }

  async function guardarBalanza(cambio: Partial<BalanzaConfig>) {
    const next = { ...balanza, ...cambio };
    setBalanza(next);
    try {
      await api("/api/settings/balanza", { method: "PUT", body: JSON.stringify(next) });
      setMsg("Configuración de balanza guardada.");
      setTimeout(() => setMsg(""), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  const lecturaPrueba = pruebaCodigo.trim()
    ? leerCodigoBalanza(pruebaCodigo.trim(), { ...balanza, habilitado: true })
    : null;

  async function guardarClubpay() {
    setError("");
    try {
      await api("/api/clubpay/api-key", {
        method: "PUT",
        body: JSON.stringify({ apiKey: clubpayKey.trim() }),
      });
      setClubpayKey("");
      setMsg("Clave de ClubPay guardada.");
      setTimeout(() => setMsg(""), 2500);
      const estado = await api<{ configurado: boolean; mockMode: boolean; clavePreview: string | null }>("/api/clubpay/estado");
      setClubpay(estado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la clave");
    }
  }

  async function probarImpresion() {
    setError("");
    if (!ultimaVenta) {
      setError("Todavía no hay ninguna venta para usar como prueba. Emití un ticket primero.");
      return;
    }
    try {
      await printTicket(ultimaVenta.id, settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo imprimir");
    }
  }

  return (
    <div>
      <h1>Configuración</h1>
      {msg && <p className="badge ok">{msg}</p>}
      {error && <p className="error">{error}</p>}

      <div className="row">
        <div className="card" style={{ minWidth: 320 }}>
          <h2>Impresión de tickets</h2>
          <p className="muted">
            Esta configuración es de <strong>esta caja</strong>: si usás el POS en otra
            computadora o tablet, cada una tiene su propia impresora.
          </p>

          <label className="switch-row">
            <input
              type="checkbox"
              checked={settings.autoPrint}
              onChange={(e) => update({ autoPrint: e.target.checked })}
            />
            <span>
              <strong>Imprimir el ticket al cobrar</strong>
              <span className="muted"> — sale solo apenas se emite la venta</span>
            </span>
          </label>

          <h2 style={{ marginTop: 16 }}>Tipo de impresora</h2>
          {ANCHOS.map((a) => (
            <label key={a.id} className="switch-row">
              <input
                type="radio"
                name="width"
                checked={settings.width === a.id}
                onChange={() => update({ width: a.id })}
              />
              <span>
                <strong>{a.label}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{a.detalle}</div>
              </span>
            </label>
          ))}

          <div className="toolbar" style={{ marginTop: 12 }}>
            <button onClick={probarImpresion}>🖨 Probar impresión</button>
            <span className="muted">Reimprime el último ticket emitido</span>
          </div>

          <div className="empty-state" style={{ marginTop: 12 }}>
            <strong>Sobre el diálogo de impresión</strong>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              El navegador siempre pide confirmación antes de imprimir: es una medida de
              seguridad y ninguna página web puede saltearla. En la práctica alcanza con
              apretar Enter, porque queda seleccionada la impresora predeterminada.
            </p>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              <strong>Opcional:</strong> Chrome puede imprimir sin preguntar si se lo abre
              con un parámetro especial. Para que funcione hay que <strong>cerrar Chrome
              por completo primero</strong> (si queda una ventana abierta, el parámetro se
              ignora) y después iniciarlo así:
            </p>
            <code style={{ display: "block", marginTop: 6, fontSize: 12, wordBreak: "break-all" }}>
              {/* Windows */}
              Windows: chrome.exe --kiosk-printing https://nexopos.app
            </code>
            <code style={{ display: "block", marginTop: 4, fontSize: 12, wordBreak: "break-all" }}>
              Mac: open -a &quot;Google Chrome&quot; --args --kiosk-printing https://nexopos.app
            </code>
          </div>
        </div>

        <div className="card" style={{ minWidth: 320 }}>
          <h2>Balanza etiquetadora</h2>
          <p className="muted">
            Si fraccionás y pesás mercadería (fiambres, verdulería, carnicería), la balanza
            imprime una etiqueta cuyo código de barras lleva adentro el producto y el peso.
            Activalo para que el POS lo lea de una.
          </p>

          <label className="switch-row">
            <input
              type="checkbox"
              checked={balanza.habilitado}
              onChange={(e) => guardarBalanza({ habilitado: e.target.checked })}
            />
            <span><strong>Leer etiquetas de balanza</strong></span>
          </label>

          {balanza.habilitado && (
            <>
              <div className="toolbar">
                <label style={{ width: 110 }}>Prefijo</label>
                <input
                  value={balanza.prefijos.join(", ")}
                  onChange={(e) => setBalanza({ ...balanza, prefijos: e.target.value.split(",").map((p) => p.trim()) })}
                  onBlur={() => guardarBalanza({ prefijos: balanza.prefijos.filter((p) => /^\d{1,2}$/.test(p)) })}
                  style={{ width: 110 }}
                />
                <span className="muted">Con qué empieza la etiqueta (20 a 29)</span>
              </div>

              <div className="toolbar">
                <label style={{ width: 110 }}>La etiqueta trae</label>
                <select
                  value={balanza.contenido}
                  onChange={(e) => guardarBalanza({
                    contenido: e.target.value as "peso" | "precio",
                    divisor: e.target.value === "peso" ? 1000 : 100,
                  })}
                >
                  <option value="peso">El peso (gramos)</option>
                  <option value="precio">El importe ya calculado</option>
                </select>
              </div>

              <div className="toolbar">
                <label style={{ width: 110 }}>Dígitos</label>
                <input
                  type="number" min={3} max={7} value={balanza.digitosCodigo}
                  onChange={(e) => guardarBalanza({ digitosCodigo: Number(e.target.value) })}
                  style={{ width: 70 }}
                />
                <span className="muted">del código</span>
                <input
                  type="number" min={3} max={7} value={balanza.digitosValor}
                  onChange={(e) => guardarBalanza({ digitosValor: Number(e.target.value) })}
                  style={{ width: 70 }}
                />
                <span className="muted">del {balanza.contenido}</span>
              </div>

              <div className="empty-state" style={{ marginTop: 8 }}>
                <strong>Probá una etiqueta</strong>
                <p className="muted" style={{ margin: "4px 0" }}>
                  Escaneá acá una etiqueta impresa por tu balanza para verificar que la lea bien:
                </p>
                <input
                  value={pruebaCodigo}
                  onChange={(e) => setPruebaCodigo(e.target.value)}
                  placeholder="Escaneá o tipeá el código…"
                  style={{ width: "100%" }}
                />
                {pruebaCodigo.trim() && (
                  lecturaPrueba ? (
                    <p className="badge ok" style={{ marginTop: 8 }}>
                      Producto <strong>{lecturaPrueba.plu}</strong>
                      {lecturaPrueba.peso !== undefined && (
                        <> · {lecturaPrueba.peso.toLocaleString("es-AR", { maximumFractionDigits: 3 })} kg</>
                      )}
                      {lecturaPrueba.importe !== undefined && (
                        <> · ${lecturaPrueba.importe.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</>
                      )}
                    </p>
                  ) : (
                    <p className="badge err" style={{ marginTop: 8 }}>
                      No coincide con el formato configurado. Revisá el prefijo y los dígitos.
                    </p>
                  )
                )}
              </div>
            </>
          )}
        </div>

        <div className="card" style={{ minWidth: 320 }}>
          <h2>ClubPay</h2>
          <p className="muted">
            Descuentos para socios de clubes e instituciones. La clave te la da ClubPay
            cuando activás el servicio desde NexoB2B; es propia de tu comercio.
          </p>
          {clubpay?.mockMode && (
            <p className="badge warn">
              Modo demo: no está conectado a ClubPay real. Probá con los QR
              QR-SIMPLE, QR-TOPE, QR-MIERCOLES, QR-SIN-OFERTAS, QR-PLAN,
              QR-INACTIVO o QR-VENCIDO.
            </p>
          )}
          <div className="toolbar">
            <input
              type="password"
              placeholder={clubpay?.clavePreview ?? "Clave de POS (pos_…)"}
              value={clubpayKey}
              onChange={(e) => setClubpayKey(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button onClick={guardarClubpay} disabled={!clubpayKey.trim()}>Guardar</button>
          </div>
          {clubpay?.configurado ? (
            <p className="badge ok">
              {clubpay.clavePreview ? `Configurado (${clubpay.clavePreview})` : "Activo"}
            </p>
          ) : (
            <p className="muted">Todavía no configurado: el POS no va a ofrecer el descuento.</p>
          )}
        </div>

        <div className="card" style={{ minWidth: 300 }}>
          <h2>Datos del comercio</h2>
          <p className="muted">
            Vienen de tu cuenta de NexoB2B. Para modificarlos, entrá a{" "}
            <a href="https://nexob2b.app" target="_blank" rel="noreferrer">nexob2b.app</a> →
            Perfil; los cambios se reflejan acá la próxima vez que inicies sesión.
          </p>
          {commerce ? (
            <table>
              <tbody>
                <tr><td className="muted">Nombre</td><td><strong>{commerce.name}</strong></td></tr>
                <tr><td className="muted">Email</td><td>{commerce.email}</td></tr>
                {commerce.tax_id && <tr><td className="muted">CUIT</td><td>{commerce.tax_id}</td></tr>}
                <tr>
                  <td className="muted">Ubicación</td>
                  <td>{[commerce.ciudad, commerce.provincia].filter(Boolean).join(", ") || "—"}</td>
                </tr>
                <tr>
                  <td className="muted">Estado</td>
                  <td>
                    {commerce.estado
                      ? <span className={`badge ${commerce.estado === "aprobado" ? "ok" : "warn"}`}>{commerce.estado}</span>
                      : "—"}
                  </td>
                </tr>
                <tr><td className="muted">ID NexoB2B</td><td className="muted">{commerce.nexob2b_id ?? "—"}</td></tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">Cargando…</p>
          )}
          {mockMode && (
            <p className="badge warn" style={{ marginTop: 8 }}>
              Modo demo: no conectado al NexoB2B real
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

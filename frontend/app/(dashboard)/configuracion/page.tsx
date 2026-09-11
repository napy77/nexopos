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
  address: string | null; phone: string | null; category: string | null;
}
interface Sale { id: number; ticket_number: number }

interface Region { slug: string; nombre: string; label: string; aparece: boolean }

interface Tienda {
  habilitada: boolean;
  slug: string | null;
  slugSugerido: string;
  direccion: string | null;
  regiones: Region[];
  pagos: {
    contraEntrega: boolean; transferencia: boolean;
    transferenciaAlias: string | null; transferenciaTitular: string | null;
    clubpay: boolean; clubpayDisponible: boolean; cuentaCorriente: boolean;
  };
  envios: {
    retiroEnLocal: boolean; envioPropio: boolean;
    nexoRider: boolean; nexoRiderDisponible: boolean; nexoRiderMotivo: string;
  };
}

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
  const [tienda, setTienda] = useState<Tienda | null>(null);
  const [alias, setAlias] = useState("");
  const [titular, setTitular] = useState("");
  const [slug, setSlug] = useState("");

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
    api<Tienda>("/api/settings/nexotienda")
      .then((t) => {
        setTienda(t);
        setAlias(t.pagos.transferenciaAlias ?? "");
        setTitular(t.pagos.transferenciaTitular ?? "");
        setSlug(t.slug ?? t.slugSugerido);
      })
      .catch(console.error);
    api<Sale[]>("/api/sales")
      .then((ventas) => setUltimaVenta(ventas[0] ?? null))
      .catch(console.error);
  }, []);

  /**
   * Guarda un cambio de la tienda. Si el backend lo rechaza —por ejemplo
   * publicar sin forma de pago— se muestra el motivo y el switch vuelve solo:
   * mostrarlo encendido cuando no se guardó sería mentirle al comerciante.
   */
  async function guardarTienda(cambio: Record<string, unknown>) {
    setError(""); setMsg("");
    try {
      setTienda(await api<Tienda>("/api/settings/nexotienda", {
        method: "PUT", body: JSON.stringify(cambio),
      }));
      setMsg("Guardado");
      setTimeout(() => setMsg(""), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
      const actual = await api<Tienda>("/api/settings/nexotienda").catch(() => null);
      if (actual) setTienda(actual);
    }
  }

  async function guardarSlug() {
    setError(""); setMsg("");
    try {
      await api("/api/settings/tienda-slug", { method: "PUT", body: JSON.stringify({ slug }) });
      const t = await api<Tienda>("/api/settings/nexotienda");
      setTienda(t); setSlug(t.slug ?? "");
      setMsg("Dirección guardada");
      setTimeout(() => setMsg(""), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la dirección");
    }
  }

  async function guardarRegion(regionSlug: string, aparece: boolean) {
    setError("");
    try {
      const r = await api<{ regiones: Region[] }>(`/api/settings/regiones/${regionSlug}`, {
        method: "PUT", body: JSON.stringify({ aparece }),
      });
      setTienda((t) => (t ? { ...t, regiones: r.regiones } : t));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

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

        <div className="card" style={{ minWidth: 340 }}>
          <h2>Tienda online</h2>
          {!tienda ? <p className="muted">Cargando…</p> : (
            <>
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <input type="checkbox" checked={tienda.habilitada}
                  onChange={(ev) => guardarTienda({ habilitada: ev.target.checked })} />
                <strong>Publicar mi tienda en NexoTienda</strong>
              </label>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                {tienda.habilitada
                  ? "Tus clientes pueden comprar desde el teléfono."
                  : "Mientras esté apagada, en NexoTienda aparecen tus datos pero no tu catálogo."}
              </p>

              <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>La dirección de tu tienda</h3>
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                <input value={slug} onChange={(ev) => setSlug(ev.target.value.toLowerCase())}
                  placeholder="mi-almacen" style={{ width: 150 }} />
                <span className="muted" style={{ fontSize: 13 }}>.nexotienda.app</span>
                <button type="button" className="ghost" onClick={guardarSlug}
                  disabled={!slug || slug === tienda.slug}>Guardar</button>
              </div>
              {tienda.direccion ? (
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Tu tienda abre en <strong>{tienda.direccion}</strong>
                </p>
              ) : (
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Todavía no elegiste dirección. Sin ella no se puede publicar la tienda.
                </p>
              )}
              {tienda.slug && (
                <p className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  Si la cambiás, los links que ya circularon van a seguir funcionando —te llevan a
                  la nueva—, pero conviene no cambiarla seguido.
                </p>
              )}

              {tienda.regiones.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>La página de tu pueblo</h3>
                  {tienda.regiones.map((r) => (
                    <Switch key={r.slug} label={`Aparecer en ${r.label}`}
                      ayuda={`${r.slug}.nexotienda.app`}
                      on={r.aparece} set={(v) => guardarRegion(r.slug, v)} />
                  ))}
                </>
              )}

              <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Cómo te pagan</h3>
              <Switch label="Pago contra entrega" ayuda="Paga cuando recibe el pedido o cuando pasa a retirarlo"
                on={tienda.pagos.contraEntrega}
                set={(v) => guardarTienda({ pagos: { contraEntrega: v } })} />

              <Switch label="Transferencia" ayuda="El cliente transfiere y sube el comprobante"
                on={tienda.pagos.transferencia}
                set={(v) => guardarTienda({ pagos: { transferencia: v, transferenciaAlias: alias, transferenciaTitular: titular } })} />
              {tienda.pagos.transferencia && (
                <div style={{ margin: "2px 0 10px 24px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input value={alias} onChange={(ev) => setAlias(ev.target.value)}
                    placeholder="Alias o CBU" style={{ width: 150 }} />
                  <input value={titular} onChange={(ev) => setTitular(ev.target.value)}
                    placeholder="Titular de la cuenta" style={{ width: 170 }} />
                  <button type="button" className="ghost"
                    onClick={() => guardarTienda({ pagos: { transferenciaAlias: alias, transferenciaTitular: titular } })}>
                    Guardar
                  </button>
                </div>
              )}

              <Switch label="ClubPay" ayuda={tienda.pagos.clubpayDisponible
                  ? "Con la billetera del cliente"
                  : "Cargá primero la clave de ClubPay, más arriba"}
                on={tienda.pagos.clubpay} disabled={!tienda.pagos.clubpayDisponible}
                set={(v) => guardarTienda({ pagos: { clubpay: v } })} />

              <Switch label="Cuenta corriente" ayuda="Solo para clientes que ya tienen cuenta abierta en el mostrador"
                on={tienda.pagos.cuentaCorriente}
                set={(v) => guardarTienda({ pagos: { cuentaCorriente: v } })} />

              <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Cómo entregás</h3>
              <Switch label="Retira del local" on={tienda.envios.retiroEnLocal}
                set={(v) => guardarTienda({ envios: { retiroEnLocal: v } })} />
              <Switch label="Envío propio" ayuda="Repartís vos, con tus horarios y tu costo"
                on={tienda.envios.envioPropio}
                set={(v) => guardarTienda({ envios: { envioPropio: v } })} />
              <Switch label="NexoRider" ayuda={tienda.envios.nexoRiderMotivo}
                on={false} disabled set={() => {}} />
            </>
          )}
        </div>

        <div className="card" style={{ minWidth: 300 }}>
          <h2>Datos del comercio</h2>
          <p className="muted">
            Vienen de tu cuenta de NexoB2B y son los que ve tu cliente en la tienda. Para
            modificarlos entrá a{" "}
            <a href="https://nexob2b.app" target="_blank" rel="noreferrer">nexob2b.app</a> →
            Perfil; se reflejan acá la próxima vez que inicies sesión. Se editan en un solo
            lugar a propósito: dos direcciones distintas terminan mostrándole al cliente la
            que está mal.
          </p>
          {commerce ? (
            <table>
              <tbody>
                <tr><td className="muted">Nombre</td><td><strong>{commerce.name}</strong></td></tr>
                <tr><td className="muted">Email</td><td>{commerce.email}</td></tr>
                {commerce.tax_id && <tr><td className="muted">CUIT</td><td>{commerce.tax_id}</td></tr>}
                <tr><td className="muted">Rubro</td><td>{commerce.category ?? "—"}</td></tr>
                <tr><td className="muted">Dirección</td><td>{commerce.address ?? "—"}</td></tr>
                <tr><td className="muted">Teléfono</td><td>{commerce.phone ?? "—"}</td></tr>
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

/** Un switch con su explicación al lado. Deshabilitado dice por qué. */
function Switch({ label, ayuda, on, set, disabled }: {
  label: string; ayuda?: string; on: boolean;
  set: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label style={{ display: "block", marginBottom: 8, opacity: disabled ? 0.55 : 1,
                    cursor: disabled ? "not-allowed" : "pointer" }}>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={on} disabled={disabled}
          onChange={(ev) => set(ev.target.checked)} />
        {label}
      </span>
      {ayuda && (
        <span className="muted" style={{ fontSize: 11, marginLeft: 24, display: "block" }}>{ayuda}</span>
      )}
    </label>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  loadPrintSettings, savePrintSettings, printTicket,
  DEFAULT_PRINT_SETTINGS, type PrintSettings,
} from "@/lib/print";
import { leerCodigoBalanza, BALANZA_DEFAULT, type BalanzaConfig } from "@/lib/balanza";
import { prepararImagen, prepararBanner } from "@/lib/imagen";

interface Commerce {
  id: number; nexob2b_id: string | null; name: string; email: string;
  tax_id: string | null; estado: string | null;
  ciudad: string | null; provincia: string | null; created_at: string;
  address: string | null; phone: string | null; category: string | null;
}
interface Sale { id: number; ticket_number: number }

interface Region { slug: string; nombre: string; label: string; aparece: boolean }

interface Tramo { dia: number; desde: string; hasta: string }
interface Franja { id?: number; label: string; kind: "retiro" | "reparto"; fee: number }

interface Tienda {
  habilitada: boolean;
  slug: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  whatsapp: string | null;
  aclaracionHorario: string | null;
  envioGratisDesde: number | null;
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
  const [tramos, setTramos] = useState<Tramo[]>([]);
  const [franjas, setFranjas] = useState<Franja[]>([]);

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
    api<{ tramos: Tramo[] }>("/api/settings/horario").then((d) => setTramos(d.tramos)).catch(console.error);
    api<{ franjas: Franja[] }>("/api/settings/franjas").then((d) => setFranjas(d.franjas)).catch(console.error);
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

  async function guardarPerfil(cambio: Record<string, unknown>) {
    setError(""); setMsg("");
    try {
      setTienda(await api<Tienda>("/api/settings/tienda-perfil", {
        method: "PUT", body: JSON.stringify(cambio),
      }));
      setMsg("Guardado");
      setTimeout(() => setMsg(""), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  async function subirFoto(file: File | undefined, cual: "logoUrl" | "bannerUrl") {
    if (!file) return;
    setError("");
    try {
      const dataUrl = cual === "bannerUrl" ? await prepararBanner(file) : await prepararImagen(file, 300);
      await guardarPerfil({ [cual]: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo procesar la imagen");
    }
  }

  /** El horario se manda entero: editarlo de a pedazos deja estados raros. */
  async function guardarHorario(nuevos: Tramo[]) {
    setError("");
    const limpios = nuevos.filter((t) => t.desde && t.hasta);
    try {
      await api("/api/settings/horario", { method: "PUT", body: JSON.stringify({ tramos: limpios }) });
      setTramos(limpios);
      setMsg("Horario guardado"); setTimeout(() => setMsg(""), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el horario");
    }
  }

  async function guardarFranjas(nuevas: Franja[]) {
    setError("");
    try {
      await api("/api/settings/franjas", {
        method: "PUT",
        body: JSON.stringify({ franjas: nuevas.map(({ label, kind, fee }) => ({ label, kind, fee })) }),
      });
      setFranjas(nuevas);
      setMsg("Franjas guardadas"); setTimeout(() => setMsg(""), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar");
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

              <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Cómo se ve tu tienda</h3>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
                <label style={{ cursor: "pointer", textAlign: "center" }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: 8, border: "1px dashed var(--border)",
                    backgroundImage: tienda.logoUrl ? `url(${tienda.logoUrl})` : undefined,
                    backgroundSize: "cover", backgroundPosition: "center",
                    display: "grid", placeItems: "center", fontSize: 11, color: "var(--muted)",
                  }}>{tienda.logoUrl ? "" : "Logo"}</div>
                  <input type="file" accept="image/*" hidden
                    onChange={(ev) => subirFoto(ev.target.files?.[0], "logoUrl")} />
                  <span className="muted" style={{ fontSize: 10 }}>Cambiar</span>
                </label>
                <label style={{ cursor: "pointer", flex: 1, textAlign: "center" }}>
                  <div style={{
                    height: 64, borderRadius: 8, border: "1px dashed var(--border)",
                    backgroundImage: tienda.bannerUrl ? `url(${tienda.bannerUrl})` : undefined,
                    backgroundSize: "cover", backgroundPosition: "center",
                    display: "grid", placeItems: "center", fontSize: 11, color: "var(--muted)",
                  }}>{tienda.bannerUrl ? "" : "Banner — la foto ancha de arriba"}</div>
                  <input type="file" accept="image/*" hidden
                    onChange={(ev) => subirFoto(ev.target.files?.[0], "bannerUrl")} />
                  <span className="muted" style={{ fontSize: 10 }}>Cambiar</span>
                </label>
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>
                El logo te identifica en la lista del pueblo; el banner es la cara de tu tienda.
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
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: 12 }}>Tu tienda abre en</span>
                  <a href={tienda.direccion} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, fontWeight: 600 }}>{tienda.direccion}</a>
                  <BotonCopiar texto={tienda.direccion} />
                </div>
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

              <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Horario de atención</h3>
              <Horario tramos={tramos} onGuardar={guardarHorario} />
              <input defaultValue={tienda.aclaracionHorario ?? ""} placeholder="Aclaración: feriados cerrado…"
                style={{ width: "100%", marginTop: 6 }}
                onBlur={(ev) => {
                  if (ev.target.value !== (tienda.aclaracionHorario ?? "")) {
                    guardarPerfil({ aclaracionHorario: ev.target.value });
                  }
                }} />

              <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Franjas de retiro y reparto</h3>
              <Franjas franjas={franjas} onGuardar={guardarFranjas} />
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Envío sin cargo desde $</span>
                <input type="number" min="0" defaultValue={tienda.envioGratisDesde ?? ""}
                  placeholder="sin mínimo" style={{ width: 100 }}
                  onBlur={(ev) => {
                    const v = ev.target.value === "" ? null : Number(ev.target.value);
                    if (v !== tienda.envioGratisDesde) guardarPerfil({ envioGratisDesde: v });
                  }} />
              </div>

              <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Cómo te pagan</h3>
              <Switch label="Pago contra entrega" ayuda="Paga cuando recibe el pedido o cuando pasa a retirarlo"
                on={tienda.pagos.contraEntrega}
                set={(v) => guardarTienda({ pagos: { contraEntrega: v } })} />

              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
                <span className="muted" style={{ fontSize: 12 }}>WhatsApp de atención</span>
                <input defaultValue={tienda.whatsapp ?? ""} placeholder="3515630140" style={{ width: 130 }}
                  onBlur={(ev) => {
                    if (ev.target.value !== (tienda.whatsapp ?? "")) guardarPerfil({ whatsapp: ev.target.value });
                  }} />
              </div>

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

const NOMBRE_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
/** De lunes a domingo, que es como se lee un horario */
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

/**
 * El horario, con dos tramos por día.
 *
 * Dos y no uno porque el almacén cierra al mediodía, que es el caso normal.
 *
 * **Los inputs van sin controlar, a propósito.** Un `input type="time"`
 * controlado por estado pierde lo que se tipea: mientras la hora está a medias
 * el navegador reporta valor vacío, el re-render lo pisa y el campo vuelve a
 * `--:--` en la cara del que está escribiendo. Acá el DOM manda mientras se
 * edita y se lee al guardar, que es como funcionan los campos nativos de hora.
 *
 * El `key` sobre el contenedor es lo que hace que los valores se refresquen
 * cuando el horario cambió por otra vía —guardar, o copiar la semana—: sin él,
 * los `defaultValue` quedarían pegados al primer render.
 */
function Horario({ tramos, onGuardar }: { tramos: Tramo[]; onGuardar: (t: Tramo[]) => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const [aviso, setAviso] = useState("");

  const porDia = (dia: number, n: number) =>
    tramos.filter((t) => t.dia === dia).sort((a, b) => a.desde.localeCompare(b.desde))[n];

  /** Lo que hay escrito ahora mismo en la pantalla */
  function leer(): Tramo[] {
    const out: Tramo[] = [];
    for (const dia of ORDEN_DIAS) {
      for (const n of [0, 1]) {
        const d = caja.current?.querySelector<HTMLInputElement>(`[data-k="${dia}-${n}-desde"]`)?.value ?? "";
        const h = caja.current?.querySelector<HTMLInputElement>(`[data-k="${dia}-${n}-hasta"]`)?.value ?? "";
        if (d && h) out.push({ dia, desde: d, hasta: h });
      }
    }
    return out;
  }

  function guardar() {
    setAviso("");
    onGuardar(leer());
  }

  /**
   * Copiar el lunes al resto de la semana, porque cargar seis días a mano es
   * la fricción que hace que el horario quede sin completar.
   *
   * Si el lunes está vacío no hace nada y lo dice. Antes guardaba la lista
   * vacía y borraba todo el horario de un toque, sin preguntar.
   */
  function copiarSemana() {
    const actual = leer();
    const base = actual.filter((t) => t.dia === 1);
    if (base.length === 0) {
      setAviso("Cargá primero el horario del lunes y después copialo.");
      return;
    }
    const resto = actual.filter((t) => t.dia === 0);
    const out: Tramo[] = [];
    for (const dia of [1, 2, 3, 4, 5, 6]) {
      for (const t of base) out.push({ dia, desde: t.desde, hasta: t.hasta });
    }
    setAviso("");
    onGuardar([...out, ...resto]);
  }

  return (
    <div>
      {/* El key rearma los campos cuando el horario cambió por otra vía */}
      <div ref={caja} key={JSON.stringify(tramos)}>
        <table style={{ fontSize: 12 }}>
          <tbody>
            {ORDEN_DIAS.map((dia) => (
              <tr key={dia}>
                <td style={{ width: 80 }}>{NOMBRE_DIA[dia]}</td>
                {[0, 1].map((n) => (
                  <td key={n}>
                    <input type="time" data-k={`${dia}-${n}-desde`} style={{ width: 92 }}
                      defaultValue={porDia(dia, n)?.desde ?? ""} />
                    <span className="muted"> a </span>
                    <input type="time" data-k={`${dia}-${n}-hasta`} style={{ width: 92 }}
                      defaultValue={porDia(dia, n)?.hasta ?? ""} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={guardar}>Guardar horario</button>
        <button type="button" className="ghost" onClick={copiarSemana}>
          Copiar el lunes al resto de la semana
        </button>
        {aviso && <span className="muted" style={{ fontSize: 12 }}>{aviso}</span>}
      </div>
    </div>
  );
}

/**
 * Las franjas de retiro y reparto.
 *
 * No son una limitación: son lo que hace rentable el reparto propio, porque
 * permiten salir a las 12 y a las 19 con cinco pedidos de la misma zona. El
 * reparto inmediato convierte cada pedido en un viaje que pierde plata.
 */
function Franjas({ franjas, onGuardar }: { franjas: Franja[]; onGuardar: (f: Franja[]) => void }) {
  const [lista, setLista] = useState<Franja[]>(franjas);
  useEffect(() => setLista(franjas), [franjas]);

  const cambiar = (i: number, cambio: Partial<Franja>) =>
    setLista((l) => l.map((f, n) => (n === i ? { ...f, ...cambio } : f)));

  const sucio = JSON.stringify(lista) !== JSON.stringify(franjas);

  return (
    <div>
      {lista.map((f, i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <select value={f.kind} onChange={(ev) => cambiar(i, { kind: ev.target.value as Franja["kind"] })}>
            <option value="retiro">Retiro</option>
            <option value="reparto">Reparto</option>
          </select>
          <input value={f.label} placeholder="12:30 a 14:00" style={{ flex: 1, minWidth: 120 }}
            onChange={(ev) => cambiar(i, { label: ev.target.value })} />
          <input type="number" min="0" value={f.fee} style={{ width: 80 }}
            title="Costo del envío" disabled={f.kind === "retiro"}
            onChange={(ev) => cambiar(i, { fee: Number(ev.target.value) })} />
          <button type="button" className="ghost" title="Quitar"
            onClick={() => setLista((l) => l.filter((_, n) => n !== i))}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="ghost"
          onClick={() => setLista((l) => [...l, { label: "", kind: "reparto", fee: 0 }])}>
          + Agregar franja
        </button>
        {sucio && <button type="button" onClick={() => onGuardar(lista)}>Guardar franjas</button>}
      </div>
    </div>
  );
}


/**
 * Copia la dirección de la tienda, para pegarla en un estado de WhatsApp o en
 * una publicación.
 *
 * Se copia la URL sola y no un texto armado: el comerciante escribe su propio
 * mensaje, y una frase nuestra metida en su estado suena a otro.
 *
 * Confirma que copió. Sin eso el que aprieta no sabe si pasó algo y termina
 * seleccionando el texto a mano, que es lo que el botón venía a evitar.
 */
function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  /** El truco viejo: anda donde la API del portapapeles no está permitida */
  function copiarALaVieja(): boolean {
    try {
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  async function copiar() {
    // La API del portapapeles necesita HTTPS y permiso, y falla más seguido de
    // lo que uno espera. Se intenta primero porque es la buena, pero si dice
    // que no todavía queda el truco viejo: recién si fallan las dos se le pide
    // al comerciante que copie a mano.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
        return;
      }
    } catch {
      /* sigue abajo */
    }
    if (copiarALaVieja()) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      return;
    }
    window.prompt("Copiá tu dirección:", texto);
  }

  return (
    <button type="button" className="ghost" onClick={copiar}
      title="Copiar para pegar en WhatsApp o donde publiques"
      style={{ fontSize: 12, padding: "2px 8px" }}>
      {copiado ? "✓ Copiado" : "Copiar"}
    </button>
  );
}

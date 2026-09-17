"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Campana {
  id: number; nombre: string; desde: string; hasta: string;
  descuento: number; vigente: boolean; productos: number;
}
interface EnCampana {
  productId: number; nombre: string; precio: number | null; precioCampana: number | null;
}
interface ItemStock { product_id: number; name: string; sale_price: string | null }
interface Taxo { nivel: "pasillo" | "rubro" | "subrubro"; clave: string; productos: number }

const money = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Cordoba" });

export default function CampanasPage() {
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [dentro, setDentro] = useState<EnCampana[]>([]);
  const [taxo, setTaxo] = useState<Taxo[]>([]);
  const [busca, setBusca] = useState("");
  const [encontrados, setEncontrados] = useState<ItemStock[]>([]);
  const [nivel, setNivel] = useState<"pasillo" | "rubro" | "subrubro">("rubro");
  const [clave, setClave] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(() => {
    api<Campana[]>("/api/campanas").then(setCampanas).catch(() => setCampanas([]));
  }, []);
  useEffect(cargar, [cargar]);
  useEffect(() => {
    api<Taxo[]>("/api/margenes/taxonomia").then(setTaxo).catch(() => setTaxo([]));
  }, []);

  const cargarDentro = useCallback((id: number) => {
    api<EnCampana[]>(`/api/campanas/${id}/productos`).then(setDentro).catch(() => setDentro([]));
  }, []);

  useEffect(() => {
    if (busca.trim().length < 2) { setEncontrados([]); return; }
    const t = setTimeout(() => {
      api<ItemStock[]>(`/api/stock?q=${encodeURIComponent(busca.trim())}`)
        .then((r) => setEncontrados(r.slice(0, 15)))
        .catch(() => setEncontrados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  function aviso(t: string) { setMsg(t); setTimeout(() => setMsg(""), 2500); }

  async function crear(form: FormData) {
    setError("");
    try {
      await api("/api/campanas", {
        method: "POST",
        body: JSON.stringify({
          nombre: String(form.get("nombre") || "").trim(),
          desde: String(form.get("desde") || ""),
          hasta: String(form.get("hasta") || ""),
          descuento: Number(form.get("descuento") || 0),
        }),
      });
      setCreando(false); cargar(); aviso("Campaña creada. Ahora elegí qué productos entran.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear");
    }
  }

  async function borrar(c: Campana) {
    if (!window.confirm(`¿Borrar "${c.nombre}"?\n\nLos productos vuelven a su precio de siempre.`)) return;
    try {
      await api(`/api/campanas/${c.id}`, { method: "DELETE" });
      if (abierta === c.id) setAbierta(null);
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar");
    }
  }

  async function mover(c: Campana, hacia: "arriba" | "abajo") {
    await api(`/api/campanas/${c.id}/orden`, { method: "PUT", body: JSON.stringify({ hacia }) })
      .catch(() => {});
    cargar();
  }

  async function tocarProductos(id: number, cambio: Record<string, unknown>) {
    setError("");
    try {
      const r = await api<{ productos: number }>(`/api/campanas/${id}/productos`, {
        method: "PUT", body: JSON.stringify(cambio),
      });
      cargarDentro(id); cargar();
      aviso(`${r.productos} productos en la campaña`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  const opciones = taxo.filter((t) => t.nivel === nivel);

  return (
    <div>
      <h1>Campañas</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Tandas de ofertas para tu tienda online. El nombre que le pongas es el título de
        la sección que ve el comprador.
      </p>
      {/*
        Lo más importante de la pantalla, y por eso está arriba de todo: el
        descuento NO cambia lo que cobra la caja. Un comerciante que publica
        "25% off" y después cobra el precio entero en el mostrador tiene un
        problema con su cliente, no con el software.
      */}
      <p className="badge info" style={{ marginBottom: 12 }}>
        Sólo cambia el precio de tu tienda online. En el mostrador seguís cobrando el
        precio de siempre.
      </p>

      {error && <p className="error">{error}</p>}
      {msg && <p className="badge ok">{msg}</p>}

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => setCreando(true)}>Nueva campaña</button>
      </div>

      {campanas.length === 0 && !creando && (
        <p className="muted">
          Todavía no hay ninguna. Sin campañas tu tienda se ve como siempre.
        </p>
      )}

      {campanas.map((c, i) => (
        <div key={c.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>{c.nombre}</h2>
            <span className={c.vigente ? "badge ok" : "badge"}>
              {c.vigente ? "en la tienda ahora" : "fuera de fecha"}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              −{c.descuento}% · del {c.desde} al {c.hasta} · {c.productos}{" "}
              {c.productos === 1 ? "producto" : "productos"}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <button type="button" className="ghost" style={{ fontSize: 11 }}
                disabled={i === 0} onClick={() => mover(c, "arriba")}>↑</button>
              <button type="button" className="ghost" style={{ fontSize: 11 }}
                disabled={i === campanas.length - 1} onClick={() => mover(c, "abajo")}>↓</button>
              <button type="button" className="ghost" style={{ fontSize: 11 }}
                onClick={() => { const n = abierta === c.id ? null : c.id; setAbierta(n); if (n) cargarDentro(n); }}>
                {abierta === c.id ? "Cerrar" : "Productos"}
              </button>
              <button type="button" className="ghost" style={{ fontSize: 11 }}
                onClick={() => borrar(c)}>Borrar</button>
            </span>
          </div>

          {c.vigente && c.productos === 0 && (
            <p className="badge warn" style={{ marginTop: 8 }}>
              Está vigente pero no tiene productos: en la tienda no se ve nada.
            </p>
          )}

          {abierta === c.id && (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div className="toolbar">
                <input value={busca} onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscá un producto por nombre o código"
                  style={{ flex: 1, minWidth: 180 }} />
              </div>
              {encontrados.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
                  {encontrados.map((p) => (
                    <button key={p.product_id} type="button" className="ghost" style={{ fontSize: 12 }}
                      onClick={() => tocarProductos(c.id, { agregar: [p.product_id] })}>
                      + {p.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Nadie arma una tanda de cien productos buscándolos de a uno */}
              <div className="toolbar" style={{ marginTop: 6 }}>
                <select value={nivel} onChange={(e) => {
                  setNivel(e.target.value as typeof nivel); setClave("");
                }}>
                  <option value="pasillo">Pasillo</option>
                  <option value="rubro">Rubro</option>
                  <option value="subrubro">Subrubro</option>
                </select>
                <select value={clave} onChange={(e) => setClave(e.target.value)}
                  style={{ flex: 1, minWidth: 140 }}>
                  <option value="">Agregar todo un…</option>
                  {opciones.map((o) => (
                    <option key={o.clave} value={o.clave}>{o.clave} ({o.productos})</option>
                  ))}
                </select>
                <button type="button" disabled={!clave}
                  onClick={() => { tocarProductos(c.id, { agregarPor: { nivel, clave } }); setClave(""); }}>
                  Agregar
                </button>
              </div>

              {dentro.length === 0 ? (
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  Todavía no entró ninguno.
                </p>
              ) : (
                <div style={{ overflowX: "auto", marginTop: 10 }}>
                  <table style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Producto</th><th className="num">Precio</th>
                        <th className="num">En la campaña</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {dentro.map((p) => (
                        <tr key={p.productId}>
                          <td>{p.nombre}</td>
                          <td className="num muted">
                            {p.precio === null ? "sin precio" : money(p.precio)}
                          </td>
                          <td className="num">
                            {p.precioCampana === null
                              ? <span className="muted">no sale a la tienda</span>
                              : <strong>{money(p.precioCampana)}</strong>}
                          </td>
                          <td>
                            <button type="button" className="ghost" style={{ fontSize: 11 }}
                              onClick={() => tocarProductos(c.id, { quitar: [p.productId] })}>
                              Quitar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {creando && (
        <div className="modal-backdrop" onClick={() => setCreando(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2 style={{ marginTop: 0 }}>Nueva campaña</h2>
            <form action={crear}>
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ fontSize: 13 }}>
                  Cómo se va a llamar la sección
                  <input name="nombre" required autoFocus maxLength={80}
                    placeholder="Ofertas imperdibles" style={{ width: "100%" }} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ fontSize: 13, flex: 1 }}>
                    Desde
                    <input name="desde" type="date" required defaultValue={hoy()}
                      style={{ width: "100%" }} />
                  </label>
                  <label style={{ fontSize: 13, flex: 1 }}>
                    Hasta
                    <input name="hasta" type="date" required defaultValue={hoy()}
                      style={{ width: "100%" }} />
                  </label>
                </div>
                <label style={{ fontSize: 13 }}>
                  Descuento
                  <input name="descuento" type="number" step="0.5" min="0.5" max="95" required
                    placeholder="25" style={{ width: "100%" }} />
                  <span className="muted" style={{ fontSize: 11 }}>
                    % que se le saca al precio de tu tienda
                  </span>
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="submit">Crear</button>
                <button type="button" className="secondary" onClick={() => setCreando(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

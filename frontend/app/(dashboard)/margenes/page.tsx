"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Nivel = "global" | "pasillo" | "rubro" | "subrubro" | "producto";

interface Regla { id: number; nivel: Nivel; clave: string | null; nombre: string | null; margen: number }
interface Taxo { nivel: "pasillo" | "rubro" | "subrubro"; clave: string; productos: number }
interface ItemStock { product_id: number; name: string }
interface Estado {
  reglas: Regla[]; sumaIva: boolean; redondeo: number;
  conteo: { total: number; sin_precio: number; sin_costo: number; a_mano: number };
}
interface Muestra {
  nombre: string; costo: number; margen: number; nivel: Nivel | null;
  alicuota: number | null; precioActual: number | null; precioNuevo: number;
}
interface Simulacion {
  alcanzados: number; sinCosto: number; sinRegla: number;
  sumaIva: boolean; redondeo: number; muestra: Muestra[];
}

type Alcance = "sin-precio" | "calculados" | "todos";

const money = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

const NIVEL_LABEL: Record<Nivel, string> = {
  global: "Todo el negocio", pasillo: "Pasillo", rubro: "Rubro",
  subrubro: "Subrubro", producto: "Producto",
};

export default function MargenesPage() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [taxo, setTaxo] = useState<Taxo[]>([]);
  const [sim, setSim] = useState<Simulacion | null>(null);
  const [alcance, setAlcance] = useState<Alcance>("sin-precio");
  const [nivel, setNivel] = useState<Nivel>("pasillo");
  const [clave, setClave] = useState("");
  const [margen, setMargen] = useState("");
  // Buscador para el nivel producto: la lista completa puede ser de miles.
  const [busca, setBusca] = useState("");
  const [encontrados, setEncontrados] = useState<ItemStock[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(() => {
    api<Estado>("/api/margenes").then(setEstado).catch(() => setEstado(null));
    api<Taxo[]>("/api/margenes/taxonomia").then(setTaxo).catch(() => setTaxo([]));
  }, []);
  useEffect(cargar, [cargar]);

  const global = estado?.reglas.find((r) => r.nivel === "global");

  useEffect(() => {
    if (nivel !== "producto" || busca.trim().length < 2) { setEncontrados([]); return; }
    const t = setTimeout(() => {
      api<ItemStock[]>(`/api/stock?q=${encodeURIComponent(busca.trim())}`)
        .then((r) => setEncontrados(r.slice(0, 20)))
        .catch(() => setEncontrados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busca, nivel]);

  async function guardarRegla(n: Nivel, c: string | null, m: string) {
    const valor = Number(m);
    if (!m.trim() || Number.isNaN(valor)) { setError("Poné un porcentaje"); return; }
    setError(""); setSim(null);
    try {
      await api("/api/margenes/regla", {
        method: "PUT", body: JSON.stringify({ nivel: n, clave: c, margen: valor }),
      });
      cargar();
      setMsg("Guardado"); setTimeout(() => setMsg(""), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  async function borrar(id: number) {
    setSim(null);
    try {
      await api(`/api/margenes/regla/${id}`, { method: "DELETE" });
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar");
    }
  }

  async function guardarConfig(sumaIva: boolean, redondeo: number) {
    setSim(null);
    try {
      await api("/api/margenes/config", { method: "PUT", body: JSON.stringify({ sumaIva, redondeo }) });
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  async function simular() {
    setError(""); setTrabajando(true);
    try {
      setSim(await api<Simulacion>("/api/margenes/simular", {
        method: "POST", body: JSON.stringify({ alcance }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo calcular");
    } finally {
      setTrabajando(false);
    }
  }

  async function aplicar() {
    if (!sim) return;
    const aviso = alcance === "todos"
      ? `Vas a cambiar el precio de ${sim.alcanzados} productos, incluidos los que pusiste a mano. No se puede deshacer.`
      : `Vas a ponerle precio a ${sim.alcanzados} productos.`;
    if (!window.confirm(`${aviso}\n\n¿Seguimos?`)) return;
    setTrabajando(true); setError("");
    try {
      const r = await api<{ aplicados: number }>("/api/margenes/aplicar", {
        method: "POST", body: JSON.stringify({ alcance }),
      });
      setSim(null);
      cargar();
      setMsg(`Listo: ${r.aplicados} productos con precio nuevo.`);
      setTimeout(() => setMsg(""), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar");
    } finally {
      setTrabajando(false);
    }
  }

  if (!estado) return <p className="muted">Cargando…</p>;

  const opciones = taxo.filter((t) => t.nivel === nivel);

  return (
    <div>
      <h1>Márgenes</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        En vez de escribir el precio de cada producto, poné cuánto querés ganar sobre el
        costo. El precio se calcula solo.
      </p>

      {error && <p className="error">{error}</p>}
      {msg && <p className="badge ok">{msg}</p>}

      <div className="grid">
        {/* ── El margen general ─────────────────────────────────────────── */}
        <div className="card" style={{ minWidth: 320 }}>
          <h2>Cuánto ganás</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            Este es el que vale para todo, salvo donde pongas otro más abajo.
          </p>
          <div className="toolbar">
            <input type="number" step="0.5" style={{ width: 110 }}
              defaultValue={global?.margen ?? ""} placeholder="30"
              key={`g-${global?.margen ?? "vacio"}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && Number(v) !== global?.margen) guardarRegla("global", null, v);
              }} />
            <span className="muted">% sobre el costo</span>
          </div>
          {!global && (
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Sin un margen general, sólo van a tener precio los productos que caigan en
              alguna regla de abajo.
            </p>
          )}

          <h2 style={{ marginTop: 16, fontSize: 15 }}>Cómo se arma el precio</h2>
          {/*
            El IVA no es un detalle de configuración: el costo que guardamos es
            NETO y el precio del mostrador es FINAL. Sin este paso, todo el
            catálogo saldría un 21% por debajo de lo que el comerciante cree.
          */}
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" checked={estado.sumaIva}
              onChange={(e) => guardarConfig(e.target.checked, estado.redondeo)} />
            <span>
              Sumarle el IVA
              <span className="muted" style={{ display: "block", fontSize: 11 }}>
                El costo que viene de NexoB2B es sin IVA, y el precio del mostrador lo
                incluye. Si lo destildás, tu margen tiene que cubrirlo.
              </span>
            </span>
          </label>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Redondear a</span>
            <select value={String(estado.redondeo)}
              onChange={(e) => guardarConfig(estado.sumaIva, Number(e.target.value))}>
              <option value="0">sin redondear</option>
              <option value="1">$1</option>
              <option value="10">$10</option>
              <option value="50">$50</option>
              <option value="100">$100</option>
              <option value="1000">$1.000</option>
            </select>
          </div>
        </div>

        {/* ── Excepciones ──────────────────────────────────────────────── */}
        <div className="card" style={{ minWidth: 340 }}>
          <h2>Excepciones</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            Gana siempre la más precisa: lo que diga un producto le gana al subrubro, el
            subrubro al rubro, el rubro al pasillo, y el pasillo al margen general.
          </p>

          <div className="toolbar" style={{ marginTop: 8 }}>
            <select value={nivel} onChange={(e) => { setNivel(e.target.value as Nivel); setClave(""); setBusca(""); }}>
              <option value="pasillo">Pasillo</option>
              <option value="rubro">Rubro</option>
              <option value="subrubro">Subrubro</option>
              <option value="producto">Un producto</option>
            </select>
            {nivel === "producto" ? (
              <select value={clave} onChange={(e) => setClave(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
                <option value="">
                  {encontrados.length === 0 ? "Buscalo abajo…" : "Elegí cuál…"}
                </option>
                {encontrados.map((o) => (
                  <option key={o.product_id} value={String(o.product_id)}>{o.name}</option>
                ))}
              </select>
            ) : (
              <select value={clave} onChange={(e) => setClave(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
                <option value="">Elegí cuál…</option>
                {opciones.map((o) => (
                  <option key={o.clave} value={o.clave}>{o.clave} ({o.productos})</option>
                ))}
              </select>
            )}
            <input type="number" step="0.5" style={{ width: 90 }} placeholder="%"
              value={margen} onChange={(e) => setMargen(e.target.value)} />
            <button type="button" disabled={!clave || !margen.trim()}
              onClick={() => { guardarRegla(nivel, clave, margen); setClave(""); setMargen(""); }}>
              Agregar
            </button>
          </div>
          {nivel === "producto" && (
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscá el producto por nombre o código"
              style={{ width: "100%", marginTop: 6 }} />
          )}
          {nivel !== "producto" && opciones.length === 0 && (
            <p className="muted" style={{ fontSize: 11 }}>
              Tus productos no tienen {nivel} cargado, así que no hay por dónde separarlos.
            </p>
          )}

          {estado.reglas.filter((r) => r.nivel !== "global").length > 0 && (
            <table style={{ fontSize: 13, marginTop: 10 }}>
              <tbody>
                {estado.reglas.filter((r) => r.nivel !== "global").map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ fontSize: 11 }}>{NIVEL_LABEL[r.nivel]}</td>
                    <td>{r.nombre ?? r.clave}</td>
                    <td className="num">{r.margen}%</td>
                    <td>
                      <button type="button" className="ghost" style={{ fontSize: 11 }}
                        onClick={() => borrar(r.id)}>Quitar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Aplicar ──────────────────────────────────────────────────── */}
        <div className="card" style={{ minWidth: 340 }}>
          <h2>Poner los precios</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            Tenés {estado.conteo.total}{" "}
            {estado.conteo.total === 1 ? "producto" : "productos"}:{" "}
            {estado.conteo.sin_precio} sin precio, {estado.conteo.a_mano} con un precio que
            pusiste vos
            {estado.conteo.sin_costo > 0 && <>, y {estado.conteo.sin_costo} sin costo cargado</>}.
          </p>

          <div style={{ display: "grid", gap: 6, marginTop: 8, fontSize: 13 }}>
            {([
              ["sin-precio", "Sólo los que no tienen precio", "No toca nada de lo que ya está puesto."],
              ["calculados", "Recalcular los que calculó el margen", "Deja como están los que pusiste a mano."],
              ["todos", "Todos, incluso los que puse a mano", "Pisa los precios que elegiste uno por uno."],
            ] as const).map(([v, label, ayuda]) => (
              <label key={v} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="radio" name="alcance" checked={alcance === v}
                  onChange={() => { setAlcance(v); setSim(null); }} />
                <span>
                  {label}
                  <span className="muted" style={{ display: "block", fontSize: 11 }}>{ayuda}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="toolbar" style={{ marginTop: 10 }}>
            <button type="button" className="secondary" onClick={simular} disabled={trabajando}>
              {trabajando ? "Calculando…" : "Ver qué quedaría"}
            </button>
            {sim && sim.alcanzados > 0 && (
              <button type="button" onClick={aplicar} disabled={trabajando}>
                Aplicar a {sim.alcanzados}
              </button>
            )}
          </div>

          {sim && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 13, margin: "4px 0" }}>
                <strong>{sim.alcanzados}</strong>{" "}
                {sim.alcanzados === 1 ? "producto quedaría" : "productos quedarían"} con precio.
                {sim.sinCosto > 0 && (
                  <span className="muted">
                    {" "}{sim.sinCosto} {sim.sinCosto === 1 ? "no tiene" : "no tienen"} costo
                    cargado y no se {sim.sinCosto === 1 ? "puede" : "pueden"} calcular.
                  </span>
                )}
                {sim.sinRegla > 0 && (
                  <span className="muted">
                    {" "}{sim.sinRegla} {sim.sinRegla === 1 ? "no cae" : "no caen"} en ninguna regla.
                  </span>
                )}
              </p>
              {sim.muestra.length > 0 && (
                <>
                  <p className="muted" style={{ fontSize: 11, margin: "8px 0 4px" }}>
                    Los primeros, para que veas la cuenta:
                  </p>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Producto</th><th className="num">Costo</th>
                          <th className="num">Margen</th>
                          {sim.sumaIva && <th className="num">IVA</th>}
                          <th className="num">Ahora</th><th className="num">Quedaría</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sim.muestra.map((m, i) => (
                          <tr key={i}>
                            <td>{m.nombre}</td>
                            <td className="num">{money(m.costo)}</td>
                            <td className="num">
                              {m.margen}%
                              <span className="muted" style={{ fontSize: 10, display: "block" }}>
                                {m.nivel === "global" ? "general" : NIVEL_LABEL[m.nivel ?? "global"].toLowerCase()}
                              </span>
                            </td>
                            {sim.sumaIva && <td className="num muted">{m.alicuota ?? 0}%</td>}
                            <td className="num muted">
                              {m.precioActual === null ? "—" : money(m.precioActual)}
                            </td>
                            <td className="num"><strong>{money(m.precioNuevo)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

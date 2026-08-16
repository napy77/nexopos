"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money } from "@/lib/api";

interface StockItem {
  id: number; product_id: number; name: string; ean: string | null; category: string | null;
  unit: string; quantity: string; cost: string | null; sale_price: string | null;
  min_stock: string; low_stock: boolean;
  origen: string; plu: string | null; venta_por_peso: boolean;
  image_url: string | null; imagen_propia: boolean;
}
interface Movement {
  id: number; name: string; type: string; quantity: string; reference: string | null; created_at: string;
}
import type { B2BProductoMaestro, B2BPresentacionMaestra, B2BTaxonomia } from "@/lib/b2b-types";
import { prepararImagen } from "@/lib/imagen";

interface AltaEnCurso { producto: B2BProductoMaestro; opciones: B2BPresentacionMaestra[]; presIdx: number }

/**
 * Presentaciones del producto maestro. Si el catálogo no tiene ninguna
 * cargada, se ofrece una "Unidad" basada en el producto (alcanza para
 * venderlo en el POS).
 */
function buildOpciones(producto: B2BProductoMaestro): B2BPresentacionMaestra[] {
  if (producto.presentaciones?.length) return producto.presentaciones;
  return [{
    id: producto.id, // identidad = producto maestro
    nombre: producto.unidad_base ?? "Unidad",
    factor: 1,
    ean_propio: null,
  }];
}

const MOVE_LABEL: Record<string, string> = {
  purchase_reception: "Recepción de compra",
  sale: "Venta",
  manual_adjustment: "Ajuste manual",
  return: "Devolución",
};

export default function StockPage() {
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [items, setItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [catQ, setCatQ] = useState("");
  const [catResults, setCatResults] = useState<B2BProductoMaestro[]>([]);
  const [adding, setAdding] = useState<AltaEnCurso | null>(null);
  const [okMsg, setOkMsg] = useState("");
  const [showPropio, setShowPropio] = useState(false);
  const [porPeso, setPorPeso] = useState(false);
  const [taxonomia, setTaxonomia] = useState<B2BTaxonomia | null>(null);
  const [taxSel, setTaxSel] = useState({ pasilloId: "", rubroId: "", subrubroId: "" });
  const [fotoNueva, setFotoNueva] = useState<string | null>(null);
  const [fotoDe, setFotoDe] = useState<StockItem | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q, lowOnly: String(lowOnly) });
    setItems(await api<StockItem[]>(`/api/stock?${params}`));
  }, [q, lowOnly]);

  useEffect(() => { load().catch(console.error); }, [load]);
  useEffect(() => {
    api<B2BTaxonomia>("/api/catalog/taxonomia").then(setTaxonomia).catch(console.error);
  }, []);
  useEffect(() => {
    api<Movement[]>("/api/stock/movements").then(setMovements).catch(console.error);
  }, [items]);

  // Búsqueda contra el CATÁLOGO MAESTRO de NexoB2B (exista o no un
  // mayorista que venda el producto). Si lo tipeado es un EAN (lector de
  // código de barras), se abre directo el formulario con la ficha completa.
  useEffect(() => {
    if (!showAdd || !catQ.trim()) { setCatResults([]); return; }
    const t = setTimeout(async () => {
      const data = await api<{ productos: B2BProductoMaestro[] }>(
        `/api/catalog/maestro?termino=${encodeURIComponent(catQ.trim())}`
      );
      const productos = data.productos.slice(0, 8);
      setCatResults(productos);
      const scanned = catQ.trim();
      const matchEan = productos.find(
        (p) => p.ean === scanned ||
          p.presentaciones?.some((pr) => pr.ean_propio === scanned)
      );
      if (matchEan) {
        const opciones = buildOpciones(matchEan);
        const idx = opciones.findIndex((o) => o.ean_propio === scanned);
        setAdding({ producto: matchEan, opciones, presIdx: idx >= 0 ? idx : 0 });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [catQ, showAdd]);

  async function elegirFoto(file: File | undefined, destino: "nuevo" | "existente") {
    if (!file) return;
    setError("");
    try {
      const dataUrl = await prepararImagen(file);
      if (destino === "nuevo") { setFotoNueva(dataUrl); return; }
      if (!fotoDe) return;
      setSubiendoFoto(true);
      await api(`/api/stock/${fotoDe.product_id}/imagen`, {
        method: "PUT",
        body: JSON.stringify({ imagenUrl: dataUrl }),
      });
      setFotoDe(null);
      setOkMsg("Foto actualizada. Ya se ve en el punto de venta.");
      setTimeout(() => setOkMsg(""), 3000);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la imagen");
    } finally {
      setSubiendoFoto(false);
    }
  }

  async function quitarFoto() {
    if (!fotoDe) return;
    setError("");
    try {
      await api(`/api/stock/${fotoDe.product_id}/imagen`, {
        method: "PUT",
        body: JSON.stringify({ imagenUrl: null }),
      });
      setFotoDe(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la imagen");
    }
  }

  async function crearProductoPropio(form: FormData) {
    setError("");
    const num = (k: string) => (form.get(k) ? Number(form.get(k)) : undefined);
    try {
      await api("/api/stock/producto-propio", {
        method: "POST",
        body: JSON.stringify({
          nombre: String(form.get("nombre")),
          marca: String(form.get("marca") || "") || undefined,
          pasilloId: taxSel.pasilloId || undefined,
          pasilloNombre: taxonomia?.pasillos.find((p) => p.id === taxSel.pasilloId)?.nombre,
          rubroId: taxSel.rubroId || undefined,
          rubroNombre: taxonomia?.rubros.find((r) => r.id === taxSel.rubroId)?.nombre,
          subrubroId: taxSel.subrubroId || undefined,
          subrubroNombre: taxonomia?.subrubros.find((s) => s.id === taxSel.subrubroId)?.nombre,
          ean: String(form.get("ean") || "") || undefined,
          plu: String(form.get("plu") || "") || undefined,
          ventaPorPeso: form.get("ventaPorPeso") === "on",
          imagenUrl: fotoNueva ?? undefined,
          quantity: num("quantity") ?? 0,
          cost: num("cost"),
          salePrice: num("salePrice"),
          minStock: num("minStock"),
        }),
      });
      setShowPropio(false);
      setPorPeso(false);
      setFotoNueva(null);
      setTaxSel({ pasilloId: "", rubroId: "", subrubroId: "" });
      setOkMsg(`"${form.get("nombre")}" creado y cargado en tu stock.`);
      setTimeout(() => setOkMsg(""), 4000);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear el producto");
    }
  }

  async function addFromCatalog(form: FormData) {
    if (!adding) return;
    const { producto } = adding;
    const pres = adding.opciones[adding.presIdx];
    setError("");
    try {
      await api("/api/stock/add-from-catalog", {
        method: "POST",
        body: JSON.stringify({
          presentacionId: pres.id,
          meta: {
            productoNombre: producto.nombre,
            presentacionNombre: pres.nombre,
            ean: pres.ean_propio ?? producto.ean,
            descripcion: producto.descripcion ?? null,
            marca: producto.marca,
            pasilloId: producto.pasillo_id,
            pasilloNombre: producto.pasillo_nombre,
            rubroId: producto.rubro_id,
            rubroNombre: producto.rubro_nombre,
            subrubroId: producto.subrubro_id,
            subrubroNombre: producto.subrubro_nombre,
            imagenUrl: producto.imagen_url,
            alicuotaIva: producto.alicuota_iva != null ? Number(producto.alicuota_iva) : null,
            factor: pres.factor,
          },
          quantity: Number(form.get("qty") ?? 0),
          cost: form.get("cost") ? Number(form.get("cost")) : undefined,
          salePrice: form.get("salePrice") ? Number(form.get("salePrice")) : undefined,
          minStock: form.get("minStock") ? Number(form.get("minStock")) : undefined,
        }),
      });
      setAdding(null);
      setCatQ("");
      setOkMsg(`"${producto.nombre} — ${pres.nombre}" dado de alta en tu stock. Escaneá el siguiente…`);
      setTimeout(() => setOkMsg(""), 4000);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al agregar producto");
    }
  }

  async function saveAdjust(form: FormData) {
    if (!editing) return;
    setError("");
    try {
      await api("/api/stock/adjust", {
        method: "POST",
        body: JSON.stringify({
          productId: editing.product_id,
          quantityDelta: Number(form.get("delta") ?? 0),
          reason: String(form.get("reason") || "Ajuste manual"),
          salePrice: form.get("salePrice") ? Number(form.get("salePrice")) : undefined,
          minStock: form.get("minStock") ? Number(form.get("minStock")) : undefined,
        }),
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al ajustar");
    }
  }

  return (
    <div>
      <h1>Stock local</h1>
      <div className="toolbar">
        <input type="search" placeholder="Buscar por nombre o EAN…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Solo stock bajo
        </label>
        <button onClick={() => { setShowPropio(!showPropio); setShowAdd(false); }} className="secondary">
          + Crear producto propio
        </button>
        <button onClick={() => { setShowAdd(!showAdd); setAdding(null); setShowPropio(false); }}>
          + Agregar producto del catálogo
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {okMsg && !showAdd && <p className="badge ok" style={{ fontSize: 14 }}>{okMsg}</p>}

      {showPropio && (
        <div className="card" style={{ border: "2px solid var(--primary)" }}>
          <h2>Crear producto propio</h2>
          <p className="muted">
            Para lo que no está en el catálogo de NexoB2B: mercadería comprada por fuera,
            fraccionados (comprás el jamón en pieza y lo vendés en bandejas) o elaboración
            propia (una torta, una vianda). El producto queda solo en tu comercio.
          </p>
          <form action={crearProductoPropio}>
            <div className="toolbar" style={{ alignItems: "flex-start" }}>
              <label className="foto-slot" title="Foto para el punto de venta">
                {fotoNueva
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={fotoNueva} alt="" />
                  : <span>📷<br /><span style={{ fontSize: 11 }}>Foto</span></span>}
                <input
                  type="file" accept="image/*" capture="environment" hidden
                  onChange={(e) => elegirFoto(e.target.files?.[0], "nuevo")}
                />
              </label>
              {fotoNueva && (
                <button type="button" className="small secondary" onClick={() => setFotoNueva(null)}>
                  Quitar foto
                </button>
              )}
            </div>
            <div className="toolbar">
              <input name="nombre" placeholder="Nombre del producto *" required style={{ flex: 2, minWidth: 240 }} autoFocus />
              <input name="marca" placeholder="Marca" style={{ width: 140 }} />
            </div>
            <div className="toolbar">
              <select
                value={taxSel.pasilloId}
                onChange={(e) => setTaxSel({ pasilloId: e.target.value, rubroId: "", subrubroId: "" })}
              >
                <option value="">Pasillo…</option>
                {(taxonomia?.pasillos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <select
                value={taxSel.rubroId}
                onChange={(e) => setTaxSel({ ...taxSel, rubroId: e.target.value, subrubroId: "" })}
                disabled={!taxSel.pasilloId}
              >
                <option value="">Rubro…</option>
                {(taxonomia?.rubros ?? [])
                  .filter((r) => r.pasillo_id === taxSel.pasilloId)
                  .map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
              <select
                value={taxSel.subrubroId}
                onChange={(e) => setTaxSel({ ...taxSel, subrubroId: e.target.value })}
                disabled={!taxSel.rubroId}
              >
                <option value="">Subrubro…</option>
                {(taxonomia?.subrubros ?? [])
                  .filter((s) => s.rubro_id === taxSel.rubroId)
                  .map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
              <span className="muted">
                Son los mismos rubros de NexoB2B: así el producto aparece en los chips del punto de venta.
              </span>
            </div>
            <div className="toolbar">
              <label className="switch-row" style={{ padding: 0 }}>
                <input
                  type="checkbox" name="ventaPorPeso"
                  checked={porPeso}
                  onChange={(e) => setPorPeso(e.target.checked)}
                />
                <span>Se vende <strong>por peso</strong> (el precio es por kilo)</span>
              </label>
            </div>
            <div className="toolbar">
              <input name="ean" placeholder="Código de barras propio (opcional)" style={{ width: 240 }} />
              <input
                name="plu"
                placeholder={porPeso ? "Código de balanza (PLU) *" : "Código de balanza (PLU)"}
                style={{ width: 220 }}
              />
            </div>
            <div className="toolbar">
              <input name="quantity" type="number" step="any" min="0" placeholder={porPeso ? "Stock inicial (kg)" : "Stock inicial"} style={{ width: 160 }} />
              <input name="cost" type="number" step="0.01" min="0" placeholder={porPeso ? "Costo por kg" : "Costo unitario"} style={{ width: 150 }} />
              <input name="salePrice" type="number" step="0.01" min="0.01" required placeholder={porPeso ? "Precio por kg *" : "Precio de venta *"} style={{ width: 160 }} />
              <input name="minStock" type="number" step="any" min="0" placeholder="Stock mínimo" style={{ width: 130 }} />
            </div>
            <div className="toolbar">
              <button type="submit">Crear producto</button>
              <button type="button" className="secondary" onClick={() => setShowPropio(false)}>Cancelar</button>
              {porPeso && (
                <span className="muted">
                  El PLU es el número que cargás en la balanza; el POS lo lee de la etiqueta
                  junto con el peso. Configuralo en <a href="/configuracion">Configuración</a>.
                </span>
              )}
            </div>
          </form>
        </div>
      )}

      {showAdd && (
        <div className="card" style={{ border: "2px solid var(--primary)" }}>
          <h2>Agregar producto al stock</h2>
          {okMsg && <p className="badge ok" style={{ fontSize: 14 }}>{okMsg}</p>}
          {!adding ? (
            <>
              <input
                type="search"
                placeholder="📷 Escaneá el código de barras, o buscá por nombre o marca…"
                value={catQ}
                onChange={(e) => setCatQ(e.target.value)}
                style={{ width: "100%", fontSize: 16, padding: 12 }}
                autoFocus
              />
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Si el código existe en NexoB2B, el producto se completa solo: vos solo ponés precio y cantidad.
              </p>
              {catResults.length > 0 && (
                <table style={{ marginTop: 8 }}>
                  <tbody>
                    {catResults.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => setAdding({ producto: p, opciones: buildOpciones(p), presIdx: 0 })}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={{ width: 44 }}>
                          {p.imagen_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={p.imagen_url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} />
                            : <span style={{ fontSize: 22 }}>📦</span>}
                        </td>
                        <td className="muted">{p.ean}</td>
                        <td><strong>{p.nombre}</strong></td>
                        <td className="muted">{p.marca}</td>
                        <td className="muted">{p.rubro_nombre}</td>
                        <td><button className="small">Elegir</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {catQ.trim() && catResults.length === 0 && (
                <p className="muted" style={{ marginTop: 8 }}>
                  Sin resultados en el catálogo de NexoB2B para «{catQ}».
                </p>
              )}
            </>
          ) : (
            <div className="row">
              {/* Ficha del producto, completada desde NexoB2B */}
              <div className="card" style={{ maxWidth: 380 }}>
                <div className="toolbar">
                  {adding.producto.imagen_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={adding.producto.imagen_url} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10 }} />
                    : <span style={{ fontSize: 44 }}>📦</span>}
                  <div>
                    <strong>{adding.producto.nombre}</strong>
                    <div className="muted">{adding.producto.marca}</div>
                    <div className="muted">
                      {[adding.producto.pasillo_nombre, adding.producto.rubro_nombre, adding.producto.subrubro_nombre]
                        .filter(Boolean).join(" › ")}
                    </div>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 12 }}>
                  {(adding.producto.descripcion ?? "").slice(0, 180)}
                  {(adding.producto.descripcion?.length ?? 0) > 180 && "…"}
                </p>
                <p className="muted">
                  EAN: {adding.opciones[adding.presIdx].ean_propio ?? adding.producto.ean ?? "—"}
                  {adding.producto.alicuota_iva != null && ` · IVA ${adding.producto.alicuota_iva}%`}
                </p>
              </div>

              <div style={{ flex: 1, minWidth: 300 }}>
                <div className="toolbar">
                  <label>Presentación</label>
                  <select
                    value={adding.presIdx}
                    onChange={(e) => setAdding({ ...adding, presIdx: Number(e.target.value) })}
                  >
                    {adding.opciones.map((o, idx) => (
                      <option key={o.id} value={idx}>
                        {o.nombre}
                        {o.factor > 1 ? ` (x${o.factor})` : ""}
                        {o.ean_propio ? ` · ${o.ean_propio}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <form action={addFromCatalog} className="toolbar">
                  <input name="qty" type="number" step="any" min="0" placeholder="Cantidad *" required style={{ width: 120 }} autoFocus />
                  <input name="cost" type="number" step="0.01" min="0" placeholder="Costo unitario" style={{ width: 150 }} />
                  <input name="salePrice" type="number" step="0.01" min="0.01" placeholder="Precio de venta *" required style={{ width: 150 }} />
                  <input name="minStock" type="number" step="any" min="0" placeholder="Stock mínimo" style={{ width: 120 }} />
                  <button type="submit">Dar de alta</button>
                  <button type="button" className="secondary" onClick={() => { setAdding(null); setCatQ(""); }}>Volver</button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th></th><th>EAN</th><th>Producto</th><th className="num">Cantidad</th>
              <th className="num">Costo</th><th className="num">Precio venta</th>
              <th className="num">Mínimo</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td style={{ width: 52 }}>
                  <button className="foto-mini" onClick={() => setFotoDe(s)} title="Cambiar la foto del punto de venta">
                    {s.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={s.image_url} alt="" />
                      : <span>📷</span>}
                  </button>
                </td>
                <td className="muted">
                  {s.ean ?? "—"}
                  {s.plu && <div style={{ fontSize: 11 }}>PLU {s.plu}</div>}
                </td>
                <td>
                  {s.name}
                  {s.origen === "propio" && <span className="badge info" style={{ marginLeft: 6 }}>propio</span>}
                  {s.venta_por_peso && <span className="badge warn" style={{ marginLeft: 4 }}>por peso</span>}
                </td>
                <td className="num">
                  <span className={`badge ${s.low_stock ? "err" : "ok"}`}>
                    {Number(s.quantity).toLocaleString("es-AR", { maximumFractionDigits: 3 })}
                    {s.venta_por_peso ? " kg" : ""}
                  </span>
                </td>
                <td className="num">{s.cost ? money(s.cost) : "—"}</td>
                <td className="num">{s.sale_price ? money(s.sale_price) : <span className="badge warn">sin precio</span>}</td>
                <td className="num">{Number(s.min_stock)}</td>
                <td><button className="small secondary" onClick={() => setEditing(s)}>Ajustar</button></td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} className="muted">Sin stock cargado. Recibí una compra, agregá un producto del catálogo o creá uno propio.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="card" style={{ border: "2px solid var(--primary)" }}>
          <h2>Ajustar: {editing.name}</h2>
          <form action={saveAdjust} className="toolbar">
            <input name="delta" type="number" step="any" placeholder="Δ cantidad (+/-)" style={{ width: 140 }} />
            <input name="salePrice" type="number" step="0.01" placeholder="Precio venta" defaultValue={editing.sale_price ?? ""} style={{ width: 130 }} />
            <input name="minStock" type="number" step="any" placeholder="Stock mínimo" defaultValue={Number(editing.min_stock) || ""} style={{ width: 130 }} />
            <input name="reason" type="text" placeholder="Motivo del ajuste" required />
            <button type="submit">Guardar</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancelar</button>
          </form>
        </div>
      )}

      {fotoDe && (
        <div className="modal-backdrop" onClick={() => setFotoDe(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2>Foto de {fotoDe.name}</h2>
            <p className="muted">
              Es la que se ve en los botones del punto de venta. Desde una tablet o celular
              podés sacarla con la cámara en el momento.
            </p>
            <div style={{ textAlign: "center", margin: "12px 0" }}>
              {fotoDe.image_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={fotoDe.image_url} alt="" style={{ width: 160, height: 160, objectFit: "cover", borderRadius: 12 }} />
                : <div className="foto-slot" style={{ width: 160, height: 160, margin: "0 auto" }}><span>Sin foto</span></div>}
            </div>
            <div className="toolbar" style={{ justifyContent: "center" }}>
              <label className="btn-file">
                {subiendoFoto ? "Subiendo…" : "📷 Elegir o sacar foto"}
                <input
                  type="file" accept="image/*" capture="environment" hidden
                  disabled={subiendoFoto}
                  onChange={(e) => elegirFoto(e.target.files?.[0], "existente")}
                />
              </label>
              {fotoDe.image_url && (
                <button className="secondary" onClick={quitarFoto}>Quitar</button>
              )}
              <button className="secondary" onClick={() => setFotoDe(null)}>Cerrar</button>
            </div>
            {fotoDe.imagen_propia === false && fotoDe.image_url && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Esta foto viene del catálogo de NexoB2B. Si subís una propia, solo la vas a
                ver vos.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Últimos movimientos</h2>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th className="num">Cantidad</th><th>Referencia</th></tr>
          </thead>
          <tbody>
            {movements.slice(0, 30).map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.created_at).toLocaleString("es-AR")}</td>
                <td>{m.name}</td>
                <td>{MOVE_LABEL[m.type] ?? m.type}</td>
                <td className="num" style={{ color: Number(m.quantity) < 0 ? "var(--danger)" : "var(--success)" }}>
                  {Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)}
                </td>
                <td className="muted">{m.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

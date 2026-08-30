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
import type { B2BProductoMaestro, B2BPresentacionMaestra, B2BTaxonomia, B2BProducto, B2BListing, B2BPresentacion } from "@/lib/b2b-types";
import { addToCart } from "@/lib/cart";
import { prepararImagen } from "@/lib/imagen";
import { Foto } from "@/lib/foto";

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

export default function ProductosPage() {
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [items, setItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [catQ, setCatQ] = useState("");
  const [catResults, setCatResults] = useState<B2BProductoMaestro[]>([]);
  const [catFiltros, setCatFiltros] = useState({ pasilloId: "", rubroId: "", subrubroId: "", marca: "" });
  const [buscando, setBuscando] = useState(false);
  const [adding, setAdding] = useState<AltaEnCurso | null>(null);
  const [okMsg, setOkMsg] = useState("");
  const [showPropio, setShowPropio] = useState(false);
  const [porPeso, setPorPeso] = useState(false);
  const [taxonomia, setTaxonomia] = useState<B2BTaxonomia | null>(null);
  const [taxSel, setTaxSel] = useState({ pasilloId: "", rubroId: "", subrubroId: "" });
  const [fotoNueva, setFotoNueva] = useState<string | null>(null);
  const [fotoDe, setFotoDe] = useState<StockItem | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [editandoCampo, setEditandoCampo] = useState<{ id: number; campo: string } | null>(null);
  const [comprando, setComprando] = useState<{ item: StockItem; productos: B2BProducto[] | null } | null>(null);

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
    if (!showAdd) { setCatResults([]); return; }
    const termino = catQ.trim();
    if (!termino) { setCatResults([]); setBuscando(false); return; }

    setBuscando(true);
    // Cada búsqueda cancela la anterior: tipeando rápido salen varias en
    // paralelo y la más vieja puede contestar última, pisando los resultados
    // buenos con los de un término que ya no es el que está en pantalla.
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ termino });
        if (catFiltros.pasilloId) params.set("pasillo_id", catFiltros.pasilloId);
        if (catFiltros.rubroId) params.set("rubro_id", catFiltros.rubroId);
        if (catFiltros.subrubroId) params.set("subrubro_id", catFiltros.subrubroId);
        if (catFiltros.marca.trim()) params.set("marca", catFiltros.marca.trim());

        const data = await api<{ productos: B2BProductoMaestro[]; termino: string }>(
          `/api/catalog/maestro?${params}`,
          { signal: ctrl.signal }
        );
        // Doble red: si igual llegó una respuesta de otro término, se descarta
        if (data.termino !== termino) return;

        const productos = data.productos.slice(0, 12);
        setCatResults(productos);
        const matchEan = productos.find(
          (p) => p.ean === termino || p.presentaciones?.some((pr) => pr.ean_propio === termino)
        );
        if (matchEan) {
          const opciones = buildOpciones(matchEan);
          const idx = opciones.findIndex((o) => o.ean_propio === termino);
          setAdding({ producto: matchEan, opciones, presIdx: idx >= 0 ? idx : 0 });
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") console.error(err);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [catQ, showAdd, catFiltros]);

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

  /** Ajuste de inventario: mueve cantidades y por eso pide el motivo. */
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
        }),
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al ajustar");
    }
  }

  /**
   * Cambio de precio, costo o mínimo: se guarda al toque, sin pedir motivo.
   * Es la operación más frecuente del día y no es un ajuste de inventario.
   */
  async function guardarPrecio(item: StockItem, campo: "salePrice" | "cost" | "minStock", valor: string) {
    const num = valor.trim() === "" ? null : Number(valor.replace(",", "."));
    if (num === null || isNaN(num) || num < 0) { setEditandoCampo(null); return; }

    const actual = campo === "salePrice" ? item.sale_price
      : campo === "cost" ? item.cost : item.min_stock;
    if (Number(actual ?? -1) === num) { setEditandoCampo(null); return; }

    // Se refleja en la tabla antes de que conteste el servidor
    setItems((prev) => prev.map((i) => i.product_id !== item.product_id ? i : {
      ...i,
      sale_price: campo === "salePrice" ? String(num) : i.sale_price,
      cost: campo === "cost" ? String(num) : i.cost,
      min_stock: campo === "minStock" ? String(num) : i.min_stock,
    }));
    setEditandoCampo(null);
    try {
      await api(`/api/stock/${item.product_id}/precio`, {
        method: "PUT",
        body: JSON.stringify({ [campo]: num }),
      });
      setOkMsg("Guardado.");
      setTimeout(() => setOkMsg(""), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
      load();
    }
  }

  /** Ofertas de mayoristas para reponer este producto. */
  async function abrirCompra(item: StockItem) {
    setError("");
    setComprando({ item, productos: null });
    try {
      const termino = item.ean || item.name.split(" — ")[0];
      const data = await api<{ productos: B2BProducto[] }>(
        `/api/catalog?q=${encodeURIComponent(termino)}`
      );
      setComprando({ item, productos: data.productos });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron traer las ofertas");
      setComprando(null);
    }
  }

  return (
    <div>
      <h1>Productos</h1>
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

              {/* Filtros para acotar cuando el nombre trae muchos resultados */}
              <div className="toolbar" style={{ marginTop: 8 }}>
                <select
                  value={catFiltros.pasilloId}
                  onChange={(e) => setCatFiltros({ ...catFiltros, pasilloId: e.target.value, rubroId: "", subrubroId: "" })}
                >
                  <option value="">Todos los pasillos</option>
                  {(taxonomia?.pasillos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <select
                  value={catFiltros.rubroId}
                  onChange={(e) => setCatFiltros({ ...catFiltros, rubroId: e.target.value, subrubroId: "" })}
                >
                  <option value="">Todos los rubros</option>
                  {(taxonomia?.rubros ?? [])
                    .filter((r) => !catFiltros.pasilloId || r.pasillo_id === catFiltros.pasilloId)
                    .map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
                <select
                  value={catFiltros.subrubroId}
                  onChange={(e) => setCatFiltros({ ...catFiltros, subrubroId: e.target.value })}
                >
                  <option value="">Todos los subrubros</option>
                  {(taxonomia?.subrubros ?? [])
                    .filter((s) => !catFiltros.rubroId || s.rubro_id === catFiltros.rubroId)
                    .map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
                <input
                  placeholder="Marca"
                  value={catFiltros.marca}
                  onChange={(e) => setCatFiltros({ ...catFiltros, marca: e.target.value })}
                  style={{ width: 150 }}
                />
                {(catFiltros.pasilloId || catFiltros.rubroId || catFiltros.subrubroId || catFiltros.marca) && (
                  <button
                    className="small secondary"
                    onClick={() => setCatFiltros({ pasilloId: "", rubroId: "", subrubroId: "", marca: "" })}
                  >
                    Limpiar filtros
                  </button>
                )}
                {buscando && <span className="muted">Buscando…</span>}
              </div>

              {catResults.length > 0 && (
                <table style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th></th><th>EAN</th><th>Producto</th><th>Marca</th><th>Rubro</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {catResults.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => setAdding({ producto: p, opciones: buildOpciones(p), presIdx: 0 })}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={{ width: 44 }}>
                          <Foto
                            src={p.imagen_url}
                            style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }}
                            fallbackStyle={{ fontSize: 22 }}
                          />
                        </td>
                        <td className="muted">{p.ean ?? "—"}</td>
                        <td><strong>{p.nombre}</strong></td>
                        <td className="muted">{p.marca ?? "—"}</td>
                        <td className="muted">
                          {p.rubro_nombre ?? "—"}
                          {p.subrubro_nombre && <div style={{ fontSize: 11 }}>{p.subrubro_nombre}</div>}
                        </td>
                        <td><button className="small">Elegir</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {catQ.trim() && !buscando && catResults.length === 0 && (
                <p className="muted" style={{ marginTop: 8 }}>
                  Sin resultados en el catálogo de NexoB2B para «{catQ}»
                  {(catFiltros.pasilloId || catFiltros.rubroId || catFiltros.subrubroId || catFiltros.marca)
                    && " con los filtros puestos"}.
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
                <CeldaEditable
                  item={s} campo="cost" valor={s.cost}
                  editando={editandoCampo?.id === s.product_id && editandoCampo.campo === "cost"}
                  onEditar={() => setEditandoCampo({ id: s.product_id, campo: "cost" })}
                  onGuardar={guardarPrecio} onCancelar={() => setEditandoCampo(null)}
                />
                <CeldaEditable
                  item={s} campo="salePrice" valor={s.sale_price} destacado
                  editando={editandoCampo?.id === s.product_id && editandoCampo.campo === "salePrice"}
                  onEditar={() => setEditandoCampo({ id: s.product_id, campo: "salePrice" })}
                  onGuardar={guardarPrecio} onCancelar={() => setEditandoCampo(null)}
                />
                <CeldaEditable
                  item={s} campo="minStock" valor={s.min_stock} entero
                  editando={editandoCampo?.id === s.product_id && editandoCampo.campo === "minStock"}
                  onEditar={() => setEditandoCampo({ id: s.product_id, campo: "minStock" })}
                  onGuardar={guardarPrecio} onCancelar={() => setEditandoCampo(null)}
                />
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="small secondary" onClick={() => setEditing(s)} title="Corregir la cantidad en góndola">
                    Ajustar stock
                  </button>{" "}
                  <button className="small" onClick={() => abrirCompra(s)} title="Ver ofertas de mayoristas para reponer">
                    Comprar
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} className="muted">Todavía no tenés productos. Agregá uno del catálogo, creá uno propio o recibí una compra.</td></tr>
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

      {comprando && (
        <ModalCompra
          item={comprando.item}
          productos={comprando.productos}
          onCerrar={() => setComprando(null)}
          onAgregado={(nombre) => {
            setComprando(null);
            setOkMsg(`"${nombre}" agregado al carrito de compras.`);
            setTimeout(() => setOkMsg(""), 4000);
          }}
        />
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

/**
 * Celda de precio/costo/mínimo editable en el lugar: un clic la convierte en
 * input y guarda al salir o con Enter. Cambiar precios es la tarea más
 * repetida del día, no tiene por qué abrir un formulario aparte.
 */
function CeldaEditable({
  item, campo, valor, editando, onEditar, onGuardar, onCancelar, destacado, entero,
}: {
  item: StockItem;
  campo: "salePrice" | "cost" | "minStock";
  valor: string | null;
  editando: boolean;
  onEditar: () => void;
  onGuardar: (item: StockItem, campo: "salePrice" | "cost" | "minStock", valor: string) => void;
  onCancelar: () => void;
  destacado?: boolean;
  entero?: boolean;
}) {
  if (editando) {
    return (
      <td className="num">
        <input
          type="number" step={entero ? "any" : "0.01"} min="0"
          defaultValue={valor ?? ""}
          autoFocus
          style={{ width: 110, textAlign: "right" }}
          onBlur={(e) => onGuardar(item, campo, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") onCancelar();
          }}
        />
      </td>
    );
  }
  const vacio = valor === null || valor === "";
  return (
    <td className="num celda-editable" onClick={onEditar} title="Clic para editar">
      {vacio
        ? (destacado ? <span className="badge warn">sin precio</span> : "—")
        : entero
          ? Number(valor).toLocaleString("es-AR", { maximumFractionDigits: 3 })
          : money(valor)}
    </td>
  );
}

/** Ofertas de mayoristas para reponer un producto del stock. */
function ModalCompra({
  item, productos, onCerrar, onAgregado,
}: {
  item: StockItem;
  productos: B2BProducto[] | null;
  onCerrar: () => void;
  onAgregado: (nombre: string) => void;
}) {
  function agregar(producto: B2BProducto, listing: B2BListing, pres: B2BPresentacion) {
    addToCart({
      presentacionId: pres.id,
      presentacionMaestraId: pres.presentacion_id,
      mayoristaId: listing.mayorista_id,
      mayoristaNombre: listing.mayorista_nombre,
      cantidad: 1,
      precio: pres.precio,
      meta: {
        productoNombre: producto.nombre,
        presentacionNombre: pres.nombre,
        ean: pres.ean_propio ?? producto.ean,
        descripcion: producto.descripcion ?? null,
        marca: producto.marca,
        pasilloId: producto.pasillo_id, pasilloNombre: producto.pasillo_nombre,
        rubroId: producto.rubro_id, rubroNombre: producto.rubro_nombre,
        subrubroId: producto.subrubro_id, subrubroNombre: producto.subrubro_nombre,
        imagenUrl: producto.imagen_url,
        alicuotaIva: producto.alicuota_iva,
        factor: pres.factor,
      },
    });
    onAgregado(`${producto.nombre} — ${pres.nombre}`);
  }

  const conAlta = (productos ?? []).flatMap((p) =>
    p.mayoristas.filter((m) => m.tiene_alta).map((m) => ({ producto: p, listing: m }))
  );

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reponer: {item.name}</h2>
        {productos === null ? (
          <p className="muted">Buscando ofertas en NexoB2B…</p>
        ) : conAlta.length === 0 ? (
          <p className="muted">
            Ningún mayorista con el que tengas alta vende este producto por NexoB2B.
            Podés pedir el alta en <a href="/mayoristas">Mayoristas</a> o comprarlo por fuera.
          </p>
        ) : (
          conAlta.map(({ producto, listing }) => (
            <div key={listing.listing_id} style={{ marginBottom: 12 }}>
              <strong>{listing.mayorista_nombre}</strong>
              <table>
                <tbody>
                  {listing.presentaciones.map((pres) => (
                    <tr key={pres.id}>
                      <td>{pres.nombre}{pres.factor > 1 && <span className="muted"> (x{pres.factor})</span>}</td>
                      <td className="num">{money(pres.precio)}</td>
                      <td className="num muted">{pres.stock ?? "disponible"}</td>
                      <td>
                        <button className="small" onClick={() => agregar(producto, listing, pres)}>
                          Agregar al carrito
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
        <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <a href="/compras"><button className="secondary">Ir al carrito</button></a>
          <button className="secondary" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

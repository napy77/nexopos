"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money } from "@/lib/api";

interface StockItem {
  id: number; product_id: number; name: string; ean: string; category: string | null;
  unit: string; quantity: string; cost: string | null; sale_price: string | null;
  min_stock: string; low_stock: boolean;
}
interface Movement {
  id: number; name: string; type: string; quantity: string; reference: string | null; created_at: string;
}
import type { B2BProducto, B2BPresentacion } from "@/lib/b2b-types";

interface PresOpcion { pres: B2BPresentacion; mayorista: string | null }
interface AltaEnCurso { producto: B2BProducto; opciones: PresOpcion[]; presIdx: number }

/**
 * Presentaciones disponibles de un producto del catálogo. Si ningún
 * mayorista lo lista, se ofrece una presentación "Unidad" basada en el
 * producto maestro (alcanza para venderlo en el POS).
 */
function buildOpciones(producto: B2BProducto): PresOpcion[] {
  const opciones: PresOpcion[] = producto.mayoristas.flatMap((listing) =>
    listing.presentaciones.map((pres) => ({ pres, mayorista: listing.mayorista_nombre }))
  );
  if (opciones.length === 0) {
    opciones.push({
      mayorista: null,
      pres: {
        id: producto.id, // identidad = producto maestro
        nombre: producto.unidad_base ?? "Unidad",
        factor: 1, ean_propio: null, precio: 0, precio_lista: null, stock: null,
      },
    });
  }
  return opciones;
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
  const [catResults, setCatResults] = useState<B2BProducto[]>([]);
  const [adding, setAdding] = useState<AltaEnCurso | null>(null);
  const [okMsg, setOkMsg] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q, lowOnly: String(lowOnly) });
    setItems(await api<StockItem[]>(`/api/stock?${params}`));
  }, [q, lowOnly]);

  useEffect(() => { load().catch(console.error); }, [load]);
  useEffect(() => {
    api<Movement[]>("/api/stock/movements").then(setMovements).catch(console.error);
  }, [items]);

  // Autocompletar contra el catálogo vivo de NexoB2B. Si lo tipeado
  // coincide EXACTO con un EAN (lector de código de barras), se abre
  // directo el formulario de alta con todos los datos del producto.
  useEffect(() => {
    if (!showAdd || !catQ.trim()) { setCatResults([]); return; }
    const t = setTimeout(async () => {
      // incluir_sin_mayorista: acá solo importa la ficha del producto,
      // aunque nadie lo venda en NexoB2B (se compró por fuera)
      const data = await api<{ productos: B2BProducto[] }>(
        `/api/catalog?q=${encodeURIComponent(catQ.trim())}&incluir_sin_mayorista=true`
      );
      const productos = data.productos.slice(0, 8);
      setCatResults(productos);
      const scanned = catQ.trim();
      const matchEan = productos.find(
        (p) => p.ean === scanned ||
          p.mayoristas.some((m) => m.presentaciones.some((pr) => pr.ean_propio === scanned))
      );
      if (matchEan) {
        const opciones = buildOpciones(matchEan);
        const idx = opciones.findIndex((o) => o.pres.ean_propio === scanned);
        setAdding({ producto: matchEan, opciones, presIdx: idx >= 0 ? idx : 0 });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [catQ, showAdd]);

  async function addFromCatalog(form: FormData) {
    if (!adding) return;
    const { producto } = adding;
    const { pres } = adding.opciones[adding.presIdx];
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
            alicuotaIva: producto.alicuota_iva,
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
        <button onClick={() => { setShowAdd(!showAdd); setAdding(null); }}>
          + Agregar producto del catálogo
        </button>
      </div>
      {error && <p className="error">{error}</p>}

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
                  EAN: {adding.opciones[adding.presIdx].pres.ean_propio ?? adding.producto.ean ?? "—"}
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
                      <option key={o.pres.id} value={idx}>
                        {o.pres.nombre}
                        {o.pres.factor > 1 ? ` (x${o.pres.factor})` : ""}
                        {o.mayorista ? ` — ${o.mayorista}` : ""}
                        {o.pres.precio ? ` · cuesta ${money(o.pres.precio)}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <form action={addFromCatalog} className="toolbar">
                  <input name="qty" type="number" step="any" min="0" placeholder="Cantidad *" required style={{ width: 120 }} autoFocus />
                  <input
                    name="cost" type="number" step="0.01" min="0"
                    placeholder={adding.opciones[adding.presIdx].pres.precio ? `Costo (sug. ${money(adding.opciones[adding.presIdx].pres.precio)})` : "Costo unitario"}
                    style={{ width: 170 }}
                  />
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
              <th>EAN</th><th>Producto</th><th className="num">Cantidad</th>
              <th className="num">Costo</th><th className="num">Precio venta</th>
              <th className="num">Mínimo</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td className="muted">{s.ean}</td>
                <td>{s.name}</td>
                <td className="num">
                  <span className={`badge ${s.low_stock ? "err" : "ok"}`}>{Number(s.quantity)}</span>
                </td>
                <td className="num">{s.cost ? money(s.cost) : "—"}</td>
                <td className="num">{s.sale_price ? money(s.sale_price) : <span className="badge warn">sin precio</span>}</td>
                <td className="num">{Number(s.min_stock)}</td>
                <td><button className="small secondary" onClick={() => setEditing(s)}>Ajustar</button></td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="muted">Sin stock cargado. Recibí una compra o hacé un ajuste manual desde el catálogo.</td></tr>
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

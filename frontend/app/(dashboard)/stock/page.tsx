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
import type { B2BProducto, B2BListing, B2BPresentacion } from "@/lib/b2b-types";

interface PresentacionElegida { producto: B2BProducto; listing: B2BListing; pres: B2BPresentacion }

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
  const [adding, setAdding] = useState<PresentacionElegida | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q, lowOnly: String(lowOnly) });
    setItems(await api<StockItem[]>(`/api/stock?${params}`));
  }, [q, lowOnly]);

  useEffect(() => { load().catch(console.error); }, [load]);
  useEffect(() => {
    api<Movement[]>("/api/stock/movements").then(setMovements).catch(console.error);
  }, [items]);

  // Autocompletar contra el catálogo vivo de NexoB2B
  useEffect(() => {
    if (!showAdd || !catQ.trim()) { setCatResults([]); return; }
    const t = setTimeout(async () => {
      const data = await api<{ productos: B2BProducto[] }>(
        `/api/catalog?q=${encodeURIComponent(catQ)}`
      );
      setCatResults(data.productos.slice(0, 8));
    }, 300);
    return () => clearTimeout(t);
  }, [catQ, showAdd]);

  async function addFromCatalog(form: FormData) {
    if (!adding) return;
    setError("");
    try {
      await api("/api/stock/add-from-catalog", {
        method: "POST",
        body: JSON.stringify({
          presentacionId: adding.pres.id,
          meta: {
            productoNombre: adding.producto.nombre,
            presentacionNombre: adding.pres.nombre,
            ean: adding.pres.ean_propio ?? adding.producto.ean,
            marca: adding.producto.marca,
            pasilloId: adding.producto.pasillo_id,
            pasilloNombre: adding.producto.pasillo_nombre,
            rubroId: adding.producto.rubro_id,
            rubroNombre: adding.producto.rubro_nombre,
            subrubroId: adding.producto.subrubro_id,
            subrubroNombre: adding.producto.subrubro_nombre,
            imagenUrl: adding.producto.imagen_url,
            alicuotaIva: adding.producto.alicuota_iva,
            factor: adding.pres.factor,
          },
          quantity: Number(form.get("qty") ?? 0),
          cost: form.get("cost") ? Number(form.get("cost")) : undefined,
          salePrice: form.get("salePrice") ? Number(form.get("salePrice")) : undefined,
          minStock: form.get("minStock") ? Number(form.get("minStock")) : undefined,
        }),
      });
      setAdding(null);
      setCatQ("");
      setShowAdd(false);
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
          {!adding ? (
            <>
              <input
                type="search"
                placeholder="Buscá en el catálogo por nombre, marca o EAN…"
                value={catQ}
                onChange={(e) => setCatQ(e.target.value)}
                style={{ width: "100%" }}
                autoFocus
              />
              {catResults.length > 0 && (
                <table style={{ marginTop: 8 }}>
                  <tbody>
                    {catResults.flatMap((p) =>
                      p.mayoristas.slice(0, 1).flatMap((listing) =>
                        listing.presentaciones.map((pres) => (
                          <tr
                            key={pres.id}
                            onClick={() => setAdding({ producto: p, listing, pres })}
                            style={{ cursor: "pointer" }}
                          >
                            <td className="muted">{pres.ean_propio ?? p.ean}</td>
                            <td>{p.nombre} — <strong>{pres.nombre}</strong></td>
                            <td className="muted">{p.marca}</td>
                            <td><button className="small">Elegir</button></td>
                          </tr>
                        ))
                      )
                    )}
                  </tbody>
                </table>
              )}
              {catQ.trim() && catResults.length === 0 && (
                <p className="muted" style={{ marginTop: 8 }}>Sin resultados en el catálogo.</p>
              )}
            </>
          ) : (
            <>
              <p>
                <strong>{adding.producto.nombre} — {adding.pres.nombre}</strong>{" "}
                <span className="muted">({adding.pres.ean_propio ?? adding.producto.ean})</span>
              </p>
              <form action={addFromCatalog} className="toolbar">
                <input name="qty" type="number" step="any" min="0" placeholder="Cantidad inicial *" required style={{ width: 140 }} autoFocus />
                <input name="cost" type="number" step="0.01" min="0" placeholder="Costo unitario" style={{ width: 130 }} />
                <input name="salePrice" type="number" step="0.01" min="0.01" placeholder="Precio de venta" style={{ width: 140 }} />
                <input name="minStock" type="number" step="any" min="0" placeholder="Stock mínimo" style={{ width: 120 }} />
                <button type="submit">Agregar</button>
                <button type="button" className="secondary" onClick={() => setAdding(null)}>Volver</button>
              </form>
            </>
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

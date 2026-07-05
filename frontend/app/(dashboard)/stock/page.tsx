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

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q, lowOnly: String(lowOnly) });
    setItems(await api<StockItem[]>(`/api/stock?${params}`));
  }, [q, lowOnly]);

  useEffect(() => { load().catch(console.error); }, [load]);
  useEffect(() => {
    api<Movement[]>("/api/stock/movements").then(setMovements).catch(console.error);
  }, [items]);

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
      </div>
      {error && <p className="error">{error}</p>}

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

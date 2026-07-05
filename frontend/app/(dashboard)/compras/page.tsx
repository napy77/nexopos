"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import type { CartLine } from "../catalogo/page";

interface Order {
  id: number; wholesaler_name: string; status: string; total: string;
  nexob2b_order_id: string | null; created_at: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: "Borrador", cls: "info" },
  confirmed: { label: "Confirmada", cls: "warn" },
  received: { label: "Recibida", cls: "ok" },
  cancelled: { label: "Cancelada", cls: "err" },
};

export default function ComprasPage() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOrders = useCallback(() => {
    api<Order[]>("/api/purchases").then(setOrders).catch(console.error);
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem("nexopos_purchase_cart");
    if (raw) setCart(JSON.parse(raw));
    loadOrders();
  }, [loadOrders]);

  function saveCart(next: CartLine[]) {
    setCart(next);
    localStorage.setItem("nexopos_purchase_cart", JSON.stringify(next));
  }

  function setQty(idx: number, qty: number) {
    const next = [...cart];
    next[idx].quantity = qty;
    saveCart(next);
  }

  // Una orden por mayorista: agrupamos el carrito
  const byWholesaler = cart.reduce<Record<string, CartLine[]>>((acc, l) => {
    (acc[l.wholesalerId] ??= []).push(l);
    return acc;
  }, {});

  async function confirmOrder(wholesalerId: string, lines: CartLine[]) {
    setError("");
    setBusy(true);
    try {
      await api("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          wholesalerId,
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        }),
      });
      saveCart(cart.filter((l) => l.wholesalerId !== wholesalerId));
      loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al confirmar");
    } finally {
      setBusy(false);
    }
  }

  async function receive(orderId: number) {
    setError("");
    try {
      await api(`/api/purchases/${orderId}/receive`, { method: "POST" });
      loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al recibir");
    }
  }

  return (
    <div>
      <h1>Compras a mayoristas</h1>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>Carrito de compra</h2>
        {cart.length === 0 && (
          <p className="muted">Carrito vacío. Agregá productos desde el Catálogo B2B.</p>
        )}
        {Object.entries(byWholesaler).map(([wid, lines]) => {
          const total = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
          return (
            <div key={wid} style={{ marginBottom: 16 }}>
              <h2>{lines[0].wholesalerName}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Producto</th><th className="num">Cantidad</th>
                    <th className="num">Precio unit.</th><th className="num">Subtotal</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const idx = cart.indexOf(l);
                    return (
                      <tr key={`${l.productId}-${l.wholesalerId}`}>
                        <td>{l.name}</td>
                        <td className="num">
                          <input
                            type="number" min={l.minQty} value={l.quantity}
                            style={{ width: 80, textAlign: "right" }}
                            onChange={(e) => setQty(idx, Number(e.target.value))}
                          />
                          <span className="muted"> (mín. {l.minQty})</span>
                        </td>
                        <td className="num">{money(l.unitPrice)}</td>
                        <td className="num">{money(l.quantity * l.unitPrice)}</td>
                        <td>
                          <button className="small danger" onClick={() => saveCart(cart.filter((c) => c !== l))}>
                            Quitar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="toolbar" style={{ marginTop: 8, justifyContent: "flex-end" }}>
                <strong>Total: {money(total)}</strong>
                <button disabled={busy} onClick={() => confirmOrder(wid, lines)}>
                  Confirmar orden
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Historial de compras</h2>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Mayorista</th><th>Estado</th><th className="num">Total</th>
              <th>Orden NexoB2B</th><th>Fecha</th><th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const st = STATUS_LABEL[o.status] ?? { label: o.status, cls: "info" };
              return (
                <tr key={o.id}>
                  <td>{o.id}</td>
                  <td>{o.wholesaler_name}</td>
                  <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                  <td className="num">{money(o.total)}</td>
                  <td className="muted">{o.nexob2b_order_id ?? "—"}</td>
                  <td>{new Date(o.created_at).toLocaleString("es-AR")}</td>
                  <td>
                    {o.status === "confirmed" && (
                      <button className="small" onClick={() => receive(o.id)}>
                        Recibir mercadería
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

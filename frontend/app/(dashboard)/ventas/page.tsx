"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken, money } from "@/lib/api";

interface StockItem {
  product_id: number; name: string; ean: string; quantity: string; sale_price: string | null;
}
interface Customer { id: number; name: string; balance: string }
interface SaleLine { productId: number; name: string; quantity: number; unitPrice: number; available: number }
interface Sale { id: number; ticket_number: number; payment_method: string; total: string; created_at: string; customer_name: string | null }

export default function VentasPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockItem[]>([]);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "account">("cash");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | "">("");
  const [discount, setDiscount] = useState(0);
  const [error, setError] = useState("");
  const [lastTicket, setLastTicket] = useState<{ id: number; ticketNumber: number } | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadRecent = useCallback(() => {
    api<Sale[]>("/api/sales").then((s) => setRecentSales(s.slice(0, 10))).catch(console.error);
  }, []);

  useEffect(() => {
    api<Customer[]>("/api/customers").then(setCustomers).catch(console.error);
    loadRecent();
    searchRef.current?.focus();
  }, [loadRecent]);

  // Búsqueda rápida sobre stock local (nombre o EAN escaneado)
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const items = await api<StockItem[]>(`/api/stock?q=${encodeURIComponent(q)}`);
      setResults(items.filter((i) => Number(i.quantity) > 0).slice(0, 8));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  function addLine(item: StockItem) {
    if (!item.sale_price) {
      setError(`"${item.name}" no tiene precio de venta. Definilo en Stock.`);
      return;
    }
    setError("");
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === item.product_id);
      if (existing) {
        return prev.map((l) =>
          l.productId === item.product_id && l.quantity < l.available
            ? { ...l, quantity: l.quantity + 1 }
            : l
        );
      }
      return [...prev, {
        productId: item.product_id, name: item.name, quantity: 1,
        unitPrice: Number(item.sale_price), available: Number(item.quantity),
      }];
    });
    setQ("");
    setResults([]);
    searchRef.current?.focus();
  }

  const subtotal = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
  const total = Math.max(0, subtotal - discount);

  async function checkout() {
    setError("");
    try {
      const sale = await api<{ id: number; ticketNumber: number }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          paymentMethod,
          customerId: paymentMethod === "account" ? customerId || undefined : undefined,
          discount,
        }),
      });
      setLastTicket(sale);
      setLines([]);
      setDiscount(0);
      loadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al emitir el ticket");
    }
  }

  async function openTicketPdf(saleId: number) {
    // El PDF requiere el JWT: lo bajamos con fetch y abrimos como blob
    const res = await fetch(`/api/sales/${saleId}/ticket.pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  return (
    <div>
      <h1>Punto de venta</h1>
      {lastTicket && (
        <p className="badge ok" style={{ fontSize: 14 }}>
          Ticket #{lastTicket.ticketNumber} emitido —{" "}
          <a style={{ cursor: "pointer" }} onClick={() => openTicketPdf(lastTicket.id)}>ver PDF</a>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="pos-grid">
        <div>
          <div className="card">
            <input
              ref={searchRef}
              type="search"
              placeholder="Escaneá un EAN o buscá por nombre…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && results[0]) addLine(results[0]); }}
              style={{ width: "100%", fontSize: 16, padding: 12 }}
            />
            {results.length > 0 && (
              <table style={{ marginTop: 8 }}>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.product_id} onClick={() => addLine(r)} style={{ cursor: "pointer" }}>
                      <td className="muted">{r.ean}</td>
                      <td>{r.name}</td>
                      <td className="num">{r.sale_price ? money(r.sale_price) : "sin precio"}</td>
                      <td className="num muted">stock: {Number(r.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2>Últimas ventas</h2>
            <table>
              <thead>
                <tr><th>Ticket</th><th>Cliente</th><th>Pago</th><th className="num">Total</th><th></th></tr>
              </thead>
              <tbody>
                {recentSales.map((s) => (
                  <tr key={s.id}>
                    <td>#{s.ticket_number}</td>
                    <td>{s.customer_name ?? "—"}</td>
                    <td>{{ cash: "Efectivo", card: "Tarjeta", account: "Cta. cte." }[s.payment_method]}</td>
                    <td className="num">{money(s.total)}</td>
                    <td><button className="small secondary" onClick={() => openTicketPdf(s.id)}>PDF</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Ticket actual</h2>
          <table>
            <tbody>
              {lines.map((l) => (
                <tr key={l.productId}>
                  <td>{l.name}</td>
                  <td className="num">
                    <input
                      type="number" min={1} max={l.available} value={l.quantity}
                      style={{ width: 60, textAlign: "right" }}
                      onChange={(e) =>
                        setLines(lines.map((x) =>
                          x.productId === l.productId
                            ? { ...x, quantity: Math.min(l.available, Math.max(1, Number(e.target.value))) }
                            : x
                        ))
                      }
                    />
                  </td>
                  <td className="num">{money(l.quantity * l.unitPrice)}</td>
                  <td>
                    <button className="small danger" onClick={() => setLines(lines.filter((x) => x !== l))}>✕</button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td className="muted">Sin productos</td></tr>}
            </tbody>
          </table>

          <div style={{ marginTop: 12 }}>
            <div className="toolbar">
              <label>Descuento $</label>
              <input
                type="number" min={0} value={discount} style={{ width: 100 }}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
              />
            </div>
            <div className="toolbar">
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="account">Cuenta corriente</option>
              </select>
              {paymentMethod === "account" && (
                <select value={customerId} onChange={(e) => setCustomerId(Number(e.target.value) || "")}>
                  <option value="">Elegir cliente…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} (saldo {money(c.balance)})</option>
                  ))}
                </select>
              )}
            </div>
            <div className="metric" style={{ margin: "8px 0" }}>Total: {money(total)}</div>
            <button
              style={{ width: "100%", padding: 14, fontSize: 16 }}
              disabled={lines.length === 0 || (paymentMethod === "account" && !customerId)}
              onClick={checkout}
            >
              Emitir ticket
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

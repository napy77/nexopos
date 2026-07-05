"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, getToken, money } from "@/lib/api";

interface StockItem {
  product_id: number; name: string; ean: string; category: string | null;
  image_url: string | null; quantity: string; sale_price: string | null;
}
interface Customer { id: number; name: string; balance: string }
interface SaleLine { productId: number; name: string; quantity: number; unitPrice: number; available: number }
interface Sale { id: number; ticket_number: number; payment_method: string; total: string; created_at: string; customer_name: string | null }

const CATEGORY_EMOJI: Record<string, string> = {
  "Almacén": "🛒", "Bebidas": "🥤", "Limpieza": "🧼",
  "Perfumería": "🧴", "Lácteos": "🥛", "Golosinas": "🍬",
};

export default function VentasPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [q, setQ] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "account">("cash");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | "">("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [error, setError] = useState("");
  const [lastTicket, setLastTicket] = useState<{ id: number; ticketNumber: number } | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadStock = useCallback(() => {
    api<StockItem[]>("/api/stock").then(setItems).catch(console.error);
  }, []);
  const loadCustomers = useCallback(() => {
    api<Customer[]>("/api/customers").then(setCustomers).catch(console.error);
  }, []);
  const loadRecent = useCallback(() => {
    api<Sale[]>("/api/sales").then((s) => setRecentSales(s.slice(0, 8))).catch(console.error);
  }, []);

  useEffect(() => {
    loadStock();
    loadCustomers();
    loadRecent();
    searchRef.current?.focus();
  }, [loadStock, loadCustomers, loadRecent]);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort(),
    [items]
  );

  // Vendibles: con stock > 0. El filtro es en memoria: rápido para escanear/tipear.
  const sellable = useMemo(() => items.filter((i) => Number(i.quantity) > 0), [items]);
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sellable.filter((i) => {
      if (activeCategory && i.category !== activeCategory) return false;
      if (!term) return true;
      return i.name.toLowerCase().includes(term) || i.ean.includes(term);
    });
  }, [sellable, q, activeCategory]);

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
          l.productId === item.product_id
            ? { ...l, quantity: Math.min(l.available, l.quantity + 1) }
            : l
        );
      }
      return [...prev, {
        productId: item.product_id, name: item.name, quantity: 1,
        unitPrice: Number(item.sale_price), available: Number(item.quantity),
      }];
    });
  }

  // Lector de código de barras: escanea + Enter → si hay match exacto de EAN
  // agrega directo; si hay un solo resultado filtrado, también.
  function onSearchEnter() {
    const term = q.trim();
    if (!term) return;
    const exact = sellable.find((i) => i.ean === term);
    const target = exact ?? (visible.length === 1 ? visible[0] : null);
    if (target) {
      addLine(target);
      setQ("");
    }
    searchRef.current?.focus();
  }

  async function quickCreateCustomer() {
    if (!newCustomerName.trim()) return;
    try {
      const c = await api<Customer>("/api/customers", {
        method: "POST",
        body: JSON.stringify({ name: newCustomerName.trim() }),
      });
      setNewCustomerName("");
      setShowNewCustomer(false);
      loadCustomers();
      setCustomerId(Number(c.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear cliente");
    }
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
          customerId: customerId || undefined,
          discount,
        }),
      });
      setLastTicket(sale);
      setLines([]);
      setDiscount(0);
      setCustomerId("");
      loadStock();
      loadRecent();
      searchRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al emitir el ticket");
    }
  }

  async function openTicketPdf(saleId: number) {
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
        {/* ── Izquierda: buscador, rubros y grilla de productos ── */}
        <div>
          <div className="card">
            <input
              ref={searchRef}
              type="search"
              placeholder="Escaneá el código de barras o tipeá el nombre…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSearchEnter(); }}
              style={{ width: "100%", fontSize: 16, padding: 12 }}
              autoFocus
            />

            <div className="cat-chips">
              <button
                className={`chip ${activeCategory === "" ? "chip-active" : ""}`}
                onClick={() => setActiveCategory("")}
              >
                Todos
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  className={`chip ${activeCategory === c ? "chip-active" : ""}`}
                  onClick={() => setActiveCategory(activeCategory === c ? "" : c)}
                >
                  {CATEGORY_EMOJI[c] ?? "📦"} {c}
                </button>
              ))}
            </div>

            {sellable.length === 0 ? (
              <div className="empty-state">
                <p><strong>Todavía no tenés productos en stock para vender.</strong></p>
                <p className="muted">Tres formas de cargar stock:</p>
                <ol className="muted">
                  <li><Link href="/catalogo">Catálogo B2B</Link> → comprale a un mayorista y recibí la mercadería en <Link href="/compras">Compras</Link>.</li>
                  <li><Link href="/stock">Stock</Link> → «Agregar producto del catálogo» para cargar mercadería que ya tenés en el local.</li>
                  <li>Después asignale precio de venta a cada producto en <Link href="/stock">Stock</Link>.</li>
                </ol>
              </div>
            ) : (
              <div className="pos-cards">
                {visible.map((item) => (
                  <button key={item.product_id} className="pos-card" onClick={() => addLine(item)}>
                    <div className="pos-card-img">
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image_url} alt="" />
                      ) : (
                        <span>{CATEGORY_EMOJI[item.category ?? ""] ?? "📦"}</span>
                      )}
                    </div>
                    <div className="pos-card-name">{item.name}</div>
                    <div className="pos-card-price">
                      {item.sale_price ? money(item.sale_price) : <span className="badge warn">sin precio</span>}
                    </div>
                    <div className="pos-card-stock muted">stock: {Number(item.quantity)}</div>
                  </button>
                ))}
                {visible.length === 0 && (
                  <p className="muted" style={{ padding: 12 }}>
                    Sin resultados para «{q}» {activeCategory && `en ${activeCategory}`}.
                  </p>
                )}
              </div>
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
                    <td>{s.customer_name ?? "Consumidor final"}</td>
                    <td>{{ cash: "Efectivo", card: "Tarjeta", account: "Cta. cte." }[s.payment_method]}</td>
                    <td className="num">{money(s.total)}</td>
                    <td><button className="small secondary" onClick={() => openTicketPdf(s.id)}>PDF</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Derecha: ticket en curso ── */}
        <div className="card">
          <h2>Ticket actual</h2>

          <div className="toolbar" style={{ marginBottom: 4 }}>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(Number(e.target.value) || "")}
              style={{ flex: 1 }}
            >
              <option value="">Consumidor final</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{Number(c.balance) > 0 ? ` (debe ${money(c.balance)})` : ""}
                </option>
              ))}
            </select>
            <button className="small secondary" onClick={() => setShowNewCustomer(!showNewCustomer)}>
              + Cliente
            </button>
          </div>
          {showNewCustomer && (
            <div className="toolbar">
              <input
                placeholder="Nombre del cliente"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") quickCreateCustomer(); }}
                style={{ flex: 1 }}
              />
              <button className="small" onClick={quickCreateCustomer}>Crear</button>
            </div>
          )}

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
              {lines.length === 0 && <tr><td className="muted">Escaneá o tocá un producto…</td></tr>}
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
              {paymentMethod === "account" && !customerId && (
                <span className="badge warn">elegí un cliente</span>
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

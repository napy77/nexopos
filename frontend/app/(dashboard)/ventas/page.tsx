"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, getToken, money } from "@/lib/api";

interface StockItem {
  product_id: number; name: string; ean: string; category: string | null;
  pasillo_nombre: string | null; rubro_nombre: string | null; subrubro_nombre: string | null;
  image_url: string | null; quantity: string; sale_price: string | null;
}
interface Customer { id: number; name: string; balance: string }
interface SaleLine {
  productId: number; name: string; quantity: number;
  unitPrice: number; basePrice: number; available: number;
}
interface Sale {
  id: number; ticket_number: number; payment_method: string; total: string;
  created_at: string; customer_name: string | null; refund_of: number | null; refunded_by: number | null;
}

const CATEGORY_EMOJI: Record<string, string> = {
  "Almacén": "🛒", "Bebidas": "🥤", "Limpieza": "🧼",
  "Perfumería": "🧴", "Lácteos": "🥛", "Golosinas": "🍬",
};
const PAYMENT_METHODS = [
  { id: "cash", label: "Efectivo", icon: "💵" },
  { id: "wallet", label: "Billetera", icon: "📱" },
  { id: "card", label: "Tarjeta", icon: "💳" },
  { id: "transfer", label: "Transferencia", icon: "🏦" },
  { id: "account", label: "Cuenta corriente", icon: "📒" },
] as const;
const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo", wallet: "Billetera", card: "Tarjeta",
  transfer: "Transfe", account: "Cta. cte.",
};

type NumpadMode = "qty" | "pct" | "price";
type View = "order" | "payment";

export default function VentasPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [pasillo, setPasillo] = useState("");
  const [rubro, setRubro] = useState("");
  const [subrubro, setSubrubro] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [numpadMode, setNumpadMode] = useState<NumpadMode>("qty");
  const [buffer, setBuffer] = useState("");
  const [customerId, setCustomerId] = useState<number | "">("");
  const [view, setView] = useState<View>("order");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastTicket, setLastTicket] = useState<{ id: number; ticketNumber: number; total: number } | null>(null);
  const [showCustomers, setShowCustomers] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [refundList, setRefundList] = useState<Sale[] | null>(null);
  const [newCustomerName, setNewCustomerName] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const loadStock = useCallback(() => {
    api<StockItem[]>("/api/stock").then(setItems).catch(console.error);
  }, []);
  const loadCustomers = useCallback(() => {
    api<Customer[]>("/api/customers").then(setCustomers).catch(console.error);
  }, []);

  useEffect(() => {
    loadStock();
    loadCustomers();
    searchRef.current?.focus();
  }, [loadStock, loadCustomers]);

  const sellable = useMemo(() => items.filter((i) => Number(i.quantity) > 0), [items]);

  // Taxonomía NexoB2B en cascada, derivada del stock del comercio.
  // Los productos sin taxonomía (cargas viejas) quedan bajo "Otros".
  const pasillos = useMemo(
    () => [...new Set(sellable.map((i) => i.pasillo_nombre ?? "Otros"))].sort(),
    [sellable]
  );
  const enPasillo = useMemo(
    () => (pasillo ? sellable.filter((i) => (i.pasillo_nombre ?? "Otros") === pasillo) : sellable),
    [sellable, pasillo]
  );
  const rubros = useMemo(
    () => (pasillo ? [...new Set(enPasillo.map((i) => i.rubro_nombre).filter((r): r is string => !!r))].sort() : []),
    [enPasillo, pasillo]
  );
  const enRubro = useMemo(
    () => (rubro ? enPasillo.filter((i) => i.rubro_nombre === rubro) : enPasillo),
    [enPasillo, rubro]
  );
  const subrubros = useMemo(
    () => (rubro ? [...new Set(enRubro.map((i) => i.subrubro_nombre).filter((s): s is string => !!s))].sort() : []),
    [enRubro, rubro]
  );

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return enRubro.filter((i) => {
      if (subrubro && i.subrubro_nombre !== subrubro) return false;
      if (!term) return true;
      return i.name.toLowerCase().includes(term) || i.ean.includes(term);
    });
  }, [enRubro, subrubro, q]);

  function selectPasillo(p: string) {
    setPasillo(pasillo === p ? "" : p);
    setRubro("");
    setSubrubro("");
  }
  function selectRubro(r: string) {
    setRubro(rubro === r ? "" : r);
    setSubrubro("");
  }

  const customer = customers.find((c) => c.id === customerId);
  const total = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);

  // ── Armado del ticket ──────────────────────────────────────────────────────

  function addLine(item: StockItem) {
    if (!item.sale_price) {
      setError(`"${item.name}" no tiene precio de venta. Definilo en Stock.`);
      return;
    }
    setError("");
    setBuffer("");
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === item.product_id);
      if (existing) {
        setSelectedId(existing.productId);
        return prev.map((l) =>
          l.productId === item.product_id
            ? { ...l, quantity: Math.min(l.available, l.quantity + 1) }
            : l
        );
      }
      setSelectedId(item.product_id);
      const price = Number(item.sale_price);
      return [...prev, {
        productId: item.product_id, name: item.name, quantity: 1,
        unitPrice: price, basePrice: price, available: Number(item.quantity),
      }];
    });
  }

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

  // ── Numpad (opera sobre la línea seleccionada) ─────────────────────────────

  function applyBuffer(next: string) {
    setBuffer(next);
    if (selectedId === null) return;
    const value = parseFloat(next.replace(",", "."));
    setLines((prev) => prev.map((l) => {
      if (l.productId !== selectedId) return l;
      if (next === "" || isNaN(value)) return l;
      if (numpadMode === "qty") return { ...l, quantity: Math.min(l.available, Math.max(0, value)) };
      if (numpadMode === "pct") return { ...l, unitPrice: Math.max(0, l.basePrice * (1 - value / 100)) };
      return { ...l, unitPrice: Math.max(0, value) };
    }));
  }

  function numpadPress(key: string) {
    if (selectedId === null && key !== "back") return;
    setError("");
    if (key === "back") {
      if (buffer.length > 0) applyBuffer(buffer.slice(0, -1));
      else if (selectedId !== null) {
        // sin buffer: borrar la línea seleccionada
        setLines((prev) => prev.filter((l) => l.productId !== selectedId));
        setSelectedId(null);
      }
      return;
    }
    if (key === ",") {
      if (!buffer.includes(",")) applyBuffer(buffer === "" ? "0," : buffer + ",");
      return;
    }
    applyBuffer(buffer + key);
  }

  function selectLine(id: number) {
    setSelectedId(id);
    setBuffer("");
  }

  function changeMode(mode: NumpadMode) {
    setNumpadMode(mode);
    setBuffer("");
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  function anularVenta() {
    setLines([]);
    setSelectedId(null);
    setBuffer("");
    setCustomerId("");
    setShowActions(false);
    setNotice("Venta anulada.");
    setTimeout(() => setNotice(""), 2500);
    searchRef.current?.focus();
  }

  async function abrirReembolsos() {
    setShowActions(false);
    const sales = await api<Sale[]>("/api/sales");
    setRefundList(sales.filter((s) => !s.refund_of && !s.refunded_by && Number(s.total) > 0).slice(0, 15));
  }

  async function reembolsar(sale: Sale) {
    setError("");
    try {
      const r = await api<{ id: number; ticketNumber: number; total: number }>(`/api/sales/${sale.id}/refund`, { method: "POST" });
      setRefundList(null);
      setLastTicket(r);
      setNotice(`Reembolso del ticket #${sale.ticket_number} emitido (ticket #${r.ticketNumber}).`);
      loadStock();
      loadCustomers();
      setTimeout(() => setNotice(""), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al reembolsar");
    }
  }

  // ── Pago ───────────────────────────────────────────────────────────────────

  async function cobrar() {
    setError("");
    try {
      const sale = await api<{ id: number; ticketNumber: number; total: number }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          items: lines.filter((l) => l.quantity > 0).map((l) => ({
            productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice,
          })),
          paymentMethod,
          customerId: customerId || undefined,
          discount: 0,
        }),
      });
      setLastTicket({ ...sale, total });
      setLines([]);
      setSelectedId(null);
      setBuffer("");
      setCustomerId("");
      setPaymentMethod("cash");
      setView("order");
      loadStock();
      loadCustomers();
      searchRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cobrar");
    }
  }

  async function openTicketPdf(saleId: number) {
    const res = await fetch(`/api/sales/${saleId}/ticket.pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  async function quickCreateCustomer() {
    if (!newCustomerName.trim()) return;
    const c = await api<Customer>("/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: newCustomerName.trim() }),
    });
    setNewCustomerName("");
    await loadCustomers();
    setCustomerId(Number(c.id));
    setShowCustomers(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="pos-shell">
      {/* ══ Panel izquierdo: ticket ══ */}
      <div className="ticket-panel">
        <div className="ticket-top">
          <button
            className={`customer-btn ${customerId ? "has-customer" : ""}`}
            onClick={() => { setShowCustomers(!showCustomers); setShowActions(false); }}
          >
            👤 {customer ? customer.name : "Consumidor Final"}
          </button>
          <button className="secondary" onClick={() => { setShowActions(!showActions); setShowCustomers(false); }}>
            Acciones ▾
          </button>
        </div>

        {showActions && (
          <div className="actions-menu">
            <button onClick={anularVenta} disabled={lines.length === 0}>🗑 Anular venta</button>
            <button onClick={abrirReembolsos}>↩️ Reembolso</button>
          </div>
        )}

        {showCustomers && (
          <div className="actions-menu">
            <button onClick={() => { setCustomerId(""); setShowCustomers(false); }}>
              Consumidor Final
            </button>
            {customers.map((c) => (
              <button key={c.id} onClick={() => { setCustomerId(Number(c.id)); setShowCustomers(false); }}>
                {c.name}{Number(c.balance) > 0 && <span className="muted"> · debe {money(c.balance)}</span>}
              </button>
            ))}
            <div className="toolbar" style={{ padding: "6px 10px" }}>
              <input
                placeholder="Nuevo cliente…"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") quickCreateCustomer(); }}
                style={{ flex: 1 }}
              />
              <button className="small" onClick={quickCreateCustomer}>Crear</button>
            </div>
          </div>
        )}

        <div className="ticket-lines">
          {lines.map((l) => (
            <div
              key={l.productId}
              className={`ticket-line ${selectedId === l.productId ? "selected" : ""}`}
              onClick={() => selectLine(l.productId)}
            >
              <div className="tl-main">
                <span className="tl-name">{l.name}</span>
                <span className="tl-subtotal">{money(l.quantity * l.unitPrice)}</span>
              </div>
              <div className="tl-detail muted">
                <b>{l.quantity}</b> x {money(l.unitPrice)}
                {l.unitPrice !== l.basePrice && <span className="badge warn" style={{ marginLeft: 6 }}>precio modificado</span>}
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <p className="muted" style={{ padding: 16 }}>Escaneá un código o tocá un producto para empezar.</p>
          )}
        </div>

        <div className="ticket-total">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </div>

        {error && <p className="error" style={{ margin: "4px 12px" }}>{error}</p>}
        {notice && <p className="badge ok" style={{ margin: "4px 12px" }}>{notice}</p>}
        {lastTicket && !notice && (
          <p style={{ margin: "4px 12px" }}>
            <span className="badge ok">
              Ticket #{lastTicket.ticketNumber} emitido —{" "}
              <a style={{ cursor: "pointer" }} onClick={() => openTicketPdf(lastTicket.id)}>ver PDF</a>
            </span>
          </p>
        )}

        <div className="numpad">
          {["1","2","3","qty","4","5","6","pct","7","8","9","price","+/-","0",",","back"].map((k) => {
            if (k === "qty" || k === "pct" || k === "price") {
              const labels = { qty: "Cant.", pct: "% Desc.", price: "Precio" } as const;
              return (
                <button
                  key={k}
                  className={`np-mode ${numpadMode === k ? "np-active" : ""}`}
                  onClick={() => changeMode(k as NumpadMode)}
                >
                  {labels[k as NumpadMode]}
                </button>
              );
            }
            if (k === "back") return <button key={k} className="np-back" onClick={() => numpadPress("back")}>⌫</button>;
            if (k === "+/-") {
              return (
                <button key={k} className="np-key" onClick={() => {
                  if (selectedId !== null) setLines((prev) => prev.filter((l) => l.productId !== selectedId));
                  setSelectedId(null);
                }}>
                  Quitar
                </button>
              );
            }
            return <button key={k} className="np-key" onClick={() => numpadPress(k)}>{k}</button>;
          })}
        </div>

        <button
          className="pay-btn"
          disabled={lines.length === 0 || total <= 0}
          onClick={() => { setView("payment"); setShowActions(false); setShowCustomers(false); }}
        >
          Pago · {money(total)}
        </button>
      </div>

      {/* ══ Panel derecho: productos o pago ══ */}
      {view === "order" ? (
        <div className="products-panel">
          <input
            ref={searchRef}
            type="search"
            className="pos-search"
            placeholder="🔍 Escaneá el código de barras o buscá por nombre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearchEnter(); }}
          />
          {/* Taxonomía NexoB2B: pasillo → rubro → subrubro */}
          <div className="cat-chips">
            <button className={`chip ${pasillo === "" ? "chip-active" : ""}`} onClick={() => selectPasillo("")}>
              Todos
            </button>
            {pasillos.map((p) => (
              <button key={p} className={`chip ${pasillo === p ? "chip-active" : ""}`} onClick={() => selectPasillo(p)}>
                {CATEGORY_EMOJI[p] ?? "🏷"} {p}
              </button>
            ))}
          </div>
          {rubros.length > 0 && (
            <div className="cat-chips cat-chips-sub">
              {rubros.map((r) => (
                <button key={r} className={`chip chip-sm ${rubro === r ? "chip-active" : ""}`} onClick={() => selectRubro(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {subrubros.length > 0 && (
            <div className="cat-chips cat-chips-sub">
              {subrubros.map((s) => (
                <button
                  key={s}
                  className={`chip chip-sm chip-outline ${subrubro === s ? "chip-active" : ""}`}
                  onClick={() => setSubrubro(subrubro === s ? "" : s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {sellable.length === 0 ? (
            <div className="empty-state" style={{ margin: 12 }}>
              <p><strong>Todavía no tenés productos en stock para vender.</strong></p>
              <ol className="muted">
                <li><Link href="/catalogo">Catálogo B2B</Link> → comprale a un mayorista y recibí la mercadería en <Link href="/compras">Compras</Link>.</li>
                <li><Link href="/stock">Stock</Link> → «Agregar producto del catálogo» para mercadería que ya tenés.</li>
                <li>Asignale precio de venta en <Link href="/stock">Stock</Link>.</li>
              </ol>
            </div>
          ) : (
            <div className="pos-cards">
              {visible.map((item) => {
                const inTicket = lines.find((l) => l.productId === item.product_id);
                return (
                  <button key={item.product_id} className="pos-card" onClick={() => addLine(item)}>
                    {inTicket && <span className="pos-card-qty">{inTicket.quantity}</span>}
                    <div className="pos-card-img">
                      {item.image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={item.image_url} alt="" />
                        : <span>{CATEGORY_EMOJI[item.category ?? ""] ?? "📦"}</span>}
                    </div>
                    <div className="pos-card-name">{item.name}</div>
                    <div className="pos-card-footer">
                      <span className="pos-card-price">
                        {item.sale_price ? money(item.sale_price) : "sin precio"}
                      </span>
                      <span className="pos-card-stock">{Number(item.quantity)}</span>
                    </div>
                  </button>
                );
              })}
              {visible.length === 0 && <p className="muted" style={{ padding: 12 }}>Sin resultados para «{q}».</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="products-panel pay-screen">
          <div className="pay-header">
            <button className="secondary" onClick={() => setView("order")}>← Volver</button>
            <h1 style={{ margin: 0 }}>Cobrar {money(total)}</h1>
          </div>
          <p className="muted">
            Cliente: <strong>{customer ? customer.name : "Consumidor Final"}</strong>
            {customer && Number(customer.balance) > 0 && ` (debe ${money(customer.balance)})`}
          </p>
          <div className="pay-methods">
            {PAYMENT_METHODS.map((m) => {
              const disabled = m.id === "account" && !customerId;
              return (
                <button
                  key={m.id}
                  className={`pay-method ${paymentMethod === m.id ? "pm-active" : ""}`}
                  disabled={disabled}
                  onClick={() => setPaymentMethod(m.id)}
                >
                  <span className="pm-icon">{m.icon}</span>
                  {m.label}
                  {disabled && <span className="muted" style={{ fontSize: 11 }}>elegí un cliente</span>}
                </button>
              );
            })}
          </div>
          {paymentMethod === "account" && !customerId && (
            <p className="error">La cuenta corriente requiere un cliente: volvé y seleccionalo con el botón 👤.</p>
          )}
          {error && <p className="error">{error}</p>}
          <button
            className="pay-btn"
            style={{ maxWidth: 420 }}
            disabled={paymentMethod === "account" && !customerId}
            onClick={cobrar}
          >
            ✓ Validar y emitir ticket
          </button>
        </div>
      )}

      {/* ══ Modal de reembolsos ══ */}
      {refundList && (
        <div className="modal-backdrop" onClick={() => setRefundList(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reembolsar un ticket</h2>
            <table>
              <thead>
                <tr><th>Ticket</th><th>Cliente</th><th>Pago</th><th className="num">Total</th><th></th></tr>
              </thead>
              <tbody>
                {refundList.map((s) => (
                  <tr key={s.id}>
                    <td>#{s.ticket_number}</td>
                    <td>{s.customer_name ?? "Consumidor Final"}</td>
                    <td>{METHOD_LABEL[s.payment_method] ?? s.payment_method}</td>
                    <td className="num">{money(s.total)}</td>
                    <td><button className="small danger" onClick={() => reembolsar(s)}>Reembolsar</button></td>
                  </tr>
                ))}
                {refundList.length === 0 && (
                  <tr><td colSpan={5} className="muted">No hay tickets reembolsables.</td></tr>
                )}
              </tbody>
            </table>
            <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="secondary" onClick={() => setRefundList(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

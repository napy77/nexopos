"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, money } from "@/lib/api";
import { loadCart, saveCart, type CartLine } from "@/lib/cart";
import { ESTADO_ORDEN, type B2BMedioPago } from "@/lib/b2b-types";

interface Order {
  id: number; wholesaler_name: string; status: string; estado_b2b: string | null;
  numero: number | null; total: string; medio_pago: string | null;
  is_facturada: boolean; nexob2b_order_id: string | null; created_at: string; received_at: string | null;
}

export default function ComprasPage() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOrders = useCallback(() => {
    api<Order[]>("/api/purchases").then(setOrders).catch(console.error);
  }, []);

  useEffect(() => {
    setCart(loadCart());
    loadOrders();
  }, [loadOrders]);

  function updateCart(next: CartLine[]) {
    setCart(next);
    saveCart(next);
  }

  const porMayorista = useMemo(() => {
    const groups: Record<string, CartLine[]> = {};
    for (const l of cart) (groups[l.mayoristaId] ??= []).push(l);
    return groups;
  }, [cart]);

  async function onConfirmed(mayoristaId: string, numero: number) {
    updateCart(cart.filter((l) => l.mayoristaId !== mayoristaId));
    setOk(`Orden #${numero} enviada al mayorista.`);
    setTimeout(() => setOk(""), 5000);
    loadOrders();
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

  async function cancel(orderId: number) {
    setError("");
    try {
      await api(`/api/purchases/${orderId}/cancel`, { method: "POST" });
      loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cancelar");
    }
  }

  return (
    <div>
      <h1>Compras a mayoristas</h1>
      {error && <p className="error">{error}</p>}
      {ok && <p className="badge ok" style={{ fontSize: 14 }}>{ok}</p>}

      <div className="card">
        <h2>Carrito de compra</h2>
        {cart.length === 0 && (
          <p className="muted">
            Carrito vacío. Agregá productos desde el <Link href="/catalogo">Catálogo B2B</Link>.
          </p>
        )}
        {Object.entries(porMayorista).map(([mayoristaId, lines]) => (
          <CheckoutGroup
            key={mayoristaId}
            mayoristaId={mayoristaId}
            lines={lines}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onQuantity={(line, cantidad) =>
              updateCart(cart.map((l) => (l === line ? { ...l, cantidad: Math.max(1, cantidad) } : l)))
            }
            onRemove={(line) => updateCart(cart.filter((l) => l !== line))}
            onConfirmed={onConfirmed}
          />
        ))}
      </div>

      <div className="card">
        <h2>Historial de compras</h2>
        <table>
          <thead>
            <tr>
              <th>N°</th><th>Mayorista</th><th>Estado NexoB2B</th><th className="num">Total</th>
              <th>Pago</th><th>Fecha</th><th>Stock</th><th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const estado = o.estado_b2b ? ESTADO_ORDEN[o.estado_b2b] ?? { label: o.estado_b2b, cls: "info" } : null;
              const cancelable = o.estado_b2b === "cargada" && !o.is_facturada && o.status !== "received";
              const recibible = o.status === "confirmed" && o.estado_b2b !== "cancelada";
              return (
                <tr key={o.id}>
                  <td>{o.numero ?? o.id}</td>
                  <td>{o.wholesaler_name}</td>
                  <td>{estado ? <span className={`badge ${estado.cls}`}>{estado.label}</span> : "—"}</td>
                  <td className="num">{money(o.total)}</td>
                  <td className="muted">{o.medio_pago ?? "—"}</td>
                  <td>{new Date(o.created_at).toLocaleString("es-AR")}</td>
                  <td>
                    {o.status === "received"
                      ? <span className="badge ok">Ingresado</span>
                      : <span className="muted">pendiente</span>}
                  </td>
                  <td>
                    {recibible && (
                      <button className="small" onClick={() => receive(o.id)}>Recibir mercadería</button>
                    )}{" "}
                    {cancelable && (
                      <button className="small danger" onClick={() => cancel(o.id)}>Cancelar</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && <tr><td colSpan={8} className="muted">Sin compras todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CheckoutGroup({ mayoristaId, lines, busy, setBusy, setError, onQuantity, onRemove, onConfirmed }: {
  mayoristaId: string;
  lines: CartLine[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string) => void;
  onQuantity: (line: CartLine, cantidad: number) => void;
  onRemove: (line: CartLine) => void;
  onConfirmed: (mayoristaId: string, numero: number) => void;
}) {
  const [medios, setMedios] = useState<B2BMedioPago[]>([]);
  const [medioPagoId, setMedioPagoId] = useState("");
  const [notas, setNotas] = useState("");

  useEffect(() => {
    api<{ mediosPago: B2BMedioPago[] }>(`/api/mayoristas/${mayoristaId}/medios-pago`)
      .then((d) => {
        setMedios(d.mediosPago);
        if (d.mediosPago[0]) setMedioPagoId(d.mediosPago[0].id);
      })
      .catch(console.error);
  }, [mayoristaId]);

  const subtotal = lines.reduce((acc, l) => acc + l.cantidad * l.precio, 0);
  const medio = medios.find((m) => m.id === medioPagoId);
  const recargo = medio ? (subtotal * medio.porcentaje_costo) / 100 : 0;

  async function confirmar() {
    setError("");
    setBusy(true);
    try {
      const res = await api<{ numero: number }>("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          mayoristaId,
          medioPagoId,
          notas: notas || undefined,
          items: lines.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad, meta: l.meta })),
        }),
      });
      onConfirmed(mayoristaId, res.numero);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al confirmar la orden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <h2>{lines[0].mayoristaNombre}</h2>
      <table>
        <thead>
          <tr>
            <th>Producto</th><th>Presentación</th><th className="num">Cantidad</th>
            <th className="num">Precio (sin IVA)</th><th className="num">Subtotal</th><th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.presentacionId}>
              <td>{l.meta.productoNombre}</td>
              <td className="muted">{l.meta.presentacionNombre}</td>
              <td className="num">
                <input
                  type="number" min={1} value={l.cantidad}
                  style={{ width: 80, textAlign: "right" }}
                  onChange={(e) => onQuantity(l, Number(e.target.value))}
                />
              </td>
              <td className="num">{money(l.precio)}</td>
              <td className="num">{money(l.cantidad * l.precio)}</td>
              <td><button className="small danger" onClick={() => onRemove(l)}>Quitar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <select value={medioPagoId} onChange={(e) => setMedioPagoId(e.target.value)}>
          {medios.map((m) => (
            <option key={m.id} value={m.id}>
              {m.icono ? `${m.icono} ` : ""}{m.nombre}{m.porcentaje_costo > 0 ? ` (+${m.porcentaje_costo}%)` : ""}
            </option>
          ))}
        </select>
        <input
          placeholder="Notas para el mayorista (opcional)"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>
      <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <span className="muted">
          Subtotal (sin IVA): {money(subtotal)}
          {recargo > 0 && ` · recargo medio de pago: ${money(recargo)}`}
          {" · el total final con IVA lo calcula NexoB2B"}
        </span>
        <button disabled={busy || !medioPagoId} onClick={confirmar}>Confirmar orden</button>
      </div>
    </div>
  );
}

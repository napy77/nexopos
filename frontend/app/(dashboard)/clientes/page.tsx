"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money } from "@/lib/api";

interface Customer {
  id: number; name: string; doc_number: string | null; phone: string | null;
  email: string | null; balance: string;
  clubpay_status?: string | null;
}
interface Tx { id: number; type: string; amount: string; note: string | null; created_at: string }

const TX_LABEL: Record<string, string> = {
  sale_credit: "Venta a cuenta",
  payment: "Pago",
  adjustment: "Ajuste",
};

/**
 * Qué ve el almacenero sobre la cuenta de ClubPay del cliente.
 *
 * "Sin cuenta en ClubPay" no es una falla y por eso no se muestra en rojo: la
 * mayoría de los clientes de un almacén no tienen la app y la cuenta corriente
 * funciona igual. Lo único que cambia es si esa persona la ve en el teléfono.
 */
const CLUBPAY_ESTADO: Record<string, { texto: string; clase: string; ayuda: string }> = {
  aceptada: {
    texto: "Ve su cuenta en ClubPay", clase: "ok",
    ayuda: "Cada compra y cada pago le aparecen en la app.",
  },
  propuesta: {
    texto: "Vinculación propuesta", clase: "warn",
    ayuda: "Le llegó la propuesta a su app y todavía no la aceptó. Hasta que acepte no ve nada.",
  },
  rechazada: {
    texto: "No quiso vincular", clase: "warn",
    ayuda: "La persona rechazó la propuesta. La cuenta corriente sigue igual, acá.",
  },
  sin_cuenta: {
    texto: "Sin cuenta en ClubPay", clase: "",
    ayuda: "Este DNI no está en ClubPay. La cuenta corriente funciona igual.",
  },
};

export default function ClientesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<Customer[]>("/api/customers").then(setCustomers).catch(console.error);
  }, []);
  useEffect(load, [load]);

  async function select(c: Customer) {
    setSelected(c);
    const data = await api<{ customer: Customer; transactions: Tx[] }>(
      `/api/customers/${c.id}/transactions`
    );
    setSelected(data.customer);
    setTxs(data.transactions);
  }

  async function createCustomer(form: FormData) {
    setError("");
    try {
      await api("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name")),
          docNumber: String(form.get("doc") || "") || undefined,
          phone: String(form.get("phone") || "") || undefined,
          email: String(form.get("email") || "") || undefined,
        }),
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear cliente");
    }
  }

  async function registerPayment(form: FormData) {
    if (!selected) return;
    setError("");
    try {
      await api(`/api/customers/${selected.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(form.get("amount")),
          note: String(form.get("note") || "") || undefined,
          paymentMethod: String(form.get("paymentMethod") || "cash"),
        }),
      });
      load();
      select(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar pago");
    }
  }

  return (
    <div>
      <h1>Clientes y cuentas corrientes</h1>
      <div className="toolbar">
        <button onClick={() => setShowForm(!showForm)}>+ Nuevo cliente</button>
      </div>
      {error && <p className="error">{error}</p>}

      {showForm && (
        <div className="card" style={{ border: "2px solid var(--primary)" }}>
          <form action={createCustomer} className="toolbar">
            <input name="name" placeholder="Nombre *" required />
            <input name="doc" placeholder="DNI/CUIT" />
            <input name="phone" placeholder="Teléfono" />
            <input name="email" type="email" placeholder="Email" />
            <button type="submit">Guardar</button>
          </form>
        </div>
      )}

      <div className="row">
        <div className="card">
          <table>
            <thead>
              <tr><th>Nombre</th><th>Documento</th><th>Teléfono</th><th className="num">Saldo</th></tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} onClick={() => select(c)} style={{ cursor: "pointer" }}>
                  <td>{c.name}</td>
                  <td className="muted">{c.doc_number ?? "—"}</td>
                  <td className="muted">{c.phone ?? "—"}</td>
                  <td className="num">
                    <span className={`badge ${Number(c.balance) > 0 ? "warn" : "ok"}`}>
                      {money(c.balance)}
                    </span>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={4} className="muted">Sin clientes registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="card">
            <h2>{selected.name} — saldo {money(selected.balance)}</h2>
            <ClubPayVinculo cliente={selected} onCambio={(status) => {
              setSelected({ ...selected, clubpay_status: status });
              load();
            }} />
            <form action={registerPayment} className="toolbar">
              <input name="amount" type="number" step="0.01" min="0.01" placeholder="Monto del pago" required style={{ width: 140 }} />
              <select name="paymentMethod" defaultValue="cash" title="Con qué pagó (importa para el arqueo de caja)">
                <option value="cash">💵 Efectivo</option>
                <option value="wallet">📱 Billetera</option>
                <option value="card">💳 Tarjeta</option>
                <option value="transfer">🏦 Transferencia</option>
              </select>
              <input name="note" placeholder="Nota (opcional)" />
              <button type="submit">Registrar pago</button>
            </form>
            <table>
              <thead>
                <tr><th>Fecha</th><th>Tipo</th><th>Nota</th><th className="num">Monto</th></tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td>{new Date(t.created_at).toLocaleString("es-AR")}</td>
                    <td>{TX_LABEL[t.type] ?? t.type}</td>
                    <td className="muted">{t.note}</td>
                    <td className="num" style={{ color: Number(t.amount) > 0 ? "var(--danger)" : "var(--success)" }}>
                      {money(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Estado de la cuenta del cliente en ClubPay, con el botón para proponerla o
 * para volver a preguntar en qué quedó.
 *
 * El botón de volver a preguntar existe porque ClubPay no nos avisa cuando la
 * persona acepta: la única forma de enterarse es preguntar de nuevo.
 */
function ClubPayVinculo({
  cliente,
  onCambio,
}: {
  cliente: Customer;
  onCambio: (status: string) => void;
}) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const estado = cliente.clubpay_status ? CLUBPAY_ESTADO[cliente.clubpay_status] : null;

  async function consultar() {
    setCargando(true);
    setError("");
    try {
      const r = await api<{ status: string }>(`/api/customers/${cliente.id}/clubpay`, {
        method: "POST",
      });
      onCambio(r.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar");
    } finally {
      setCargando(false);
    }
  }

  if (!cliente.doc_number) {
    return (
      <p className="muted" style={{ fontSize: 13, margin: "4px 0 12px" }}>
        Cargale el DNI para que pueda ver esta cuenta en ClubPay.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 12px", flexWrap: "wrap" }}>
      {estado ? (
        <>
          <span className={`badge ${estado.clase}`}>{estado.texto}</span>
          <span className="muted" style={{ fontSize: 12 }}>{estado.ayuda}</span>
        </>
      ) : (
        <span className="muted" style={{ fontSize: 13 }}>
          Todavía no se le propuso ver esta cuenta en ClubPay.
        </span>
      )}
      <button type="button" className="ghost" onClick={consultar} disabled={cargando}>
        {cargando ? "Consultando…" : estado ? "Volver a preguntar" : "Proponer vinculación"}
      </button>
      {error && <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}

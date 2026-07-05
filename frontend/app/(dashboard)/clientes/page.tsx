"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money } from "@/lib/api";

interface Customer {
  id: number; name: string; doc_number: string | null; phone: string | null;
  email: string | null; balance: string;
}
interface Tx { id: number; type: string; amount: string; note: string | null; created_at: string }

const TX_LABEL: Record<string, string> = {
  sale_credit: "Venta a cuenta",
  payment: "Pago",
  adjustment: "Ajuste",
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
            <form action={registerPayment} className="toolbar">
              <input name="amount" type="number" step="0.01" min="0.01" placeholder="Monto del pago" required style={{ width: 140 }} />
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

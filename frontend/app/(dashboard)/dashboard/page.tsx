"use client";

import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";

interface Daily {
  date: string;
  tickets: number;
  total: string;
  cash: string;
  wallet: string;
  card: string;
  transfer: string;
  account: string;
  topProducts: { name: string; quantity: string; revenue: string }[];
}
interface Alert { product_id: number; name: string; quantity: string; min_stock: string }
interface Receivables { total: number; customers: { id: number; name: string; balance: string }[] }

export default function DashboardPage() {
  const [daily, setDaily] = useState<Daily | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [receivables, setReceivables] = useState<Receivables | null>(null);

  useEffect(() => {
    api<Daily>("/api/reports/daily").then(setDaily).catch(console.error);
    api<Alert[]>("/api/stock/alerts").then(setAlerts).catch(console.error);
    api<Receivables>("/api/reports/receivables").then(setReceivables).catch(console.error);
  }, []);

  return (
    <div>
      <h1>Resumen del día</h1>
      <div className="row">
        <div className="card">
          <div className="metric-label">Ventas de hoy</div>
          <div className="metric">{daily ? money(daily.total) : "…"}</div>
          <div className="muted">{daily?.tickets ?? 0} tickets</div>
        </div>
        <div className="card">
          <div className="metric-label">💵 Efectivo</div>
          <div className="metric">{daily ? money(daily.cash) : "…"}</div>
        </div>
        <div className="card">
          <div className="metric-label">📱 Billetera</div>
          <div className="metric">{daily ? money(daily.wallet) : "…"}</div>
        </div>
        <div className="card">
          <div className="metric-label">💳 Tarjeta</div>
          <div className="metric">{daily ? money(daily.card) : "…"}</div>
        </div>
        <div className="card">
          <div className="metric-label">🏦 Transferencia</div>
          <div className="metric">{daily ? money(daily.transfer) : "…"}</div>
        </div>
        <div className="card">
          <div className="metric-label">📒 Cuenta corriente</div>
          <div className="metric">{daily ? money(daily.account) : "…"}</div>
        </div>
      </div>

      <div className="row">
        <div className="card">
          <h2>Más vendidos hoy</h2>
          {daily?.topProducts.length ? (
            <table>
              <thead>
                <tr><th>Producto</th><th className="num">Cant.</th><th className="num">Importe</th></tr>
              </thead>
              <tbody>
                {daily.topProducts.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className="num">{Number(p.quantity)}</td>
                    <td className="num">{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Sin ventas registradas hoy.</p>
          )}
        </div>

        <div className="card">
          <h2>Alertas de stock bajo</h2>
          {alerts.length ? (
            <table>
              <thead>
                <tr><th>Producto</th><th className="num">Stock</th><th className="num">Mínimo</th></tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.product_id}>
                    <td>{a.name}</td>
                    <td className="num"><span className="badge err">{Number(a.quantity)}</span></td>
                    <td className="num">{Number(a.min_stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Sin alertas. Todo el stock por encima del mínimo.</p>
          )}
        </div>

        <div className="card">
          <h2>Cuentas por cobrar</h2>
          <div className="metric">{receivables ? money(receivables.total) : "…"}</div>
          <div className="muted">{receivables?.customers.length ?? 0} clientes con saldo</div>
        </div>
      </div>
    </div>
  );
}

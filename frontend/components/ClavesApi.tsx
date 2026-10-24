"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface ClaveApi {
  id: number; nombre: string; preview: string;
  usadaAt: string | null; revocada: boolean; creadaAt: string;
}

/**
 * Las claves para que el sistema del comercio se conecte.
 *
 * Existe para no obligar al uso de NexoPOS: un negocio con miles de productos
 * no les va a poner precio a mano, y el que ya tiene un ERP andando no lo va a
 * tirar. Si la pantalla es la única puerta, ese comercio no entra.
 *
 * La clave se muestra UNA vez. De la base solo sale el hash, así que no hay
 * forma de volver a verla —a propósito: una clave recuperable es una que
 * alguien puede ir a buscar a un backup—.
 */
export function ClavesApi({ onError }: { onError: (m: string) => void }) {
  const [claves, setClaves] = useState<ClaveApi[]>([]);
  const [nombre, setNombre] = useState("");
  const [reciente, setReciente] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);

  const cargar = () =>
    api<ClaveApi[]>("/api/settings/api-keys").then(setClaves).catch(() => {});
  useEffect(() => { cargar(); }, []);

  async function crear() {
    onError("");
    try {
      const r = await api<{ clave: string }>("/api/settings/api-keys", {
        method: "POST", body: JSON.stringify({ nombre }),
      });
      setReciente(r.clave);
      setNombre("");
      cargar();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo crear");
    }
  }

  async function revocar(id: number, n: string) {
    if (!window.confirm(`¿Revocar "${n}"?\n\nLo que la esté usando va a dejar de funcionar.`)) return;
    try {
      await api(`/api/settings/api-keys/${id}`, { method: "DELETE" });
      cargar();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo revocar");
    }
  }

  return (
    <div className="card" style={{ minWidth: 340 }}>
      <h2>Conectar tu sistema</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        Si usás un ERP, Odoo u otro sistema, puede dar de alta tus productos y mantener
        precios y stock sin pasar por acá. Generá una clave y pasásela a quien lo programe.
      </p>

      {reciente && (
        <div style={{ background: "#fff7ed", padding: 10, borderRadius: 6, marginBottom: 10 }}>
          <strong style={{ fontSize: 13 }}>Guardala ahora: no se puede volver a ver.</strong>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
            <code style={{ fontSize: 11, wordBreak: "break-all", flex: 1 }}>{reciente}</code>
            <button type="button" className="ghost" style={{ fontSize: 12 }}
              onClick={async () => {
                try { await navigator.clipboard.writeText(reciente); setCopiada(true);
                      setTimeout(() => setCopiada(false), 2000); }
                catch { window.prompt("Copiá la clave:", reciente); }
              }}>{copiada ? "✓" : "Copiar"}</button>
          </div>
          <button type="button" className="ghost" style={{ fontSize: 11, marginTop: 6 }}
            onClick={() => setReciente(null)}>Ya la guardé</button>
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 8 }}>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)}
          placeholder="Para qué es: ERP, Odoo…" style={{ flex: 1, minWidth: 150 }} />
        <button type="button" onClick={crear} disabled={!nombre.trim()}>Generar clave</button>
      </div>

      {claves.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>Todavía no generaste ninguna.</p>
      ) : (
        <table style={{ fontSize: 12 }}>
          <tbody>
            {claves.map((c) => (
              <tr key={c.id} style={{ opacity: c.revocada ? 0.5 : 1 }}>
                <td>{c.nombre}</td>
                <td className="muted"><code style={{ fontSize: 11 }}>{c.preview}</code></td>
                <td className="muted">
                  {c.revocada ? "revocada"
                    : c.usadaAt ? `usada ${new Date(c.usadaAt).toLocaleDateString("es-AR")}`
                    : "sin usar"}
                </td>
                <td>
                  {!c.revocada && (
                    <button type="button" className="ghost" style={{ fontSize: 11 }}
                      onClick={() => revocar(c.id, c.nombre)}>Revocar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <a href="/docs/api" target="_blank" rel="noreferrer"
        style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 600 }}>
        Ver la documentación ↗
      </a>
      <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        Pasásela a quien programe tu sistema: está en{" "}
        <code style={{ fontSize: 11 }}>nexopos.app/docs/api</code> y se lee sin cuenta.
      </p>
    </div>
  );
}

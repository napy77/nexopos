"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, money } from "@/lib/api";
import { ClavesApi } from "@/components/ClavesApi";
import { decodificar, leerCsv, CSV_EJEMPLO, type CsvLeido } from "@/lib/csv";

/**
 * Todo lo que hace falta para cargar productos de a miles: la clave para que
 * el ERP se conecte, el CSV para el que no tiene ERP, y cómo se usa la API.
 *
 * Nació de un comerciante con dos mil productos ya comprados que quería verlos
 * en su tienda online sin cargarlos de a uno.
 */

interface Resumen {
  actualizar: number; vincular: number; crear_b2b: number; crear_propio: number;
  error: number; sinPrecio: number;
}
interface Importacion {
  id: string;
  estado: "analizando" | "lista" | "aplicando" | "aplicada" | "error";
  archivo: string | null;
  total: number;
  procesadas: number;
  resumen: Resumen | null;
  error: string | null;
  errores: { fila: number; ean: string | null; nombre: string; motivo: string }[];
  muestra: {
    fila: number; accion: string; ean: string | null; nombre: string;
    precio: number | null; precioAntes: number | null; stock: number | null; stockAntes: number | null;
  }[];
}

const ACCION: Record<string, string> = {
  actualizar: "Ya lo tenés: se actualiza",
  vincular: "Nuevo, ya estaba en NexoPOS",
  crear_b2b: "Nuevo, con ficha de NexoB2B",
  crear_propio: "Nuevo, como producto propio",
};

const BASE_DOCS = "https://nexopos.app/docs/api";

export default function IntegracionPage() {
  const [error, setError] = useState("");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <Link href="/productos" className="muted" style={{ fontSize: 13 }}>← Productos</Link>
      </div>
      <h1 style={{ marginBottom: 4 }}>Integración API</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Cargá tus productos de a miles: con un archivo CSV, o conectando tu sistema (ERP, Odoo)
        para que mantenga precios y stock al día solo.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <ClavesApi onError={setError} />
        <ImportarCsv onError={setError} />
      </div>

      <DocumentacionRapida />
    </div>
  );
}

// ── El CSV ──────────────────────────────────────────────────────────────────

function ImportarCsv({ onError }: { onError: (m: string) => void }) {
  const [leido, setLeido] = useState<(CsvLeido & { archivo: string }) | null>(null);
  const [imp, setImp] = useState<Importacion | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Mientras se analiza, se pregunta el avance. Con dos mil productos que
  // NexoPOS no conoce, buscar sus fichas en NexoB2B tarda unos minutos.
  useEffect(() => {
    if (!imp || imp.estado !== "analizando") return;
    const t = setTimeout(async () => {
      try { setImp(await api<Importacion>(`/api/importaciones/${imp.id}`)); }
      catch (err) { onError(err instanceof Error ? err.message : "Se perdió la conexión"); }
    }, 1500);
    return () => clearTimeout(t);
  }, [imp, onError]);

  async function elegir(archivo: File | undefined) {
    onError("");
    setImp(null);
    if (!archivo) return;
    const r = leerCsv(decodificar(await archivo.arrayBuffer()));
    setLeido({ ...r, archivo: archivo.name });
    if (r.problema) onError(r.problema);
  }

  async function analizar() {
    if (!leido) return;
    onError("");
    try {
      const { id } = await api<{ id: string }>("/api/importaciones", {
        method: "POST", body: JSON.stringify({ archivo: leido.archivo, filas: leido.filas }),
      });
      setImp(await api<Importacion>(`/api/importaciones/${id}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo subir el archivo");
    }
  }

  async function aplicar() {
    if (!imp) return;
    setAplicando(true);
    onError("");
    try {
      setImp(await api<Importacion>(`/api/importaciones/${imp.id}/aplicar`, { method: "POST" }));
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo importar");
    } finally {
      setAplicando(false);
    }
  }

  function otra() {
    setLeido(null);
    setImp(null);
    if (input.current) input.current.value = "";
  }

  function descargarEjemplo() {
    const url = URL.createObjectURL(new Blob([CSV_EJEMPLO], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "productos-ejemplo.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const r = imp?.resumen;
  const aImportar = r ? r.actualizar + r.vincular + r.crear_b2b + r.crear_propio : 0;

  return (
    <div className="card" style={{ flex: 1, minWidth: 360 }}>
      <h2>Importar productos desde un CSV</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        Sirve para cargar todo lo que ya tenés en el local, y el mismo archivo sirve después
        para actualizar precios y stock de una vez. Con <strong>precio</strong> el producto queda
        listo para vender en el mostrador y en tu tienda; sin precio se carga, pero no se vende.
      </p>

      <div style={{ background: "var(--bg, #f6f7f9)", borderRadius: 6, padding: "8px 10px", fontSize: 12, marginBottom: 10 }}>
        <div><strong>Columnas:</strong>{" "}
          <code>ean</code>, <code>nombre</code>, <code>precio</code>, <code>costo</code>,{" "}
          <code>stock</code>, <code>stock_minimo</code>
        </div>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          <li>Hace falta el <strong>EAN</strong> o el <strong>nombre</strong>. Con EAN, buscamos la ficha en
            NexoB2B (nombre, foto, rubro); si no está, se crea como producto tuyo con el nombre del archivo.</li>
          <li>Sin código de barras: dejá el EAN vacío o escribí <code>NXB</code>.</li>
          <li>El <strong>stock reemplaza</strong>: si el archivo dice 12, quedan 12. Subir el mismo archivo
            dos veces no duplica nada.</li>
          <li>Una celda vacía no borra: deja lo que había.</li>
          <li>Los números como en Excel: <code>1.500</code> o <code>1500,50</code>.</li>
        </ul>
        <button type="button" className="ghost" style={{ fontSize: 12, marginTop: 6 }} onClick={descargarEjemplo}>
          ⬇ Bajar un archivo de ejemplo
        </button>
      </div>

      {!imp && (
        <>
          <input ref={input} type="file" accept=".csv,text/csv" onChange={(e) => elegir(e.target.files?.[0])} />
          {leido && !leido.problema && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <p style={{ margin: "0 0 4px" }}>
                <strong>{leido.filas.length.toLocaleString("es-AR")}</strong> productos en{" "}
                <em>{leido.archivo}</em>.
              </p>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
                Tomamos: {Object.entries(leido.columnas).map(([c, h]) => `${h} → ${c}`).join(" · ")}
              </p>
              {leido.ignoradas.length > 0 && (
                <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
                  No usamos: {leido.ignoradas.join(", ")}
                </p>
              )}
              <button type="button" onClick={analizar} disabled={leido.filas.length === 0}>
                Revisar antes de importar
              </button>
            </div>
          )}
        </>
      )}

      {imp?.estado === "analizando" && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 13, margin: "0 0 6px" }}>
            Buscando tus productos… {imp.procesadas.toLocaleString("es-AR")} de {imp.total.toLocaleString("es-AR")}
          </p>
          <div style={{ height: 8, background: "var(--border)", borderRadius: 4 }}>
            <div style={{ height: 8, borderRadius: 4, background: "var(--primary)",
                          width: `${Math.round((imp.procesadas / Math.max(imp.total, 1)) * 100)}%` }} />
          </div>
          <p className="muted" style={{ fontSize: 11 }}>
            Con muchos productos nuevos tarda unos minutos: buscamos cada ficha en el catálogo de NexoB2B.
            Podés esperar acá; todavía no se cambió nada.
          </p>
        </div>
      )}

      {imp?.estado === "error" && (
        <div style={{ marginTop: 10 }}>
          <p className="error">{imp.error}</p>
          <button type="button" className="ghost" onClick={otra}>Subir otro archivo</button>
        </div>
      )}

      {(imp?.estado === "lista" || imp?.estado === "aplicando" || imp?.estado === "aplicada") && r && (
        <div style={{ marginTop: 10 }}>
          {imp.estado === "aplicada" ? (
            <p className="badge ok" style={{ display: "block", fontSize: 13 }}>
              Listo: se importaron {aImportar.toLocaleString("es-AR")} productos.
            </p>
          ) : (
            <p style={{ fontSize: 13, margin: "0 0 6px" }}><strong>Esto es lo que va a pasar.</strong> Todavía no se cambió nada.</p>
          )}
          <ul style={{ fontSize: 13, margin: "0 0 8px", paddingLeft: 18 }}>
            {r.actualizar > 0 && <li>{r.actualizar.toLocaleString("es-AR")} que ya tenés se actualizan</li>}
            {r.crear_b2b > 0 && <li>{r.crear_b2b.toLocaleString("es-AR")} nuevos con la ficha de NexoB2B (nombre, foto, rubro)</li>}
            {r.vincular > 0 && <li>{r.vincular.toLocaleString("es-AR")} nuevos que ya estaban en NexoPOS</li>}
            {r.crear_propio > 0 && <li>{r.crear_propio.toLocaleString("es-AR")} nuevos como productos propios, con el nombre del archivo y sin foto</li>}
            {r.sinPrecio > 0 && <li><strong>{r.sinPrecio.toLocaleString("es-AR")} sin precio</strong>: se cargan, pero no se venden hasta que les pongas uno</li>}
            {r.error > 0 && <li style={{ color: "var(--danger)" }}>{r.error.toLocaleString("es-AR")} con errores: no se importan (están abajo)</li>}
          </ul>

          {imp.estado !== "aplicada" ? (
            <div className="toolbar">
              <button type="button" onClick={aplicar} disabled={aplicando || aImportar === 0}>
                {aplicando ? "Importando…" : `Importar ${aImportar.toLocaleString("es-AR")} productos`}
              </button>
              <button type="button" className="ghost" onClick={otra} disabled={aplicando}>Cancelar</button>
            </div>
          ) : (
            <div className="toolbar">
              <Link href="/productos"><button type="button">Ver mis productos</button></Link>
              <button type="button" className="ghost" onClick={otra}>Importar otro archivo</button>
            </div>
          )}

          {imp.errores.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "14px 0 4px" }}>Renglones con errores</h3>
              <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                El número es el renglón del archivo sin contar el encabezado. Corregilos y subí el archivo de nuevo:
                lo que ya entró no se duplica.
              </p>
              <table style={{ fontSize: 12 }}>
                <tbody>
                  {imp.errores.slice(0, 100).map((e) => (
                    <tr key={e.fila}>
                      <td className="muted">{e.fila}</td>
                      <td>{e.nombre || e.ean || "—"}</td>
                      <td style={{ color: "var(--danger)" }}>{e.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {imp.errores.length > 100 && (
                <p className="muted" style={{ fontSize: 12 }}>Y {imp.errores.length - 100} más.</p>
              )}
            </>
          )}

          {imp.muestra.length > 0 && imp.estado !== "aplicada" && (
            <>
              <h3 style={{ fontSize: 14, margin: "14px 0 4px" }}>
                Los primeros {Math.min(imp.muestra.length, 50)}
              </h3>
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr><th>Producto</th><th>Qué pasa</th><th className="num">Precio</th><th className="num">Stock</th></tr>
                </thead>
                <tbody>
                  {imp.muestra.map((m) => (
                    <tr key={m.fila}>
                      <td>{m.nombre}</td>
                      <td className="muted">{ACCION[m.accion] ?? m.accion}</td>
                      <td className="num">
                        {m.precio === null ? (m.precioAntes == null ? "sin precio" : `${money(m.precioAntes)} (igual)`)
                          : m.precioAntes != null && m.precioAntes !== m.precio
                            ? `${money(m.precioAntes)} → ${money(m.precio)}` : money(m.precio)}
                      </td>
                      <td className="num">
                        {m.stock === null ? "igual"
                          : m.stockAntes != null && m.stockAntes !== m.stock ? `${m.stockAntes} → ${m.stock}` : m.stock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── La API, en corto ────────────────────────────────────────────────────────

const ENDPOINTS: { metodo: string; ruta: string; para: string }[] = [
  { metodo: "GET", ruta: "/productos?page=1", para: "Lo que tenés cargado, con precio y stock, de a 500" },
  { metodo: "POST", ruta: "/productos", para: "Alta masiva: hasta 5.000 por llamada, igual que el CSV" },
  { metodo: "GET", ruta: "/importaciones/:id", para: "En qué quedó un alta masiva" },
  { metodo: "PUT", ruta: "/precios", para: "Cambiar precios de venta, de a 1.000" },
  { metodo: "PUT", ruta: "/stock", para: "Ajustar o fijar el stock, de a 1.000" },
  { metodo: "GET", ruta: "/ventas?desde=…", para: "Lo que se vendió en el mostrador y la tienda" },
];

const EJEMPLO_ALTA = `curl -X POST https://nexopos.app/api/erp/v1/productos \\
  -H "Authorization: Bearer npos_…" \\
  -H "Content-Type: application/json" \\
  -d '{"productos": [
        {"ean": "7790070507341", "precio_centavos": 399900, "stock": 12},
        {"nombre": "Tarta de verdura", "precio_centavos": 550000}
      ]}'

→ 202 {"importacion_id": "41", "estado": "analizando"}`;

function DocumentacionRapida() {
  return (
    <div className="card">
      <h2>La API, en corto</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        Para quien programe tu sistema. Todo va a <code>https://nexopos.app/api/erp/v1</code> con la clave
        en el encabezado <code>Authorization: Bearer npos_…</code>. Los productos se identifican por
        EAN (o por código de balanza). Los importes van en <strong>centavos</strong>, enteros.
      </p>
      <table style={{ fontSize: 12 }}>
        <tbody>
          {ENDPOINTS.map((e) => (
            <tr key={e.metodo + e.ruta}>
              <td><code>{e.metodo}</code></td>
              <td><code>{e.ruta}</code></td>
              <td className="muted">{e.para}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: 14, margin: "14px 0 4px" }}>Dar de alta productos</h3>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 6px" }}>
        Contesta enseguida con un número de importación y sigue en segundo plano: con miles de productos
        nuevos, buscar sus fichas en NexoB2B tarda unos minutos. Preguntá en qué quedó con{" "}
        <code>GET /importaciones/:id</code> hasta que diga <code>aplicada</code>.
      </p>
      <pre style={{ fontSize: 11, background: "#0f172a", color: "#e2e8f0", padding: 10, borderRadius: 6, overflowX: "auto" }}>
        {EJEMPLO_ALTA}
      </pre>

      <h3 style={{ fontSize: 14, margin: "14px 0 4px" }}>Una sola regla para el stock</h3>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Si además vendés por el mostrador, no mandes el stock absoluto a cada rato: pisarías las ventas que
        el ERP todavía no vio. Leé <code>/ventas</code> y mandá <code>ajuste</code>. El absoluto es para la
        carga inicial y después de contar.
      </p>

      <a href={BASE_DOCS} target="_blank" rel="noreferrer"
        style={{ display: "inline-block", marginTop: 14, fontSize: 14, fontWeight: 600 }}>
        Documentación completa de la API ↗
      </a>
      <p className="muted" style={{ fontSize: 11, marginTop: 2 }}>
        Con todos los campos, los errores y ejemplos. Se lee sin cuenta: pasale el link a quien programe.
      </p>
    </div>
  );
}

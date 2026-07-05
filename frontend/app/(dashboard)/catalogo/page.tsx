"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, money } from "@/lib/api";
import { addToCart } from "@/lib/cart";
import type { B2BProducto, B2BListing, B2BPresentacion, B2BMayorista } from "@/lib/b2b-types";

interface Taxonomia { rubros: { id: string; nombre: string }[] }

export default function CatalogoPage() {
  const [q, setQ] = useState("");
  const [rubroId, setRubroId] = useState("");
  const [mayoristaId, setMayoristaId] = useState("");
  const [rubros, setRubros] = useState<Taxonomia["rubros"]>([]);
  const [mayoristas, setMayoristas] = useState<B2BMayorista[]>([]);
  const [productos, setProductos] = useState<B2BProducto[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Taxonomia>("/api/catalog/taxonomia").then((t) => setRubros(t.rubros)).catch(console.error);
    api<{ mayoristas: B2BMayorista[] }>("/api/mayoristas").then((d) => setMayoristas(d.mayoristas)).catch(console.error);
  }, []);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (rubroId) params.set("rubro_id", rubroId);
      if (mayoristaId) params.set("mayorista_id", mayoristaId);
      const data = await api<{ productos: B2BProducto[] }>(`/api/catalog?${params}`);
      setProductos(data.productos);
    } finally {
      setLoading(false);
    }
  }, [q, rubroId, mayoristaId]);

  useEffect(() => {
    const t = setTimeout(() => { search().catch(console.error); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function agregarAlCarrito(producto: B2BProducto, listing: B2BListing, pres: B2BPresentacion) {
    addToCart({
      presentacionId: pres.id,
      mayoristaId: listing.mayorista_id,
      mayoristaNombre: listing.mayorista_nombre,
      cantidad: 1,
      precio: pres.precio,
      meta: {
        productoNombre: producto.nombre,
        presentacionNombre: pres.nombre,
        ean: pres.ean_propio ?? producto.ean,
        marca: producto.marca,
        rubroNombre: producto.rubro_nombre,
        imagenUrl: producto.imagen_url,
        alicuotaIva: producto.alicuota_iva,
        factor: pres.factor,
      },
    });
    setMessage(`"${producto.nombre} — ${pres.nombre}" agregado al carrito (ver Compras)`);
    setTimeout(() => setMessage(""), 3000);
  }

  return (
    <div>
      <h1>Catálogo NexoB2B</h1>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, marca o EAN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={rubroId} onChange={(e) => setRubroId(e.target.value)}>
          <option value="">Todos los rubros</option>
          {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        <select value={mayoristaId} onChange={(e) => setMayoristaId(e.target.value)}>
          <option value="">Todos los mayoristas</option>
          {mayoristas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}{m.solicitud?.estado === "aceptado" ? "" : " (sin alta)"}
            </option>
          ))}
        </select>
        {loading && <span className="muted">Buscando…</span>}
        <span className="muted">{productos.length} productos</span>
      </div>
      {message && <p className="badge ok">{message}</p>}

      <div className="card">
        <table>
          <thead>
            <tr><th></th><th>Producto</th><th>Marca</th><th>Rubro</th><th className="num">Desde</th><th className="num">Mayoristas</th><th></th></tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <ProductoRow
                key={p.id}
                producto={p}
                expanded={expanded === p.id}
                onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
                onAdd={agregarAlCarrito}
              />
            ))}
            {productos.length === 0 && !loading && (
              <tr><td colSpan={7} className="muted">Sin resultados. Probá con otra búsqueda o filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductoRow({ producto, expanded, onToggle, onAdd }: {
  producto: B2BProducto;
  expanded: boolean;
  onToggle: () => void;
  onAdd: (p: B2BProducto, l: B2BListing, pres: B2BPresentacion) => void;
}) {
  const precios = producto.mayoristas.flatMap((m) => m.presentaciones.map((pr) => pr.precio / (pr.factor || 1)));
  const desde = precios.length ? Math.min(...precios) : null;

  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td style={{ width: 44 }}>
          {producto.imagen_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={producto.imagen_url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} />
            : <span style={{ fontSize: 22 }}>📦</span>}
        </td>
        <td>
          <strong>{producto.nombre}</strong>
          {producto.ean && <span className="muted"> · {producto.ean}</span>}
        </td>
        <td>{producto.marca ?? "—"}</td>
        <td>{producto.rubro_nombre ?? "—"}</td>
        <td className="num">{desde !== null ? `${money(desde)}/u` : "—"}</td>
        <td className="num">{producto.mayoristas.length}</td>
        <td><button className="small secondary">{expanded ? "Ocultar" : "Ver ofertas"}</button></td>
      </tr>
      {expanded && producto.mayoristas.map((listing) => (
        <tr key={listing.listing_id}>
          <td></td>
          <td colSpan={6} style={{ background: "#f9fafb" }}>
            <div className="toolbar" style={{ marginBottom: 4 }}>
              <strong>{listing.mayorista_nombre}</strong>
              {listing.tiene_alta
                ? <span className="badge ok">con alta</span>
                : <span className="badge warn">sin alta — <Link href="/mayoristas">solicitar</Link></span>}
            </div>
            <table>
              <thead>
                <tr><th>Presentación</th><th className="num">Precio</th><th className="num">Precio lista</th><th className="num">Stock</th><th></th></tr>
              </thead>
              <tbody>
                {listing.presentaciones.map((pres) => (
                  <tr key={pres.id}>
                    <td>{pres.nombre}{pres.factor > 1 && <span className="muted"> (x{pres.factor})</span>}</td>
                    <td className="num"><strong>{money(pres.precio)}</strong></td>
                    <td className="num muted">{pres.precio_lista ? money(pres.precio_lista) : "—"}</td>
                    <td className="num">{pres.stock ?? "disponible"}</td>
                    <td>
                      {listing.tiene_alta && (
                        <button className="small" onClick={() => onAdd(producto, listing, pres)}>
                          Agregar al carrito
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ))}
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { api, money } from "@/lib/api";

interface Product {
  id: number; ean: string; name: string; brand: string | null;
  category: string | null; unit: string; best_price: string | null; offer_count: string;
}
interface Offer {
  id: number; wholesaler_id: string; wholesaler_name: string; price: string;
  currency: string; min_qty: number; available_stock: number | null; conditions: string | null;
}
export interface CartLine { productId: number; name: string; wholesalerId: string; wholesalerName: string; quantity: number; unitPrice: number; minQty: number }

export default function CatalogoPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [message, setMessage] = useState("");

  const search = useCallback(async () => {
    const params = new URLSearchParams({ q, category, page: String(page), pageSize: "25" });
    const data = await api<{ total: number; products: Product[] }>(`/api/catalog?${params}`);
    setProducts(data.products);
    setTotal(data.total);
  }, [q, category, page]);

  useEffect(() => { search().catch(console.error); }, [search]);
  useEffect(() => { api<string[]>("/api/catalog/categories").then(setCategories).catch(console.error); }, []);

  async function toggleOffers(productId: number) {
    if (expanded === productId) { setExpanded(null); return; }
    setOffers(await api<Offer[]>(`/api/catalog/${productId}/offers`));
    setExpanded(productId);
  }

  function addToCart(product: Product, offer: Offer) {
    const raw = localStorage.getItem("nexopos_purchase_cart");
    const cart: CartLine[] = raw ? JSON.parse(raw) : [];
    const existing = cart.find(
      (l) => l.productId === product.id && l.wholesalerId === offer.wholesaler_id
    );
    if (existing) existing.quantity += offer.min_qty;
    else cart.push({
      productId: product.id, name: product.name,
      wholesalerId: offer.wholesaler_id, wholesalerName: offer.wholesaler_name,
      quantity: offer.min_qty, unitPrice: Number(offer.price), minQty: offer.min_qty,
    });
    localStorage.setItem("nexopos_purchase_cart", JSON.stringify(cart));
    setMessage(`"${product.name}" agregado al carrito de compras (ver Compras)`);
    setTimeout(() => setMessage(""), 3000);
  }

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div>
      <h1>Catálogo NexoB2B</h1>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre o EAN…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="muted">{total} productos</span>
      </div>
      {message && <p className="badge ok">{message}</p>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>EAN</th><th>Producto</th><th>Marca</th><th>Categoría</th>
              <th className="num">Mejor precio</th><th className="num">Ofertas</th><th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <PRow
                key={p.id} p={p}
                expanded={expanded === p.id} offers={offers}
                onToggle={() => toggleOffers(p.id)}
                onAdd={(offer) => addToCart(p, offer)}
              />
            ))}
          </tbody>
        </table>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Anterior</button>
          <span className="muted">Página {page} de {pages}</span>
          <button className="secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente →</button>
        </div>
      </div>
    </div>
  );
}

function PRow({ p, expanded, offers, onToggle, onAdd }: {
  p: Product; expanded: boolean; offers: Offer[];
  onToggle: () => void; onAdd: (o: Offer) => void;
}) {
  return (
    <>
      <tr>
        <td className="muted">{p.ean}</td>
        <td>{p.name}</td>
        <td>{p.brand}</td>
        <td>{p.category}</td>
        <td className="num">{p.best_price ? money(p.best_price) : "—"}</td>
        <td className="num">{p.offer_count}</td>
        <td>
          <button className="small secondary" onClick={onToggle}>
            {expanded ? "Ocultar" : "Ver ofertas"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ background: "#f9fafb" }}>
            <table>
              <thead>
                <tr>
                  <th>Mayorista</th><th className="num">Precio</th><th className="num">Mínimo</th>
                  <th className="num">Stock disp.</th><th>Condiciones</th><th></th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <td>{o.wholesaler_name}</td>
                    <td className="num">{money(o.price)}</td>
                    <td className="num">{o.min_qty}</td>
                    <td className="num">{o.available_stock ?? "—"}</td>
                    <td className="muted">{o.conditions ?? "—"}</td>
                    <td><button className="small" onClick={() => onAdd(o)}>Agregar al carrito</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

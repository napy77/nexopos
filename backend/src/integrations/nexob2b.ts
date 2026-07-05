import { config } from "../config.js";
import { pool } from "../db.js";

/**
 * Cliente de la API de NexoB2B (backend Medusa).
 *
 * Con NEXOB2B_API_URL configurado, habla con la API real. Sin configurar,
 * corre en MODO MOCK: catálogo de ejemplo, ofertas simuladas y login demo,
 * para poder desarrollar el POS sin depender del entorno de NexoB2B.
 *
 * Los endpoints reales (a ajustar cuando se integre):
 *   POST {url}/auth/login                      → { commerce, token }
 *   GET  {url}/catalog/products?updated_since= → productos normalizados con EAN
 *   GET  {url}/catalog/offers?updated_since=   → ofertas de mayoristas
 *   POST {url}/orders                          → crea orden de compra
 */

export interface NexoProduct {
  id: string;
  ean: string;
  name: string;
  brand: string | null;
  category: string | null;
  unit: string;
  imageUrl?: string | null;
}

export interface NexoOffer {
  productId: string; // nexob2b_id del producto
  wholesalerId: string;
  wholesalerName: string;
  price: number;
  currency: string;
  minQty: number;
  availableStock: number | null;
  conditions: string | null;
}

export interface NexoCommerce {
  id: string;
  name: string;
  email: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.nexob2b.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.nexob2b.apiKey}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`NexoB2B API ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export const isMockMode = (): boolean => config.nexob2b.apiUrl === null;

// ── Autenticación ─────────────────────────────────────────────────────────────

export async function verifyCredentials(
  email: string,
  password: string
): Promise<NexoCommerce | null> {
  if (isMockMode()) {
    // Modo demo: cualquier email con password "demo"
    if (password !== "demo") return null;
    return { id: `mock-${email}`, name: email.split("@")[0], email };
  }
  try {
    const data = await api<{ commerce: NexoCommerce }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return data.commerce;
  } catch {
    return null;
  }
}

// ── Catálogo ──────────────────────────────────────────────────────────────────

const MOCK_CATEGORIES = ["Almacén", "Bebidas", "Limpieza", "Perfumería", "Lácteos", "Golosinas"];
const MOCK_BRANDS = ["La Serenísima", "Arcor", "Coca-Cola", "Unilever", "Quilmes", "Molinos"];

function mockCatalog(count = 200): { products: NexoProduct[]; offers: NexoOffer[] } {
  const products: NexoProduct[] = [];
  const offers: NexoOffer[] = [];
  for (let i = 1; i <= count; i++) {
    const cat = MOCK_CATEGORIES[i % MOCK_CATEGORIES.length];
    const brand = MOCK_BRANDS[i % MOCK_BRANDS.length];
    const id = `mock-prod-${i}`;
    products.push({
      id,
      ean: String(7790000000000 + i),
      name: `${cat} ${brand} producto ${i}`,
      brand,
      category: cat,
      unit: "unidad",
    });
    // 1 a 3 ofertas de mayoristas por producto
    const numOffers = 1 + (i % 3);
    for (let w = 1; w <= numOffers; w++) {
      const base = 100 + (i % 50) * 20;
      offers.push({
        productId: id,
        wholesalerId: `mock-mayorista-${w}`,
        wholesalerName: `Mayorista Demo ${w}`,
        price: Math.round(base * (1 + w * 0.05) * 100) / 100,
        currency: "ARS",
        minQty: w * 6,
        availableStock: 500 - i % 100,
        conditions: w === 1 ? "Entrega 48hs" : null,
      });
    }
  }
  return { products, offers };
}

/**
 * Sincroniza catálogo y ofertas de NexoB2B hacia la cache local.
 * Se ejecuta al iniciar y luego cada CATALOG_SYNC_INTERVAL_MIN minutos.
 */
export async function syncCatalog(): Promise<{ products: number; offers: number }> {
  const { products, offers } = isMockMode()
    ? mockCatalog()
    : {
        products: await api<NexoProduct[]>("/catalog/products"),
        offers: await api<NexoOffer[]>("/catalog/offers"),
      };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of products) {
      await client.query(
        `INSERT INTO products (nexob2b_id, ean, name, brand, category, unit, image_url, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (nexob2b_id) DO UPDATE SET
           ean = EXCLUDED.ean, name = EXCLUDED.name, brand = EXCLUDED.brand,
           category = EXCLUDED.category, unit = EXCLUDED.unit,
           image_url = EXCLUDED.image_url, synced_at = now()`,
        [p.id, p.ean, p.name, p.brand, p.category, p.unit, p.imageUrl ?? null]
      );
    }
    for (const o of offers) {
      await client.query(
        `INSERT INTO wholesaler_offers
           (product_id, wholesaler_id, wholesaler_name, price, currency, min_qty, available_stock, conditions, synced_at)
         SELECT id, $2, $3, $4, $5, $6, $7, $8, now() FROM products WHERE nexob2b_id = $1
         ON CONFLICT (product_id, wholesaler_id) DO UPDATE SET
           wholesaler_name = EXCLUDED.wholesaler_name, price = EXCLUDED.price,
           currency = EXCLUDED.currency, min_qty = EXCLUDED.min_qty,
           available_stock = EXCLUDED.available_stock, conditions = EXCLUDED.conditions,
           synced_at = now()`,
        [o.productId, o.wholesalerId, o.wholesalerName, o.price, o.currency, o.minQty, o.availableStock, o.conditions]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { products: products.length, offers: offers.length };
}

// ── Órdenes de compra ─────────────────────────────────────────────────────────

export async function pushOrder(order: {
  commerceNexoId: string | null;
  wholesalerId: string;
  items: { productNexoId: string | null; quantity: number; unitPrice: number }[];
}): Promise<string> {
  if (isMockMode()) {
    return `mock-order-${Date.now()}`;
  }
  const data = await api<{ id: string }>("/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
  return data.id;
}

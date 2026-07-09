import { config } from "../config.js";
import { HttpError } from "../middleware/error.js";

/**
 * Cliente de la API de NexoB2B (backend Medusa en https://nexob2b.app).
 *
 * Autenticación: JWT por comercio (dura 30 días), obtenido en
 * POST /store/comercios/auth y guardado en commerces.nexob2b_token.
 * Todas las rutas /store/* requieren además el header
 * x-publishable-api-key (NEXOB2B_PUBLISHABLE_KEY).
 *
 * Sin NEXOB2B_API_URL configurada corre en MODO MOCK, que replica las
 * formas exactas de la API real (login demo: cualquier email / "demo").
 */

// ── Tipos (espejo de la API) ──────────────────────────────────────────────────

export interface B2BComercio {
  id: string;
  nombre: string;
  email: string;
  estado: string;
  ciudad?: string | null;
  provincia?: string | null;
}

export interface B2BPresentacion {
  id: string;               // pmp_xxx ← presentacion_id para crear órdenes
  nombre: string;           // "Bidón 5L"
  factor: number;
  ean_propio: string | null;
  precio: number;
  precio_lista: number | null;
  stock: number | null;     // null = el mayorista no gestiona stock
}

export interface B2BListing {
  listing_id: string;
  mayorista_id: string;
  mayorista_nombre: string;
  mayorista_logo: string | null;
  tiene_alta: boolean;
  presentaciones: B2BPresentacion[];
}

export interface B2BProducto {
  id: string;               // pm_xxx (producto maestro)
  ean: string | null;
  nombre: string;
  marca: string | null;
  unidad_base: string | null;
  alicuota_iva: number | null;
  imagen_url: string | null;
  pasillo_id: string | null;
  pasillo_nombre: string | null;
  rubro_id: string | null;
  rubro_nombre: string | null;
  subrubro_id: string | null;
  subrubro_nombre: string | null;
  mayoristas: B2BListing[];
}

export interface B2BMayorista {
  id: string;
  nombre: string;
  ciudad: string | null;
  provincia: string | null;
  rubros: string[];
  logo_url: string | null;
  distancia_km?: number | null;
  solicitud: { id: string; estado: "pendiente" | "aceptado" | "rechazado" } | null;
  contacto: { nombre: string; celular: string | null; email: string | null; es_vendedor: boolean } | null;
}

export interface B2BMedioPago {
  id: string;
  nombre: string;
  tipo: string;
  icono: string | null;
  descripcion?: string | null;
  porcentaje_costo: number;
}

export interface B2BOrdenItem {
  id: string;
  nombre: string;
  ean: string | null;
  cantidad: number;
  precio_unitario: number;
  alicuota_iva: number | null;
  unidad: string | null;
  subtotal_neto: number;
  subtotal_iva: number;
  subtotal: number;
}

export interface B2BOrden {
  id: string;
  numero: number;
  estado: string;           // cargada|confirmada|en_preparacion|despachada|entregada|devuelto|cancelada
  total_neto: number;
  total_iva: number;
  total: number;
  costo_medio_pago: number;
  medio_pago_nombre?: string | null;
  notas: string | null;
  is_pagada?: boolean;
  is_facturada?: boolean;
  mayorista_id: string;
  mayorista_nombre?: string | null;
  created_at: string;
  items: B2BOrdenItem[];
}

export interface B2BTaxonomia {
  pasillos: { id: string; nombre: string }[];
  rubros: { id: string; nombre: string; pasillo_id: string | null }[];
  subrubros: { id: string; nombre: string; rubro_id: string }[];
  alicuotas: { id: string; porcentaje: number }[];
}

export const isMockMode = (): boolean => config.nexob2b.apiUrl === null;

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function api<T>(path: string, opts: { token?: string; method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-publishable-api-key": config.nexob2b.publishableKey,
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${config.nexob2b.apiUrl}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    // Falla de red (DNS, NAT hairpin, servicio caído): no es un 500 nuestro
    const detail = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : "error de red";
    throw new HttpError(502, `No se pudo conectar con NexoB2B: ${detail}`);
  }

  if (!res.ok) {
    let message = `NexoB2B respondió ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      message = data.error ?? data.message ?? message;
    } catch { /* cuerpo no JSON */ }
    if (res.status === 401)
      throw new HttpError(401, "Sesión de NexoB2B expirada. Volvé a iniciar sesión.");
    throw new HttpError(res.status >= 500 ? 502 : res.status, message);
  }
  return res.json() as Promise<T>;
}

// ── Mock: datos y estado en memoria ──────────────────────────────────────────

const MOCK_MAYORISTAS: B2BMayorista[] = [
  {
    id: "may_mock_1", nombre: "Distribuidora El Sol", ciudad: "Córdoba", provincia: "Córdoba",
    rubros: ["almacen", "limpieza"], logo_url: null, distancia_km: 3.2,
    solicitud: { id: "sol_mock_1", estado: "aceptado" },
    contacto: { nombre: "Pedro Gómez", celular: "+5493512345678", email: "pedro@elsol.com", es_vendedor: true },
  },
  {
    id: "may_mock_2", nombre: "Mayorista Norte", ciudad: "Córdoba", provincia: "Córdoba",
    rubros: ["almacen", "bebidas"], logo_url: null, distancia_km: 8.5,
    solicitud: { id: "sol_mock_2", estado: "aceptado" },
    contacto: { nombre: "Ana Ruiz", celular: "+5493511111111", email: "ana@norte.com", es_vendedor: false },
  },
  {
    id: "may_mock_3", nombre: "Distribuciones del Centro", ciudad: "Villa María", provincia: "Córdoba",
    rubros: ["perfumeria", "limpieza"], logo_url: null, distancia_km: 42,
    solicitud: null, contacto: null,
  },
];

const MOCK_PASILLOS = [
  { id: "pas_1", nombre: "Almacén" },
  { id: "pas_2", nombre: "Bebidas" },
  { id: "pas_3", nombre: "Limpieza y Perfumería" },
];
const MOCK_RUBROS = [
  { id: "rub_1", nombre: "Almacén", pasillo_id: "pas_1" },
  { id: "rub_2", nombre: "Bebidas", pasillo_id: "pas_2" },
  { id: "rub_3", nombre: "Limpieza", pasillo_id: "pas_3" },
  { id: "rub_4", nombre: "Perfumería", pasillo_id: "pas_3" },
];
const MOCK_SUBRUBROS = [
  { id: "sub_1a", nombre: "Aceites", rubro_id: "rub_1" },
  { id: "sub_1b", nombre: "Conservas", rubro_id: "rub_1" },
  { id: "sub_2a", nombre: "Gaseosas", rubro_id: "rub_2" },
  { id: "sub_2b", nombre: "Vinos", rubro_id: "rub_2" },
  { id: "sub_3a", nombre: "Hogar", rubro_id: "rub_3" },
  { id: "sub_3b", nombre: "Ropa", rubro_id: "rub_3" },
  { id: "sub_4a", nombre: "Cabello", rubro_id: "rub_4" },
  { id: "sub_4b", nombre: "Piel", rubro_id: "rub_4" },
];
const MOCK_MARCAS = ["Cocinero", "Arcor", "Coca-Cola", "Ala", "Quilmes", "Molinos"];

function mockProductos(): B2BProducto[] {
  const productos: B2BProducto[] = [];
  for (let i = 1; i <= 60; i++) {
    const rubro = MOCK_RUBROS[i % MOCK_RUBROS.length];
    const subrubros = MOCK_SUBRUBROS.filter((s) => s.rubro_id === rubro.id);
    const subrubro = subrubros[i % subrubros.length];
    const pasillo = MOCK_PASILLOS.find((p) => p.id === rubro.pasillo_id)!;
    const marca = MOCK_MARCAS[i % MOCK_MARCAS.length];
    // mayorista 1 y 2 (con alta); el 3 (sin alta) lista algunos productos
    const listados = i % 5 === 0 ? ["may_mock_1", "may_mock_3"] : i % 2 === 0 ? ["may_mock_1"] : ["may_mock_1", "may_mock_2"];
    productos.push({
      id: `pm_mock_${i}`,
      ean: String(7790000000000 + i),
      nombre: `${rubro.nombre} ${marca} producto ${i}`,
      marca,
      unidad_base: "Unidades",
      alicuota_iva: i % 3 === 0 ? 10.5 : 21,
      imagen_url: null,
      pasillo_id: pasillo.id,
      pasillo_nombre: pasillo.nombre,
      rubro_id: rubro.id,
      rubro_nombre: rubro.nombre,
      subrubro_id: subrubro.id,
      subrubro_nombre: subrubro.nombre,
      mayoristas: listados.map((mayId, w) => {
        const may = MOCK_MAYORISTAS.find((m) => m.id === mayId)!;
        const base = 500 + (i % 40) * 100 + w * 50;
        return {
          listing_id: `pml_mock_${i}_${w}`,
          mayorista_id: may.id,
          mayorista_nombre: may.nombre,
          mayorista_logo: may.logo_url,
          tiene_alta: may.solicitud?.estado === "aceptado",
          presentaciones: [
            {
              id: `pmp_mock_${i}_${w}_u`, nombre: "Unidad", factor: 1, ean_propio: null,
              precio: base, precio_lista: Math.round(base * 1.05), stock: 300 - (i % 90),
            },
            {
              id: `pmp_mock_${i}_${w}_b`, nombre: "Bulto x12", factor: 12, ean_propio: null,
              precio: Math.round(base * 12 * 0.93), precio_lista: base * 12, stock: 40,
            },
          ],
        };
      }),
    });
  }
  return productos;
}
const MOCK_PRODUCTOS = mockProductos();

const MOCK_MEDIOS_PAGO: B2BMedioPago[] = [
  { id: "mp_mock_1", nombre: "Transferencia Bancaria", tipo: "transferencia", icono: "🏦", descripcion: "Transferir antes de la entrega", porcentaje_costo: 0 },
  { id: "mp_mock_2", nombre: "Mercado Pago", tipo: "online", icono: "💳", descripcion: null, porcentaje_costo: 2.5 },
];

// Órdenes mock en memoria, por comercio
const mockOrdenes = new Map<string, B2BOrden[]>();
let mockOrdenSeq = 1000;

function findPresentacion(presentacionId: string): { producto: B2BProducto; listing: B2BListing; pres: B2BPresentacion } | null {
  for (const producto of MOCK_PRODUCTOS)
    for (const listing of producto.mayoristas)
      for (const pres of listing.presentaciones)
        if (pres.id === presentacionId) return { producto, listing, pres };
  return null;
}

// ── API pública del cliente ───────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<{ token: string; comercio: B2BComercio } | null> {
  if (isMockMode()) {
    if (password !== "demo") return null;
    return {
      token: `mock-token-${email}`,
      comercio: { id: `com_mock_${email}`, nombre: email.split("@")[0], email, estado: "aprobado", ciudad: "Córdoba", provincia: "Córdoba" },
    };
  }
  try {
    return await api<{ token: string; comercio: B2BComercio }>("/store/comercios/auth", {
      method: "POST",
      body: { email, password },
    });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

export async function getTaxonomia(): Promise<B2BTaxonomia> {
  if (isMockMode()) {
    return {
      pasillos: MOCK_PASILLOS,
      rubros: MOCK_RUBROS,
      subrubros: MOCK_SUBRUBROS,
      alicuotas: [{ id: "ali_1", porcentaje: 21 }, { id: "ali_2", porcentaje: 10.5 }],
    };
  }
  return api<B2BTaxonomia>("/store/taxonomia");
}

export async function getMayoristas(token: string, busqueda?: string): Promise<B2BMayorista[]> {
  if (isMockMode()) {
    const term = busqueda?.toLowerCase().trim();
    return MOCK_MAYORISTAS.filter((m) => !term || m.nombre.toLowerCase().includes(term) || m.ciudad?.toLowerCase().includes(term));
  }
  const params = new URLSearchParams();
  if (busqueda) params.set("busqueda", busqueda);
  const qs = params.size ? `?${params}` : "";
  const data = await api<{ mayoristas: B2BMayorista[] }>(`/store/mayoristas/lista${qs}`, { token });
  return data.mayoristas;
}

export async function solicitarAlta(token: string, mayoristaId: string, mensaje: string): Promise<unknown> {
  if (isMockMode()) {
    const may = MOCK_MAYORISTAS.find((m) => m.id === mayoristaId);
    if (!may) throw new HttpError(404, "Mayorista no encontrado");
    if (may.solicitud) throw new HttpError(409, "Ya existe una solicitud con ese mayorista");
    may.solicitud = { id: `sol_mock_${Date.now()}`, estado: "pendiente" };
    return { solicitud: may.solicitud };
  }
  return api("/store/solicitudes", { token, method: "POST", body: { mayorista_id: mayoristaId, mensaje } });
}

export async function getProductos(
  token: string,
  comercioId: string,
  filtros: { q?: string; rubroId?: string; pasilloId?: string; subrubroId?: string; mayoristaId?: string }
): Promise<B2BProducto[]> {
  if (isMockMode()) {
    const term = filtros.q?.toLowerCase().trim();
    return MOCK_PRODUCTOS.filter((p) => {
      if (term && !(p.nombre.toLowerCase().includes(term) || p.ean === filtros.q || p.marca?.toLowerCase().includes(term))) return false;
      if (filtros.rubroId && p.rubro_id !== filtros.rubroId) return false;
      if (filtros.pasilloId && p.pasillo_id !== filtros.pasilloId) return false;
      if (filtros.subrubroId && p.subrubro_id !== filtros.subrubroId) return false;
      if (filtros.mayoristaId && !p.mayoristas.some((m) => m.mayorista_id === filtros.mayoristaId)) return false;
      return true;
    }).slice(0, 100);
  }
  // /store/productos con comercio_id calcula tiene_alta
  const params = new URLSearchParams({ comercio_id: comercioId });
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.rubroId) params.set("rubro_id", filtros.rubroId);
  if (filtros.pasilloId) params.set("pasillo_id", filtros.pasilloId);
  if (filtros.subrubroId) params.set("subrubro_id", filtros.subrubroId);
  if (filtros.mayoristaId) params.set("mayorista_id", filtros.mayoristaId);
  const data = await api<{ productos: B2BProducto[] }>(`/store/productos?${params}`, { token });
  return data.productos;
}

export async function getMediosPago(token: string, mayoristaId: string): Promise<B2BMedioPago[]> {
  if (isMockMode()) return MOCK_MEDIOS_PAGO;
  const data = await api<{ medios_pago: B2BMedioPago[] }>(`/store/mayoristas/${mayoristaId}/medios-pago`, { token });
  return data.medios_pago;
}

export async function crearOrden(
  token: string,
  payload: { mayorista_id: string; items: { presentacion_id: string; cantidad: number }[]; medio_pago_id: string; notas?: string }
): Promise<B2BOrden> {
  if (isMockMode()) {
    const may = MOCK_MAYORISTAS.find((m) => m.id === payload.mayorista_id);
    if (!may) throw new HttpError(400, "mayorista_id no encontrado");
    if (may.solicitud?.estado !== "aceptado")
      throw new HttpError(400, "El comercio no tiene alta aceptada con este mayorista");
    const medio = MOCK_MEDIOS_PAGO.find((m) => m.id === payload.medio_pago_id);
    if (!medio) throw new HttpError(400, "medio_pago_id no encontrado");

    const items: B2BOrdenItem[] = payload.items.map((it, idx) => {
      const found = findPresentacion(it.presentacion_id);
      if (!found) throw new HttpError(400, `presentacion_id no encontrado: ${it.presentacion_id}`);
      const neto = found.pres.precio * it.cantidad;
      const iva = neto * ((found.producto.alicuota_iva ?? 21) / 100);
      return {
        id: `oi_mock_${Date.now()}_${idx}`,
        nombre: `${found.producto.nombre} — ${found.pres.nombre}`,
        ean: found.pres.ean_propio ?? found.producto.ean,
        cantidad: it.cantidad,
        precio_unitario: found.pres.precio,
        alicuota_iva: found.producto.alicuota_iva,
        unidad: found.pres.nombre,
        subtotal_neto: neto,
        subtotal_iva: Math.round(iva * 100) / 100,
        subtotal: Math.round((neto + iva) * 100) / 100,
      };
    });
    const total_neto = items.reduce((a, i) => a + i.subtotal_neto, 0);
    const total_iva = items.reduce((a, i) => a + i.subtotal_iva, 0);
    const costo_medio_pago = Math.round((total_neto + total_iva) * (medio.porcentaje_costo / 100) * 100) / 100;
    const orden: B2BOrden = {
      id: `ord_mock_${Date.now()}`,
      numero: ++mockOrdenSeq,
      estado: "cargada",
      total_neto, total_iva,
      total: Math.round((total_neto + total_iva + costo_medio_pago) * 100) / 100,
      costo_medio_pago,
      medio_pago_nombre: medio.nombre,
      notas: payload.notas ?? null,
      is_pagada: false, is_facturada: false,
      mayorista_id: may.id, mayorista_nombre: may.nombre,
      created_at: new Date().toISOString(),
      items,
    };
    const list = mockOrdenes.get(token) ?? [];
    list.unshift(orden);
    mockOrdenes.set(token, list);
    return orden;
  }
  const data = await api<{ orden: B2BOrden }>("/store/ordenes", { token, method: "POST", body: payload });
  return data.orden;
}

export async function getOrdenes(token: string): Promise<B2BOrden[]> {
  if (isMockMode()) {
    // simular avance de estado: las órdenes viejas van progresando
    const list = mockOrdenes.get(token) ?? [];
    for (const o of list) {
      const ageMin = (Date.now() - new Date(o.created_at).getTime()) / 60000;
      if (o.estado === "cargada" && ageMin > 2) o.estado = "confirmada";
      if (o.estado === "confirmada" && ageMin > 5) o.estado = "despachada";
    }
    return list;
  }
  const data = await api<{ ordenes: B2BOrden[] }>("/store/ordenes", { token });
  return data.ordenes;
}

export async function getOrden(token: string, ordenId: string): Promise<B2BOrden> {
  if (isMockMode()) {
    const orden = (mockOrdenes.get(token) ?? []).find((o) => o.id === ordenId);
    if (!orden) throw new HttpError(404, "Orden no encontrada");
    return orden;
  }
  const data = await api<{ orden: B2BOrden }>(`/store/ordenes/${ordenId}`, { token });
  return data.orden;
}

export async function cancelarOrden(token: string, ordenId: string): Promise<B2BOrden> {
  if (isMockMode()) {
    const orden = (mockOrdenes.get(token) ?? []).find((o) => o.id === ordenId);
    if (!orden) throw new HttpError(404, "Orden no encontrada");
    if (orden.estado !== "cargada" || orden.is_facturada)
      throw new HttpError(400, "Solo se puede cancelar un pedido cargado o devuelto");
    orden.estado = "cancelada";
    return orden;
  }
  const data = await api<{ orden: B2BOrden }>(`/store/ordenes/${ordenId}/cancelar`, { token, method: "PUT" });
  return data.orden;
}

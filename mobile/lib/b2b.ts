/**
 * Lo que el backend reenvía de NexoB2B (catálogo, mayoristas, órdenes). Copia
 * de `frontend/lib/b2b-types.ts`: si cambia uno, cambia el otro.
 */

export interface B2BPresentacion {
  /** id del listing del mayorista: es el que se manda al crear la orden */
  id: string;
  /** id de la presentación maestra: identifica al producto en el stock local */
  presentacion_id?: string;
  nombre: string;
  factor: number;
  ean_propio: string | null;
  /** Neto, sin IVA: con este se arma la orden */
  precio: number;
  precio_lista: number | null;
  stock: number | null;
  muestra_precio?: "neto" | "final";
  precio_final?: number | null;
  precio_mostrar?: number | null;
  precio_lista_mostrar?: number | null;
}

export interface B2BListing {
  listing_id: string;
  mayorista_id: string;
  mayorista_nombre: string;
  tiene_alta: boolean;
  tiempo_entrega_dias?: number | null;
  presentaciones: B2BPresentacion[];
}

interface Taxonomizado {
  pasillo_id: string | null; pasillo_nombre: string | null;
  rubro_id: string | null; rubro_nombre: string | null;
  subrubro_id: string | null; subrubro_nombre: string | null;
}

export interface B2BProducto extends Taxonomizado {
  id: string;
  ean: string | null;
  nombre: string;
  descripcion?: string | null;
  marca: string | null;
  unidad_base: string | null;
  alicuota_iva: number | null;
  imagen_url: string | null;
  mayoristas: B2BListing[];
}

export interface B2BPresentacionMaestra { id: string; nombre: string; factor: number; ean_propio: string | null }

/** Del catálogo maestro: existe aunque ningún mayorista lo venda */
export interface B2BProductoMaestro extends Taxonomizado {
  id: string;
  ean: string | null;
  nombre: string;
  descripcion?: string | null;
  marca: string | null;
  unidad_base: string | null;
  alicuota_iva: number | string | null;
  imagen_url: string | null;
  presentaciones: B2BPresentacionMaestra[] | null;
}

export interface B2BTaxonomia {
  pasillos: { id: string; nombre: string }[];
  rubros: { id: string; nombre: string; pasillo_id: string | null }[];
  subrubros: { id: string; nombre: string; rubro_id: string }[];
}

export interface B2BMedioPago { id: string; nombre: string; icono: string | null; porcentaje_costo: number }

export interface OrdenCompra {
  id: number; wholesaler_name: string; status: string; estado_b2b: string | null;
  numero: string | null; total: string; medio_pago: string | null;
  is_facturada: boolean; created_at: string; received_at: string | null;
}

/** Lo que alcanza para crear el producto local al recibir, sin volver a NexoB2B */
export interface MetaProducto {
  productoNombre: string;
  presentacionNombre: string;
  ean: string | null;
  descripcion: string | null;
  marca: string | null;
  pasilloId: string | null; pasilloNombre: string | null;
  rubroId: string | null; rubroNombre: string | null;
  subrubroId: string | null; subrubroNombre: string | null;
  imagenUrl: string | null;
  alicuotaIva: number | null;
  factor: number;
}

export function metaDe(p: B2BProducto | B2BProductoMaestro, pres: { nombre: string; factor: number; ean_propio: string | null }): MetaProducto {
  return {
    productoNombre: p.nombre,
    presentacionNombre: pres.nombre,
    ean: pres.ean_propio ?? p.ean,
    descripcion: p.descripcion ?? null,
    marca: p.marca,
    pasilloId: p.pasillo_id, pasilloNombre: p.pasillo_nombre,
    rubroId: p.rubro_id, rubroNombre: p.rubro_nombre,
    subrubroId: p.subrubro_id, subrubroNombre: p.subrubro_nombre,
    imagenUrl: p.imagen_url,
    alicuotaIva: p.alicuota_iva != null ? Number(p.alicuota_iva) : null,
    factor: pres.factor,
  };
}

/** Lo que este comercio ve: final o neto, como decide B2B. Sin el campo, el neto. */
export const precioVisible = (p: B2BPresentacion): number => p.precio_mostrar ?? p.precio;
export const etiquetaPrecio = (p: B2BPresentacion): string => (p.muestra_precio === "final" ? "final" : "+ IVA");

/**
 * «desde $X» entre todos los mayoristas. Se compara por el precio final: uno
 * puede mostrarse neto y otro final, y comparar un neto con un final elige mal.
 */
export function mejorOferta(prod: B2BProducto): B2BPresentacion | null {
  let mejor: B2BPresentacion | null = null;
  for (const pr of prod.mayoristas.flatMap((m) => m.presentaciones)) {
    if (pr.precio == null) continue;
    if (!mejor || (pr.precio_final ?? pr.precio) < (mejor.precio_final ?? mejor.precio)) mejor = pr;
  }
  return mejor;
}

/**
 * Si el catálogo no tiene presentaciones cargadas se ofrece una «Unidad» del
 * producto maestro: alcanza para venderlo en el mostrador.
 */
export function opcionesDe(p: B2BProductoMaestro): B2BPresentacionMaestra[] {
  if (p.presentaciones?.length) return p.presentaciones;
  return [{ id: p.id, nombre: p.unidad_base ?? "Unidad", factor: 1, ean_propio: null }];
}

/** Estados de NexoB2B, con las variantes en femenino de la documentación vieja */
export const ESTADO_ORDEN: Record<string, { label: string; tono: "info" | "aviso" | "ok" | "error" }> = {
  cargada: { label: "Cargada", tono: "info" },
  confirmado: { label: "Confirmada", tono: "info" },
  armando: { label: "En preparación", tono: "aviso" },
  listo: { label: "Lista para despachar", tono: "aviso" },
  en_transporte: { label: "En camino", tono: "aviso" },
  entregado: { label: "Entregada", tono: "ok" },
  cancelado: { label: "Cancelada", tono: "error" },
  devuelto: { label: "Devuelta", tono: "error" },
  confirmada: { label: "Confirmada", tono: "info" },
  en_preparacion: { label: "En preparación", tono: "aviso" },
  despachada: { label: "En camino", tono: "aviso" },
  entregada: { label: "Entregada", tono: "ok" },
  cancelada: { label: "Cancelada", tono: "error" },
};

export const ordenCancelada = (e: string | null): boolean => e === "cancelado" || e === "cancelada";
export const ordenEntregada = (e: string | null): boolean => e === "entregado" || e === "entregada";

export interface B2BMayorista {
  id: string;
  nombre: string;
  ciudad: string | null;
  provincia: string | null;
  rubros: string[];
  logo_url: string | null;
  portada_url?: string | null;
  descripcion?: string | null;
  distancia_km?: number | null;
  solicitud: { id: string; estado: "pendiente" | "aceptado" | "rechazado" } | null;
  contacto: { nombre: string; celular: string | null; email: string | null; es_vendedor: boolean } | null;
  productos_count?: number;
  muestras?: { nombre: string; imagen_url: string }[];
}

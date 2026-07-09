/** Tipos de la API de NexoB2B tal como los devuelve el backend del POS. */

export interface B2BPresentacion {
  id: string;
  nombre: string;
  factor: number;
  ean_propio: string | null;
  precio: number;
  precio_lista: number | null;
  stock: number | null;
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
  id: string;
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

export interface B2BTaxonomia {
  pasillos: { id: string; nombre: string }[];
  rubros: { id: string; nombre: string; pasillo_id: string | null }[];
  subrubros: { id: string; nombre: string; rubro_id: string }[];
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

export const ESTADO_ORDEN: Record<string, { label: string; cls: string }> = {
  cargada: { label: "Cargada", cls: "info" },
  confirmada: { label: "Confirmada", cls: "info" },
  en_preparacion: { label: "En preparación", cls: "warn" },
  despachada: { label: "Despachada", cls: "warn" },
  entregada: { label: "Entregada", cls: "ok" },
  devuelto: { label: "Devuelto", cls: "err" },
  cancelada: { label: "Cancelada", cls: "err" },
};

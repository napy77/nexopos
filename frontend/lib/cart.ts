"use client";

/** Carrito de compras a mayoristas (persistido en localStorage). */
export interface CartMeta {
  productoNombre: string;
  presentacionNombre: string;
  ean: string | null;
  descripcion?: string | null;
  marca: string | null;
  pasilloId: string | null;
  pasilloNombre: string | null;
  rubroId: string | null;
  rubroNombre: string | null;
  subrubroId: string | null;
  subrubroNombre: string | null;
  imagenUrl: string | null;
  alicuotaIva: number | null;
  factor: number;
}

export interface CartLine {
  presentacionId: string;
  mayoristaId: string;
  mayoristaNombre: string;
  cantidad: number;
  precio: number;
  meta: CartMeta;
}

const KEY = "nexopos_purchase_cart_v2";

export function loadCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as CartLine[];
  } catch {
    return [];
  }
}

export function saveCart(cart: CartLine[]): void {
  localStorage.setItem(KEY, JSON.stringify(cart));
}

export function addToCart(line: CartLine): CartLine[] {
  const cart = loadCart();
  const existing = cart.find((l) => l.presentacionId === line.presentacionId);
  if (existing) existing.cantidad += line.cantidad;
  else cart.push(line);
  saveCart(cart);
  return cart;
}

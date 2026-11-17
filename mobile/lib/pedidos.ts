import { create } from "zustand";
import { api, mensaje } from "@/lib/api";

export interface LineaPedido { name: string; quantity: string; unitPrice: string }
export interface Pedido {
  id: number; code: string; status: string; total: string;
  slot_label: string; slot_kind: "retiro" | "reparto"; address: string | null;
  payment_method: string; payment_status: string;
  ready_estimate: string | null; notes: string | null;
  contact_name: string | null; contact_phone: string | null;
  customer_name: string | null; created_at: string; cancel_reason: string | null;
  lines: LineaPedido[] | null;
  review_reason: "cuenta_nueva_monto_alto" | "identidad_no_disponible" | null;
  verification_level: number | null;
  customer_origen: "mostrador" | "tienda" | null;
}

export const ABIERTOS = ["recibido", "aceptado", "listo", "en_camino"];

/**
 * Los pedidos de la tienda viven acá y no en la pantalla: el layout los
 * consulta cada 20 segundos para el globito de la pestaña, porque un pedido
 * que entra mientras el cajero está vendiendo tiene que verse sin entrar a
 * buscarlo. La pantalla de Pedidos lee lo mismo.
 */
export const usePedidos = create<{
  pedidos: Pedido[];
  cargado: boolean;
  error: string;
  cargar: () => Promise<void>;
}>((set) => ({
  pedidos: [],
  cargado: false,
  error: "",
  async cargar() {
    try {
      const pedidos = await api<Pedido[]>("/api/pedidos");
      set({ pedidos, cargado: true, error: "" });
    } catch (e) {
      set({ error: mensaje(e) });
    }
  },
}));

import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * A qué ticketera sale esta tablet o este celular. Es por DISPOSITIVO, igual
 * que en la web: cada caja tiene su impresora y su papel.
 *
 * - red: térmica Ethernet/Wi-Fi en el puerto RAW (9100), anda en Android e iOS
 * - ble: Bluetooth de bajo consumo, anda en Android e iOS
 * - clasico: Bluetooth clásico (SPP), sólo Android; es el de las térmicas
 *   portátiles más baratas, que un iPhone o un iPad no ven
 */
export type TipoImpresora = "ninguna" | "red" | "ble" | "clasico";

export interface ConfigImpresora {
  tipo: TipoImpresora;
  host: string;
  puerto: number;
  /** id BLE o dirección MAC del clásico */
  dispositivo: string;
  nombre: string;
  ancho: "80mm" | "58mm";
  autoPrint: boolean;
}

export const CONFIG_INICIAL: ConfigImpresora = {
  tipo: "ninguna", host: "", puerto: 9100, dispositivo: "", nombre: "", ancho: "80mm", autoPrint: true,
};

const KEY = "nexopos_impresora";

interface Estado {
  config: ConfigImpresora;
  cargar: () => Promise<void>;
  guardar: (c: ConfigImpresora) => Promise<void>;
}

export const useImpresora = create<Estado>((set) => ({
  config: CONFIG_INICIAL,
  cargar: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) set({ config: { ...CONFIG_INICIAL, ...JSON.parse(raw) } });
    } catch { /* sin configuración guardada: queda la inicial */ }
  },
  guardar: async (config) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(config));
    set({ config });
  },
}));

export const columnas = (c: ConfigImpresora) => (c.ancho === "58mm" ? 32 : 48);

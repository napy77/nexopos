import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * La sesión del comercio. El JWT lo emite el backend del POS después de
 * validar contra NexoB2B y dura 12 h; se guarda cifrado en el dispositivo
 * (Keychain / Keystore), nunca en texto plano.
 */
export interface Comercio { id: number; name: string; email: string }

interface Sesion {
  cargada: boolean;
  token: string | null;
  comercio: Comercio | null;
  cargar: () => Promise<void>;
  entrar: (token: string, comercio: Comercio) => Promise<void>;
  salir: () => Promise<void>;
}

const K_TOKEN = "nexopos_token";
const K_COMERCIO = "nexopos_commerce";

export const useSesion = create<Sesion>((set) => ({
  cargada: false,
  token: null,
  comercio: null,
  cargar: async () => {
    const [token, comercio] = await Promise.all([
      SecureStore.getItemAsync(K_TOKEN),
      SecureStore.getItemAsync(K_COMERCIO),
    ]);
    let c: Comercio | null = null;
    try { c = comercio ? JSON.parse(comercio) : null; } catch { /* sesión rota: se vuelve a entrar */ }
    set({ cargada: true, token: token && c ? token : null, comercio: token ? c : null });
  },
  entrar: async (token, comercio) => {
    await SecureStore.setItemAsync(K_TOKEN, token);
    await SecureStore.setItemAsync(K_COMERCIO, JSON.stringify(comercio));
    set({ token, comercio });
  },
  // Un login nuevo empieza de cero, sin restos del anterior
  salir: async () => {
    await SecureStore.deleteItemAsync(K_TOKEN);
    await SecureStore.deleteItemAsync(K_COMERCIO);
    set({ token: null, comercio: null });
  },
}));

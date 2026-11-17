import { File, Paths } from "expo-file-system";
import { create } from "zustand";
import type { MetaProducto } from "./b2b";

/** Carrito de compra a mayoristas. Una orden por mayorista al confirmar. */
export interface LineaCarrito {
  /** Presentación del mayorista: identifica el ítem al crear la orden */
  presentacionId: string;
  /** Presentación maestra: identidad del producto en el stock local */
  presentacionMaestraId?: string;
  mayoristaId: string;
  mayoristaNombre: string;
  cantidad: number;
  /** Neto: la orden se arma sin IVA, como en B2B */
  precio: number;
  meta: MetaProducto;
}

// Archivo y no SecureStore: un pedido de reposición puede tener decenas de
// renglones, y el llavero no está hecho para guardar eso.
const archivo = () => new File(Paths.document, "nexopos-carrito.json");

function guardar(lineas: LineaCarrito[]) {
  try {
    archivo().write(JSON.stringify(lineas));
  } catch (e) {
    console.warn("[carrito] no se pudo guardar", e);
  }
}

interface EstadoCarrito {
  lineas: LineaCarrito[];
  cargar: () => void;
  agregar: (l: LineaCarrito) => void;
  cantidad: (presentacionId: string, cantidad: number) => void;
  quitar: (presentacionId: string) => void;
  vaciarMayorista: (mayoristaId: string) => void;
}

export const useCarrito = create<EstadoCarrito>((set, get) => {
  const poner = (lineas: LineaCarrito[]) => { set({ lineas }); guardar(lineas); };
  return {
    lineas: [],
    cargar: () => {
      try {
        const f = archivo();
        if (f.exists) set({ lineas: JSON.parse(f.textSync()) as LineaCarrito[] });
      } catch {
        // Un archivo roto no puede dejar la app sin abrir: se arranca vacío
        set({ lineas: [] });
      }
    },
    agregar: (l) => {
      const lineas = get().lineas;
      const ya = lineas.find((x) => x.presentacionId === l.presentacionId);
      poner(ya
        ? lineas.map((x) => (x === ya ? { ...x, cantidad: x.cantidad + l.cantidad } : x))
        : [...lineas, l]);
    },
    cantidad: (id, cantidad) =>
      poner(get().lineas.map((x) => (x.presentacionId === id ? { ...x, cantidad: Math.max(1, cantidad) } : x))),
    quitar: (id) => poner(get().lineas.filter((x) => x.presentacionId !== id)),
    vaciarMayorista: (id) => poner(get().lineas.filter((x) => x.mayoristaId !== id)),
  };
});

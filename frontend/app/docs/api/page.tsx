import type { Metadata } from "next";
import { Doc } from "./doc";

export const metadata: Metadata = {
  title: "API de NexoPOS · Documentación",
  description:
    "Conectá tu ERP, Odoo o el sistema que uses: leer el catálogo, escribir precios y stock, y leer las ventas del mostrador.",
};

/**
 * La documentación pública de la API.
 *
 * Vive fuera de `(dashboard)` a propósito: el que la lee suele ser un
 * desarrollador de la empresa que hace el ERP, y no tiene —ni tiene por qué
 * tener— una cuenta del comercio. Pedirle login para leer cómo conectarse
 * sería pedirle que entre a la casa para ver dónde está la puerta.
 */
export default function Page() {
  return <Doc />;
}

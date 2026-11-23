"use client";

/**
 * El puente con la app de escritorio (desktop/src/preload.ts). Existe sólo
 * cuando NexoPOS corre dentro de la app de Windows; en un navegador es
 * undefined y todo sigue como siempre.
 */
export interface NexoDesktop {
  /** No existe en la 1.0.0: se pregunta antes de llamarla. */
  version?(): Promise<string>;
  impresoras(): Promise<{ nombre: string; etiqueta: string }[]>;
  /** Imprime sin diálogo. `impresora` vacía = la predeterminada de Windows. */
  imprimir(html: string, opciones: { impresora?: string; termica?: boolean; ancho?: string }): Promise<void>;
}

export function getDesktop(): NexoDesktop | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { nexoDesktop?: NexoDesktop }).nexoDesktop ?? null;
}

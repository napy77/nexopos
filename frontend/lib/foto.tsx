"use client";

import { useState } from "react";

/**
 * Foto con reemplazo automático: si la imagen no carga (ruta vencida, archivo
 * borrado en el marketplace, sin conexión), muestra un ícono en lugar del
 * cuadrito roto del navegador.
 */
export function Foto({
  src,
  alt = "",
  fallback = "📦",
  className,
  style,
  fallbackStyle,
}: {
  src: string | null | undefined;
  alt?: string;
  fallback?: string;
  className?: string;
  style?: React.CSSProperties;
  fallbackStyle?: React.CSSProperties;
}) {
  const [fallo, setFallo] = useState(false);

  if (!src || fallo) {
    return <span style={{ fontSize: 24, ...fallbackStyle }}>{fallback}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} style={style} onError={() => setFallo(true)} />
  );
}

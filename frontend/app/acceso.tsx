"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NEXOB2B_REGISTRO_URL } from "@/lib/sitio";

/**
 * Botones de acceso del sitio. Antes "/" mandaba directo a la caja; el cajero
 * que ya tiene sesión no tiene por qué pasar por el login, así que si hay
 * token el botón lo lleva derecho a su panel.
 */
export default function Acceso({ grande = false }: { grande?: boolean }) {
  const [conSesion, setConSesion] = useState(false);

  useEffect(() => {
    try {
      setConSesion(!!localStorage.getItem("nexopos_token"));
    } catch {
      // Navegador sin storage: se muestra el acceso normal.
    }
  }, []);

  const tam = grande ? " site-btn-lg" : "";

  if (conSesion) {
    return (
      <div className="site-acceso">
        <Link href="/dashboard" className={"site-btn site-btn-primary" + tam}>
          Ir a mi caja →
        </Link>
      </div>
    );
  }

  return (
    <div className="site-acceso">
      <Link href="/login" className={"site-btn site-btn-ghost" + tam}>
        Ingresar
      </Link>
      <a href={NEXOB2B_REGISTRO_URL} className={"site-btn site-btn-primary" + tam}>
        Crear cuenta gratis
      </a>
    </div>
  );
}

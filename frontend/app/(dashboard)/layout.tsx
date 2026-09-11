"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Resumen" },
  { href: "/ventas", label: "Punto de venta" },
  { href: "/pedidos", label: "Pedidos" },
  { href: "/caja", label: "Caja" },
  { href: "/catalogo", label: "Catálogo B2B" },
  { href: "/mayoristas", label: "Mayoristas" },
  { href: "/compras", label: "Compras" },
  { href: "/productos", label: "Productos" },
  { href: "/clientes", label: "Clientes" },
];

/**
 * Dos notas cortas, sin archivo de audio: no hace falta subir nada y no
 * depende de permisos del navegador como sí los haría una notificación.
 */
function sonar() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.18].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = i === 0 ? 880 : 1170;
      vol.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      vol.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.01);
      vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.14);
      osc.connect(vol).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.15);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* sin audio, queda el número en el menú y el título */
  }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [commerceName, setCommerceName] = useState("");
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const raw = localStorage.getItem("nexopos_commerce");
    if (raw) setCommerceName(JSON.parse(raw).name ?? "");
  }, [router]);

  /*
   * Los pedidos sin aceptar, en el menú.
   *
   * Sin esto el comerciante tiene que acordarse de ir a mirar, y el modo de
   * falla real es justamente ese: que el pedido entre, nadie lo mire en
   * cuarenta minutos, y el que pidió no sepa si va o no va.
   *
   * El título de la pestaña también lo dice, porque el POS suele quedar en
   * segundo plano detrás de otra cosa.
   */
  useEffect(() => {
    if (!getToken()) return;
    let previos = -1;
    const mirar = async () => {
      try {
        const lista = await api<{ status: string }[]>("/api/pedidos");
        const n = lista.filter((p) => p.status === "recibido").length;
        setPendientes(n);
        document.title = n > 0 ? `(${n}) NexoPOS` : "NexoPOS";
        // Un sonido corto cuando aparece uno nuevo. En un mostrador nadie
        // está mirando la pantalla; el aviso tiene que entrar por el oído.
        if (previos >= 0 && n > previos) sonar();
        previos = n;
      } catch {
        /* que no se caiga el menú por esto */
      }
    };
    mirar();
    const t = setInterval(mirar, 20_000);
    return () => clearInterval(t);
  }, []);

  function logout() {
    localStorage.removeItem("nexopos_token");
    localStorage.removeItem("nexopos_commerce");
    router.replace("/login");
  }

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">
          Nexo<span>POS</span>
        </div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname.startsWith(item.href) ? "active" : ""}
          >
            {item.label}
            {item.href === "/pedidos" && pendientes > 0 && (
              <span className="badge warn" style={{ marginLeft: 8, fontSize: 11 }}>{pendientes}</span>
            )}
          </Link>
        ))}
        <div className="footer">
          <Link href="/configuracion" className={`perfil-link ${pathname.startsWith("/configuracion") ? "active" : ""}`}>
            <span className="perfil-nombre">{commerceName || "Mi comercio"}</span>
            <span className="perfil-sub">⚙ Configuración</span>
          </Link>
          <a onClick={logout} style={{ cursor: "pointer", padding: "6px 20px" }}>
            Cerrar sesión
          </a>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

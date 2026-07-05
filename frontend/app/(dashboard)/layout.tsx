"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Resumen" },
  { href: "/ventas", label: "Punto de venta" },
  { href: "/catalogo", label: "Catálogo B2B" },
  { href: "/compras", label: "Compras" },
  { href: "/stock", label: "Stock" },
  { href: "/clientes", label: "Clientes" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [commerceName, setCommerceName] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const raw = localStorage.getItem("nexopos_commerce");
    if (raw) setCommerceName(JSON.parse(raw).name ?? "");
  }, [router]);

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
          </Link>
        ))}
        <div className="footer">
          {commerceName && <div>{commerceName}</div>}
          <a onClick={logout} style={{ cursor: "pointer", padding: 0 }}>
            Cerrar sesión
          </a>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

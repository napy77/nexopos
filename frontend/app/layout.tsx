import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexoPOS",
  description: "Punto de venta del ecosistema NexoB2B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

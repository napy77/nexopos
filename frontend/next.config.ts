import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // /entrar llega con un código de un solo uso en la URL: ningún recurso
    // que cargue esa página tiene que recibirlo en el Referer.
    return [{ source: "/entrar", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
  async rewrites() {
    // Proxy al backend del POS para evitar CORS en desarrollo
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

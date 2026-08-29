import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://nexopos:nexopos@localhost:5433/nexopos",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  nexob2b: {
    apiUrl: process.env.NEXOB2B_API_URL || null, // null → modo mock
    publishableKey: process.env.NEXOB2B_PUBLISHABLE_KEY ?? "",
    /**
     * Dominio con el que se arman las URLs de logos e imágenes. Va separado
     * de apiUrl porque quien descarga esas imágenes es el navegador del
     * comercio, no este servidor: si algún día el backend hablara con
     * NexoB2B por una IP interna, las imágenes tienen que seguir apuntando
     * al dominio público.
     */
    publicUrl:
      process.env.NEXOB2B_PUBLIC_URL || process.env.NEXOB2B_API_URL || "https://nexob2b.app",
  },
};

import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://nexopos:nexopos@localhost:5433/nexopos",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  nexob2b: {
    apiUrl: process.env.NEXOB2B_API_URL || null, // null → modo mock
    apiKey: process.env.NEXOB2B_API_KEY ?? "",
  },
  catalogSyncIntervalMin: Number(process.env.CATALOG_SYNC_INTERVAL_MIN ?? 60),
};

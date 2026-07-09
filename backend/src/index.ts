import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { runMigrations } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { isMockMode } from "./integrations/nexob2b.js";
import { authRouter } from "./modules/auth.js";
import { catalogRouter, refreshProductTaxonomy } from "./modules/catalog.js";
import { mayoristasRouter } from "./modules/mayoristas.js";
import { purchasesRouter } from "./modules/purchases.js";
import { stockRouter } from "./modules/stock.js";
import { salesRouter } from "./modules/sales.js";
import { customersRouter } from "./modules/customers.js";
import { reportsRouter } from "./modules/reports.js";
import { exportRouter } from "./modules/export.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, mockMode: isMockMode() }));

app.use("/api/auth", authRouter);
app.use("/api/catalog", requireAuth, catalogRouter);
app.use("/api/mayoristas", requireAuth, mayoristasRouter);
app.use("/api/purchases", requireAuth, purchasesRouter);
app.use("/api/stock", requireAuth, stockRouter);
app.use("/api/sales", requireAuth, salesRouter);
app.use("/api/customers", requireAuth, customersRouter);
app.use("/api/reports", requireAuth, reportsRouter);
app.use("/api/export", requireAuth, exportRouter);

app.use(errorHandler);

async function main() {
  await runMigrations();

  // Sincronizar nombres de taxonomía (pasillo/rubro/subrubro) al iniciar y cada 12 h
  refreshProductTaxonomy()
    .then(() => console.log("[taxonomia] nombres sincronizados con NexoB2B"))
    .catch((err) => console.error("[taxonomia] fallo la sincronización:", err));
  setInterval(() => {
    refreshProductTaxonomy().catch((err) => console.error("[taxonomia] fallo la sincronización:", err));
  }, 12 * 3600_000);

  app.listen(config.port, () => {
    console.log(`NexoPOS backend escuchando en http://localhost:${config.port}`);
    if (isMockMode()) {
      console.log("Modo MOCK activo (NEXOB2B_API_URL vacío). Login demo: cualquier email / password 'demo'");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

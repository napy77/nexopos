-- NexoPOS · Schema inicial (Fase 1 MVP)
-- Convenciones:
--  * Todas las tablas de datos del comercio llevan commerce_id (multi-tenant, aislamiento por fila).
--  * El catálogo (products, wholesaler_offers) es global: es una cache del catálogo de NexoB2B.
--  * Los nombres de columnas están pensados para mapear a Odoo (ver docs/ODOO-MIGRATION.md):
--    products→product.template, customers→res.partner, sales→pos.order, etc.

-- ── Tenants ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commerces (
  id            BIGSERIAL PRIMARY KEY,
  nexob2b_id    TEXT UNIQUE,              -- id del comercio en NexoB2B
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  tax_id        TEXT,                     -- CUIT/RUT/RFC según país
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Catálogo (cache de NexoB2B, global) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id            BIGSERIAL PRIMARY KEY,
  nexob2b_id    TEXT UNIQUE,              -- id del producto en NexoB2B
  ean           TEXT UNIQUE,              -- código de barras normalizado
  name          TEXT NOT NULL,
  brand         TEXT,
  category      TEXT,
  unit          TEXT NOT NULL DEFAULT 'unidad',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products USING gin (to_tsvector('spanish', name));
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);

CREATE TABLE IF NOT EXISTS wholesaler_offers (
  id             BIGSERIAL PRIMARY KEY,
  product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  wholesaler_id  TEXT NOT NULL,           -- id del mayorista en NexoB2B
  wholesaler_name TEXT NOT NULL,
  price          NUMERIC(12,2) NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'ARS',
  min_qty        INTEGER NOT NULL DEFAULT 1,
  available_stock INTEGER,
  conditions     TEXT,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, wholesaler_id)
);

-- ── Stock local del comercio ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_items (
  id            BIGSERIAL PRIMARY KEY,
  commerce_id   BIGINT NOT NULL REFERENCES commerces(id),
  product_id    BIGINT NOT NULL REFERENCES products(id),
  quantity      NUMERIC(12,3) NOT NULL DEFAULT 0,
  cost          NUMERIC(12,2),            -- último costo de compra
  sale_price    NUMERIC(12,2),            -- precio de venta al público
  min_stock     NUMERIC(12,3) NOT NULL DEFAULT 0,  -- umbral de alerta
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commerce_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_commerce ON stock_items (commerce_id);

-- Movimientos de inventario (auditable, mapea a stock.move de Odoo)
CREATE TABLE IF NOT EXISTS stock_movements (
  id            BIGSERIAL PRIMARY KEY,
  commerce_id   BIGINT NOT NULL REFERENCES commerces(id),
  product_id    BIGINT NOT NULL REFERENCES products(id),
  type          TEXT NOT NULL CHECK (type IN ('purchase_reception','sale','manual_adjustment','return')),
  quantity      NUMERIC(12,3) NOT NULL,   -- positivo entra, negativo sale
  reference     TEXT,                     -- nro de orden, nro de ticket, motivo del ajuste
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_commerce ON stock_movements (commerce_id, created_at DESC);

-- ── Compras a mayoristas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              BIGSERIAL PRIMARY KEY,
  commerce_id     BIGINT NOT NULL REFERENCES commerces(id),
  wholesaler_id   TEXT NOT NULL,
  wholesaler_name TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','received','cancelled')),
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'ARS',
  nexob2b_order_id TEXT,                  -- id de la orden sincronizada en NexoB2B
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  received_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_po_commerce ON purchase_orders (commerce_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  quantity    NUMERIC(12,3) NOT NULL,
  unit_price  NUMERIC(12,2) NOT NULL
);

-- ── Clientes y cuentas corrientes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id           BIGSERIAL PRIMARY KEY,
  commerce_id  BIGINT NOT NULL REFERENCES commerces(id),
  name         TEXT NOT NULL,
  doc_number   TEXT,                      -- DNI/CUIT
  phone        TEXT,
  email        TEXT,
  balance      NUMERIC(12,2) NOT NULL DEFAULT 0,  -- >0 = debe al comercio
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_commerce ON customers (commerce_id);

CREATE TABLE IF NOT EXISTS customer_transactions (
  id           BIGSERIAL PRIMARY KEY,
  commerce_id  BIGINT NOT NULL REFERENCES commerces(id),
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  type         TEXT NOT NULL CHECK (type IN ('sale_credit','payment','adjustment')),
  amount       NUMERIC(12,2) NOT NULL,    -- positivo aumenta deuda, negativo la baja
  sale_id      BIGINT,                    -- FK lógica a sales (nullable)
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctx_customer ON customer_transactions (customer_id, created_at DESC);

-- ── Ventas / tickets ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id             BIGSERIAL PRIMARY KEY,
  commerce_id    BIGINT NOT NULL REFERENCES commerces(id),
  ticket_number  BIGINT NOT NULL,         -- secuencial por comercio
  customer_id    BIGINT REFERENCES customers(id),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card','account')),
  subtotal       NUMERIC(12,2) NOT NULL,
  discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total          NUMERIC(12,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commerce_id, ticket_number)
);
CREATE INDEX IF NOT EXISTS idx_sales_commerce ON sales (commerce_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  quantity    NUMERIC(12,3) NOT NULL,
  unit_price  NUMERIC(12,2) NOT NULL
);

-- ── Auditoría básica ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  commerce_id  BIGINT REFERENCES commerces(id),
  action       TEXT NOT NULL,             -- ej: sale.create, stock.adjust, po.confirm
  entity       TEXT,
  entity_id    BIGINT,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

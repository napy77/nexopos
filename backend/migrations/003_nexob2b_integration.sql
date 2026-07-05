-- Integración con la API real de NexoB2B.
-- El catálogo pasa a consultarse en vivo (ya no se sincroniza en bloque);
-- products guarda solo los artículos que el comercio maneja en su stock,
-- ahora a nivel PRESENTACIÓN (pmp_xxx): "Aceite Cocinero — Bidón 5L".

-- Token de NexoB2B por comercio (dura 30 días, se renueva en cada login)
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS nexob2b_token TEXT;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS ciudad TEXT;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS provincia TEXT;

-- El EAN deja de ser único: varias presentaciones pueden compartir el EAN
-- del producto maestro (identidad = nexob2b_id, que ahora guarda el pmp_).
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_ean_key;
CREATE INDEX IF NOT EXISTS idx_products_ean ON products (ean);
ALTER TABLE products ADD COLUMN IF NOT EXISTS alicuota_iva NUMERIC(5,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS factor NUMERIC(12,3) DEFAULT 1;

-- Órdenes: datos que devuelve NexoB2B
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS numero INTEGER;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS estado_b2b TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_neto NUMERIC(12,2);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_iva NUMERIC(12,2);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS costo_medio_pago NUMERIC(12,2);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS medio_pago TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notas TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS is_pagada BOOLEAN DEFAULT false;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS is_facturada BOOLEAN DEFAULT false;

-- Items: referencian la presentación de NexoB2B; el product_id local se
-- resuelve recién al recibir la mercadería (meta guarda los datos para crearlo)
ALTER TABLE purchase_order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS presentacion_id TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS descripcion TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS meta JSONB;

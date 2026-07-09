-- Taxonomía de NexoB2B en los productos locales: pasillo → rubro → subrubro.
-- Los ids vienen del marketplace; los nombres se re-sincronizan periódicamente
-- contra /store/taxonomia (ver refreshProductTaxonomy).
ALTER TABLE products ADD COLUMN IF NOT EXISTS pasillo_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS pasillo_nombre TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS rubro_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS rubro_nombre TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subrubro_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subrubro_nombre TEXT;

-- Los productos existentes guardaban el nombre del rubro en category
UPDATE products SET rubro_nombre = category WHERE rubro_nombre IS NULL AND category IS NOT NULL;

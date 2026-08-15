-- Productos propios del comercio: los que no existen en el catálogo de
-- NexoB2B. Tres casos de uso reales:
--   1. Comprado fuera de NexoB2B (ningún mayorista lo vende ahí).
--   2. Fraccionamiento: se compra jamón crudo en pieza y se vende en
--      bandejas de 100 g.
--   3. Elaboración propia: con harina, manteca y huevos se hace una torta.
--
-- A diferencia del catálogo (products con commerce_id NULL, global y
-- compartido), estos pertenecen a un solo comercio.

ALTER TABLE products ADD COLUMN IF NOT EXISTS commerce_id BIGINT REFERENCES commerces(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'nexob2b'
  CHECK (origen IN ('nexob2b', 'propio'));

-- PLU: código corto que se carga en la balanza y viaja dentro del código
-- de barras impreso en la etiqueta. Único por comercio.
ALTER TABLE products ADD COLUMN IF NOT EXISTS plu TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_plu_commerce
  ON products (commerce_id, plu) WHERE plu IS NOT NULL;

-- Venta por peso: la cantidad del ticket es en kilos (2,5 = 2,5 kg) y el
-- precio de venta se interpreta por kilo.
ALTER TABLE products ADD COLUMN IF NOT EXISTS venta_por_peso BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_commerce ON products (commerce_id) WHERE commerce_id IS NOT NULL;

-- Configuración de la balanza etiquetadora, por comercio: qué prefijo usan
-- sus etiquetas y cómo se compone el código de barras que imprimen.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS balanza_config JSONB;

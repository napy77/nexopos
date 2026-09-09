-- Disponibilidad: una política por producto, no dos tipos de producto (A1).
--
-- Hasta acá todo producto tenía stock. Eso funciona para lo que se compra hecho
-- y no funciona para lo que el comercio hace: la pizza, el pan, la copia de
-- llave. Esas cosas no tienen inventario, tienen una declaración del comercio.
--
-- Va en stock_items y no en products porque es una decisión del comercio sobre
-- SU producto: el mismo dulce de leche puede ser declarado en un almacén y
-- contado en frascos en el de al lado.

ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS availability_policy TEXT;

-- El default lo da el origen, pero es un default y no una regla: la panadera
-- que envasa su dulce de leche en frascos tiene doce frascos reales, y eso es
-- inventario aunque el producto sea propio. Por eso la columna es editable y no
-- se deriva de products.origen cada vez.
UPDATE stock_items s SET availability_policy = CASE
    WHEN p.origen = 'propio' THEN 'declared' ELSE 'stock' END
  FROM products p WHERE p.id = s.product_id AND s.availability_policy IS NULL;

ALTER TABLE stock_items ALTER COLUMN availability_policy SET DEFAULT 'stock';
ALTER TABLE stock_items ALTER COLUMN availability_policy SET NOT NULL;
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_availability_policy_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_availability_policy_check
  CHECK (availability_policy IN ('stock', 'declared'));

-- ── Los tres estados de `declared` ──────────────────────────────────────────
-- Disponible (sin contador), cupo del día, y agotado. El agotado es el que
-- tiene que costar un gesto: el tipo tiene las manos en la masa.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS declared_state TEXT NOT NULL DEFAULT 'available';
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_declared_state_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_declared_state_check
  CHECK (declared_state IN ('available', 'out'));

-- Cupo del día. quota_total es lo que declara el comercio ("hoy hago 20
-- pizzas"); quota_day dice de qué día es el remanente.
--
-- El cupo se repone SOLO, y se repone comparando quota_day con la fecha de hoy
-- en vez de con una tarea programada. Es a propósito: una tarea que corre a las
-- 00:00 no corre si el servidor estaba caído, y entonces la tienda amanece en
-- cero y parece cerrada —que es el modo de falla que había que evitar—. Mirando
-- la fecha, el cupo está bien aunque no haya corrido nada.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS quota_total INTEGER;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS quota_remaining INTEGER;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS quota_day DATE;

-- ── Insumo (A3) ─────────────────────────────────────────────────────────────
-- Los 20 kg de queso que el pizzero compra por B2B entran al stock y nunca
-- salen por una venta, así que el número solo crece y ensucia el reporte. Con
-- el flag entra por su costo, alimenta el costeo, y no aparece en góndola ni en
-- la tienda online.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS es_insumo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_stock_vendibles
  ON stock_items (commerce_id) WHERE NOT es_insumo;

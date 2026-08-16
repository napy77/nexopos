-- Foto propia del comercio para un producto de su stock.
--
-- products es global para el catálogo de NexoB2B (commerce_id NULL), así que
-- si un comercio le cambiara la foto ahí se la cambiaría a todos. La foto que
-- sube el comercio vive en su stock_items y pisa a la del catálogo solo para
-- él (ver el COALESCE en la consulta de stock).
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS image_url TEXT;

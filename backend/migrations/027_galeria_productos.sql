-- La galería de fotos del producto, que ahora manda NexoB2B.
--
-- `image_url` sigue siendo la portada, en la misma columna y con el mismo
-- significado: la leen varios lugares del POS y moverla para ganar una galería
-- sería pedir un incidente a cambio de nada. Esto es aditivo.
--
-- La portada NO se repite acá dentro. La galería completa es
-- [image_url, ...imagenes], y que haya una sola fuente de verdad sobre cuál es
-- la principal es justamente lo que evita que dos pantallas muestren distinto.
ALTER TABLE products ADD COLUMN IF NOT EXISTS imagenes JSONB NOT NULL DEFAULT '[]'::jsonb;

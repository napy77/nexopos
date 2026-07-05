-- Imagen del producto (la proveerá NexoB2B; el POS la muestra en los
-- botones del punto de venta cuando exista)
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

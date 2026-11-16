-- Ventas cobradas sin conexión.
--
-- Cuando se corta internet, la caja cobra en efectivo, guarda la venta en una
-- cola local y la manda cuando vuelve la conexión. Esa llamada se reintenta
-- (la respuesta se puede perder en el camino), así que cada venta trae un
-- identificador que inventa la caja: con el índice único, el segundo intento
-- encuentra la venta ya hecha en vez de duplicarla.
--
-- offline_code es el número del comprobante provisorio que se llevó el
-- cliente (P-0007): el ticket oficial se numera recién al registrar, y sin
-- este dato no hay forma de unir el papel con la venta.
--
-- created_at de estas ventas es la hora en que se cobró, no la de registro;
-- offline_synced_at dice cuándo llegó al servidor.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS offline_id UUID;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS offline_code TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS offline_synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS sales_offline_id_uniq
  ON sales (commerce_id, offline_id) WHERE offline_id IS NOT NULL;

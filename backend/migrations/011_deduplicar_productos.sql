-- Consolida los productos del catálogo que quedaron duplicados.
--
-- El mismo artículo entraba con dos identidades según por dónde se cargara:
-- al agregarlo desde el catálogo se guardaba el id de la presentación maestra
-- (producto_maestro_presentacion) y al recibir una compra el del listing del
-- mayorista (producto_mayorista_presentacion). Resultado: dos filas con el
-- mismo EAN y el mismo nombre, cada una con su propio stock.
--
-- El nombre ya incluye la presentación ("… — BOTELLA"), así que agrupar por
-- nombre no mezcla una unidad con un bulto.

-- 1. Elegir un producto canónico por nombre (el más antiguo) y mapear el resto
CREATE TEMP TABLE _dedup AS
SELECT p.id AS duplicado_id, c.canonico_id
FROM products p
JOIN (
  SELECT name, MIN(id) AS canonico_id
  FROM products
  WHERE origen = 'nexob2b'
  GROUP BY name
  HAVING COUNT(*) > 1
) c ON c.name = p.name
WHERE p.origen = 'nexob2b' AND p.id <> c.canonico_id;

-- 2. Consolidar el stock: sumar cantidades y conservar los datos cargados
UPDATE stock_items s
SET quantity   = s.quantity + d.quantity,
    cost       = COALESCE(s.cost, d.cost),
    sale_price = COALESCE(s.sale_price, d.sale_price),
    min_stock  = GREATEST(s.min_stock, d.min_stock),
    image_url  = COALESCE(s.image_url, d.image_url),
    updated_at = now()
FROM (
  SELECT dd.canonico_id, si.commerce_id,
         SUM(si.quantity) AS quantity,
         MAX(si.cost) AS cost,
         MAX(si.sale_price) AS sale_price,
         MAX(si.min_stock) AS min_stock,
         MIN(si.image_url) AS image_url
  FROM stock_items si
  JOIN _dedup dd ON dd.duplicado_id = si.product_id
  GROUP BY dd.canonico_id, si.commerce_id
) d
WHERE s.product_id = d.canonico_id AND s.commerce_id = d.commerce_id;

-- 3. Si el canónico no tenía stock en ese comercio, mudar la fila del duplicado
UPDATE stock_items s
SET product_id = d.canonico_id
FROM _dedup d
WHERE s.product_id = d.duplicado_id
  AND NOT EXISTS (
    SELECT 1 FROM stock_items s2
    WHERE s2.product_id = d.canonico_id AND s2.commerce_id = s.commerce_id
  );

-- 4. Reapuntar el historial al producto canónico y limpiar lo que sobra
UPDATE stock_movements m SET product_id = d.canonico_id
FROM _dedup d WHERE m.product_id = d.duplicado_id;

UPDATE sale_items i SET product_id = d.canonico_id
FROM _dedup d WHERE i.product_id = d.duplicado_id;

UPDATE purchase_order_items i SET product_id = d.canonico_id
FROM _dedup d WHERE i.product_id = d.duplicado_id;

DELETE FROM stock_items s USING _dedup d WHERE s.product_id = d.duplicado_id;
DELETE FROM products p USING _dedup d WHERE p.id = d.duplicado_id;

DROP TABLE _dedup;

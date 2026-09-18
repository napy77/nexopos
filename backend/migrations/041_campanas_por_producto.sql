-- El descuento pasa a ser de cada producto, no de la campaña.
--
-- Una tanda de ofertas no tiene un solo porcentaje: al arroz se le hace 30 y al
-- aceite 12, porque el margen de cada uno es distinto. Con un único número por
-- campaña, el comerciante terminaba armando tres campañas para lo que es una
-- sola oferta.
--
-- Y se puede poner de dos formas, porque el comerciante piensa de las dos: "a
-- éste hacele 25%" y "éste lo quiero a $5.000". Se guarda lo que él dijo, no lo
-- que se deduce.
--
-- Guardar siempre el porcentaje sería más prolijo y estaría mal: $8.500 a
-- $5.000 es 41,176470…%, que redondeado a dos decimales devuelve $5.000,30. El
-- comerciante escribió cinco mil y la góndola diría otra cosa.
ALTER TABLE campaign_products ADD COLUMN IF NOT EXISTS descuento NUMERIC(5,2);
ALTER TABLE campaign_products ADD COLUMN IF NOT EXISTS precio NUMERIC(12,2);

-- En qué orden se ven dentro de la tanda.
--
-- La tienda muestra los primeros y el resto queda en "Ver todos", así que el
-- orden es una decisión comercial: el que empieza con Z puede ser justo el que
-- se quiere adelante.
ALTER TABLE campaign_products ADD COLUMN IF NOT EXISTS orden INT NOT NULL DEFAULT 0;

-- Lo que ya estaba tomaba el porcentaje de la campaña: se copia a cada línea
-- para que nada cambie de precio por esta migración.
UPDATE campaign_products cp
   SET descuento = c.descuento
  FROM campaigns c
 WHERE c.id = cp.campaign_id AND cp.descuento IS NULL AND cp.precio IS NULL;

-- Y el orden alfabético que tenían, congelado como orden inicial: es el que el
-- comerciante ya vio, así que empezar por otro lo sorprendería sin motivo.
WITH ordenado AS (
  SELECT cp.campaign_id, cp.product_id,
         ROW_NUMBER() OVER (PARTITION BY cp.campaign_id ORDER BY p.name) - 1 AS n
    FROM campaign_products cp JOIN products p ON p.id = cp.product_id
)
UPDATE campaign_products cp SET orden = o.n
  FROM ordenado o
 WHERE o.campaign_id = cp.campaign_id AND o.product_id = cp.product_id;

-- Uno de los dos, nunca los dos ni ninguno.
ALTER TABLE campaign_products DROP CONSTRAINT IF EXISTS campaign_products_precio_o_descuento;
ALTER TABLE campaign_products ADD CONSTRAINT campaign_products_precio_o_descuento
  CHECK ((descuento IS NOT NULL) <> (precio IS NOT NULL));

ALTER TABLE campaign_products DROP CONSTRAINT IF EXISTS campaign_products_descuento_valido;
ALTER TABLE campaign_products ADD CONSTRAINT campaign_products_descuento_valido
  CHECK (descuento IS NULL OR (descuento > 0 AND descuento <= 95));

-- La campaña ya no necesita el suyo. Queda nullable en vez de borrarse: es el
-- dato con el que se armaron las que están vivas, y tirarlo haría imposible
-- entender después por qué un producto quedó con el porcentaje que tiene.
ALTER TABLE campaigns ALTER COLUMN descuento DROP NOT NULL;

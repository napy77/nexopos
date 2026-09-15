-- Stock compartido con NexoB2B, para el negocio que es mayorista y comercio a
-- la vez: el mismo depósito visto desde dos sistemas.
--
--   mostrador vende    → NexoPOS avisa a B2B  → baja allá
--   mayorista despacha → B2B avisa por webhook → baja acá
--
-- Las dos mitades van juntas o no va ninguna. Media sincronización deja el
-- stock bajando de un solo lado y el comerciante deja de creerle al número,
-- que es peor que no tener nada.

-- Qué líneas del stock son del catálogo propio.
--
-- Va en stock_items y no en products porque el mismo producto del catálogo de
-- NexoB2B puede ser propio para el distribuidor que lo fabrica y comprado para
-- el almacén de la otra cuadra. "Propio" es una relación entre un comercio y
-- un producto, no una propiedad del producto.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS b2b_propio BOOLEAN NOT NULL DEFAULT false;

-- El interruptor, por comercio. Apagado por defecto: encenderlo sin que el ERP
-- del cliente deje de reescribir el total le devuelve a B2B las unidades que
-- el mostrador acaba de descontar.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS b2b_stock_sync BOOLEAN NOT NULL DEFAULT false;

-- Con qué nos reconoce el webhook de NexoB2B.
--
-- Va en la URL y no en un header porque del otro lado se configura una URL y
-- nada más. Es largo y aleatorio por eso mismo.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS b2b_webhook_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_webhook_token
  ON commerces (b2b_webhook_token) WHERE b2b_webhook_token IS NOT NULL;

-- La cola de salida. Misma forma que las otras dos por la misma razón: la
-- venta no puede frenarse porque B2B no conteste, y el aviso no puede
-- perderse porque entonces allá sobra mercadería que ya se vendió.
CREATE TABLE IF NOT EXISTS b2b_stock_outbox (
  id              BIGSERIAL PRIMARY KEY,
  commerce_id     BIGINT NOT NULL REFERENCES commerces(id),
  product_id      BIGINT NOT NULL REFERENCES products(id),
  ean             TEXT NOT NULL,
  -- Negativo cuando se vendió, positivo cuando se devolvió. Es un delta y no
  -- un total a propósito: dos avisos que se cruzan se suman bien, y un total
  -- viejo que llega tarde pisaría lo que pasó mientras viajaba.
  cantidad        NUMERIC(12,3) NOT NULL,
  referencia      TEXT,
  intentos        INT NOT NULL DEFAULT 0,
  proximo_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_error    TEXT,
  enviado_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_stock_pendientes
  ON b2b_stock_outbox (proximo_intento) WHERE enviado_at IS NULL;

-- Lo que escribe el webhook de NexoB2B. Mismo criterio que 030 y 031: el que
-- revisa por qué un número no cuadra tiene que poder distinguir un despacho
-- por mayor de un conteo que hizo él.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('purchase_reception','sale','manual_adjustment','return','erp','import','b2b'));

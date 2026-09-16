-- Los tres arreglos que hizo NexoB2B sobre el circuito de stock.

-- 1. Identificar por presentación y no por EAN.
--
-- Con el EAN, una "unidad" y una "caja x12" sin ean_propio llegaban con el
-- mismo código y allá se descontaban las dos: vender una unidad bajaba también
-- una caja. Y las presentaciones sin EAN no se podían nombrar, así que ni se
-- mandaban. El id de la presentación maestra no tiene ninguno de los dos
-- problemas, y es el mismo que ya nos mandan en el webhook.
--
-- El EAN queda como alternativa —hay filas viejas cuyo nexob2b_id es el
-- listing del mayorista y no la presentación maestra—, así que ahora los dos
-- son opcionales pero uno tiene que estar.
ALTER TABLE b2b_stock_outbox ADD COLUMN IF NOT EXISTS presentacion_id TEXT;
ALTER TABLE b2b_stock_outbox ALTER COLUMN ean DROP NOT NULL;
ALTER TABLE b2b_stock_outbox DROP CONSTRAINT IF EXISTS b2b_stock_outbox_identificable;
ALTER TABLE b2b_stock_outbox ADD CONSTRAINT b2b_stock_outbox_identificable
  CHECK (presentacion_id IS NOT NULL OR ean IS NOT NULL);

-- 2. El lote, que es la clave de idempotencia.
--
-- NexoB2B suma deltas: un reintento de un aviso que sí había entrado descontaba
-- de nuevo. Ahora aceptan `idempotency_key` y devuelven el resultado del
-- primero sin tocar nada.
--
-- La clave no puede depender de qué filas estén pendientes en el momento de
-- reintentar: si entre el intento fallido y el siguiente entra una venta nueva,
-- el conjunto cambia, la clave cambia, y lo que ya se había aplicado se aplica
-- otra vez. Por eso el lote se fija cuando el aviso sale por primera vez y no
-- se mueve: se reintenta SIEMPRE el mismo lote, y lo que llegó después espera
-- al suyo.
ALTER TABLE b2b_stock_outbox ADD COLUMN IF NOT EXISTS lote UUID;
CREATE INDEX IF NOT EXISTS idx_b2b_stock_lote
  ON b2b_stock_outbox (lote) WHERE enviado_at IS NULL;

-- 3. El secreto del webhook entrante.
--
-- Lo generamos nosotros y el comerciante lo carga en su clave de API de
-- NexoB2B, que lo manda en X-Nexob2b-Secret. Mientras no esté cargado allá, el
-- webhook llega sin header y vale el token de la URL; con el secreto cargado,
-- se exige.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS b2b_webhook_secret TEXT;

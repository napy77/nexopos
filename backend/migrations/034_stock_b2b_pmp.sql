-- Dos cosas que abrió la última vuelta con NexoB2B.

-- 1. El id exacto: la fila del mayorista.
--
-- PUT /stock acepta ahora pmp_id, presentacion_id o ean, en ese orden de
-- precisión. Nosotros guardamos en products.nexob2b_id lo que haya: la
-- presentación maestra (pp_) para lo que entró por la importación de catálogo
-- propio, el listing del mayorista (pmp_) para lo que entró por una recepción
-- de compra. Con las tres aceptadas, cualquiera de los dos sirve tal cual y el
-- EAN sale del circuito —y con él, el último lugar donde una presentación
-- podía quedar sin nombrar—.
ALTER TABLE b2b_stock_outbox ADD COLUMN IF NOT EXISTS pmp_id TEXT;
ALTER TABLE b2b_stock_outbox DROP CONSTRAINT IF EXISTS b2b_stock_outbox_identificable;
ALTER TABLE b2b_stock_outbox ADD CONSTRAINT b2b_stock_outbox_identificable
  CHECK (pmp_id IS NOT NULL OR presentacion_id IS NOT NULL OR ean IS NOT NULL);

-- 2. Cuándo empezar a exigir el secreto.
--
-- El problema que plantearon: el comerciante carga el secreto acá, nosotros
-- empezamos a exigirlo, y del otro lado todavía no lo cargó nadie. Todos los
-- avisos rebotan con 401 y el que prendió el interruptor se cortó el circuito
-- a sí mismo.
--
-- Mientras esta fecha esté vacía, el secreto no se exige: vale el token de la
-- URL, como antes. El primer aviso que llegue firmado y correcto la escribe, y
-- de ahí en más el secreto es obligatorio y no se afloja más.
--
-- Regenerar la vuelve a vaciar, y tiene que ser así: un secreto nuevo que
-- todavía no cargaron allá es exactamente la misma situación del principio.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS b2b_webhook_secret_ok_at TIMESTAMPTZ;

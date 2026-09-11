-- Los datos del comercio que necesita la tienda online.
--
-- NexoB2B tiene el nombre, el CUIT y la ciudad, pero no la dirección de la
-- calle ni el teléfono público ni el horario: son datos de atención al
-- comprador, no de la relación con el mayorista.

ALTER TABLE commerces ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS category TEXT;

-- Si el comercio confirmó sus propios datos. Mientras sea false, NexoTienda los
-- muestra como no verificados: son datos que pusimos nosotros y no él.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;

-- El horario libre que escribe el comerciante, para mostrar. No se evalúa.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS opening_hours TEXT;

-- Mínimo para envío gratis, si lo configuró
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS free_delivery_over NUMERIC(12,2);

-- ── El horario, estructurado ────────────────────────────────────────────────
-- Hace falta aparte del texto porque hay dos cosas que dependen de saber si el
-- comercio está abierto AHORA: que la tienda lo muestre, y que el reloj del
-- vencimiento de un pedido no corra de madrugada.
--
-- De "Lun a Sáb de 8 a 13 y de 17 a 20:30" no sale ninguna de las dos: es
-- clarísimo para una persona y no se puede evaluar. Una heurística sobre ese
-- texto acertaría casi siempre y fallaría los domingos, que es cuando importa.
--
-- Varios tramos por día porque el almacén cierra al mediodía.
CREATE TABLE IF NOT EXISTS commerce_hours (
  id          BIGSERIAL PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
  dia         SMALLINT NOT NULL CHECK (dia BETWEEN 0 AND 6),  -- 0 = domingo
  desde       TIME NOT NULL,
  hasta       TIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_horas_comercio ON commerce_hours (commerce_id, dia);

-- ── Franjas de retiro y reparto ─────────────────────────────────────────────
-- Las franjas no son una limitación: son lo que hace rentable el reparto
-- propio, porque permiten salir a las 12 y a las 19 con cinco pedidos de la
-- misma zona. El reparto inmediato convierte cada pedido en un viaje.
CREATE TABLE IF NOT EXISTS commerce_slots (
  id          BIGSERIAL PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('retiro','reparto')),
  fee         NUMERIC(12,2) NOT NULL DEFAULT 0,
  orden       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_slots_comercio ON commerce_slots (commerce_id, orden);

-- ── Se vende en el mostrador, pero no online ────────────────────────────────
-- Distinto del flag de insumo: el insumo no se vende en ningún lado; esto se
-- vende en el mostrador y el comercio no lo quiere publicar —cigarrillos, algo
-- de peso variable, lo que sea—.
--
-- Arranca en true a propósito: la tienda es un subproducto de la tabla de
-- stock, no algo que haya que curar producto por producto. Que tenga que apagar
-- los pocos que no quiere, no encender los cientos que sí. Ese es el motivo por
-- el que los comercios chicos abandonan las apps de delivery.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS published_in_store BOOLEAN NOT NULL DEFAULT true;

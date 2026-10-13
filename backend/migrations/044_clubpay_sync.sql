-- Lo que ClubPay tiene que saber de nosotros y no es un movimiento: la
-- dirección de la tienda de cada comercio y si cada cliente tiene libreta
-- (CR-0003).
--
-- No va por `clubpay_outbox` porque esto es ESTADO, no eventos. Si el
-- comerciante abre y cierra la libreta mientras ClubPay está caído, lo que
-- importa es que al final le llegue "cerrada"; mandar los dos avisos en orden
-- es una forma de equivocarse si uno se reintenta y el otro no. Acá cada cosa
-- tiene una sola fila que dice "está desactualizado allá", y el envío lee el
-- estado del momento.
--
-- `version` sube con cada cambio. El envío borra la fila sólo si la versión es
-- la que mandó: si el comerciante cambió algo mientras viajaba el aviso, la
-- fila sobrevive y sale de nuevo con lo último.
CREATE TABLE IF NOT EXISTS clubpay_sync (
  tipo            TEXT NOT NULL CHECK (tipo IN ('tienda', 'libreta')),
  -- tienda → commerces.id · libreta → customers.id
  ref_id          BIGINT NOT NULL,
  commerce_id     BIGINT NOT NULL REFERENCES commerces(id),
  version         INT NOT NULL DEFAULT 1,
  intentos        INT NOT NULL DEFAULT 0,
  proximo_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_error    TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tipo, ref_id)
);

-- Los comercios que ya tienen dirección y clave de ClubPay se mandan una vez al
-- arrancar. ClubPay hoy conoce un solo slug, cargado a mano, y su web de alta
-- no sabe de qué comercio es cada tienda sin esto.
INSERT INTO clubpay_sync (tipo, ref_id, commerce_id)
SELECT 'tienda', id, id FROM commerces
 WHERE slug IS NOT NULL AND clubpay_api_key IS NOT NULL
ON CONFLICT (tipo, ref_id) DO NOTHING;

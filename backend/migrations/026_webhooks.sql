-- Avisos hacia NexoTienda cuando un pedido cambia de estado.
--
-- Misma forma que la cola de ClubPay, por la misma razón: el aviso no puede
-- frenar al comerciante —que la tienda esté caída no puede impedirle aceptar un
-- pedido— pero tampoco puede perderse, o la pantalla del comprador se queda
-- diciendo algo que ya no es cierto.
--
-- La fila se escribe en la misma transacción que el cambio de estado; la
-- llamada por red pasa después, afuera, donde puede fallar sin arrastrar nada.
CREATE TABLE IF NOT EXISTS webhook_outbox (
  id              BIGSERIAL PRIMARY KEY,
  commerce_id     BIGINT NOT NULL REFERENCES commerces(id),
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  intentos        INT NOT NULL DEFAULT 0,
  proximo_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_error    TEXT,
  enviado_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_pendientes
  ON webhook_outbox (proximo_intento) WHERE enviado_at IS NULL;

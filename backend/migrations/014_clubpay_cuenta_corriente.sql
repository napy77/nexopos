-- Cuenta corriente del cliente visible en la app de ClubPay.
-- Contrato acordado en docs/CLUBPAY-CUENTA-CORRIENTE.md.

-- ── Vinculación de la ficha del cliente con su cuenta de ClubPay ─────────────
-- Estados posibles, tal como los devuelve ClubPay al proponer la vinculación:
--   sin_cuenta  el DNI no está en ClubPay. No es un error: la mayoría de los
--               clientes de un almacén no tienen la app y la cuenta corriente
--               anda igual, solo que esa persona no la ve en el teléfono.
--   propuesta   ClubPay se lo propuso y la persona todavía no decidió.
--   aceptada    la persona confirmó: desde acá ve su saldo.
--   rechazada   dijo que no. No se le empujan movimientos.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS clubpay_status TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS clubpay_checked_at TIMESTAMPTZ;

-- ── Pagos que entran desde la app ───────────────────────────────────────────
-- El id de pago de ClubPay se guarda para que un reintento del webhook no
-- descuente dos veces. El índice único es el que lo garantiza de verdad: sin
-- él la protección dependería de que dos requests simultáneos no se crucen.
ALTER TABLE customer_transactions ADD COLUMN IF NOT EXISTS clubpay_payment_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ctx_clubpay_payment
  ON customer_transactions (clubpay_payment_id)
  WHERE clubpay_payment_id IS NOT NULL;

-- ── Cola de salida hacia ClubPay ────────────────────────────────────────────
-- El aviso a ClubPay no puede hacer fallar una venta: un problema de red no
-- puede dejar a un cajero sin poder cobrar. Pero tampoco puede perderse, o la
-- app le muestra al cliente un saldo que no es.
--
-- Por eso la fila entra en la MISMA transacción que el movimiento —si la venta
-- se guarda, el aviso existe— y el envío por red pasa después, afuera. Esto es
-- lo único que hace que las dos cosas sean ciertas a la vez.
CREATE TABLE IF NOT EXISTS clubpay_outbox (
  id              BIGSERIAL PRIMARY KEY,
  commerce_id     BIGINT NOT NULL REFERENCES commerces(id),
  -- Un aviso por movimiento: el UNIQUE evita duplicar si algo se reintenta
  -- del lado nuestro, antes incluso de que ClubPay tenga que deduplicar.
  transaction_id  BIGINT NOT NULL UNIQUE REFERENCES customer_transactions(id),
  payload         JSONB NOT NULL,
  intentos        INT NOT NULL DEFAULT 0,
  proximo_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_error    TEXT,
  enviado_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los pendientes son pocos y los enviados muchos: el índice parcial mantiene
-- barata la consulta del worker aunque la tabla crezca por años.
CREATE INDEX IF NOT EXISTS idx_clubpay_outbox_pendientes
  ON clubpay_outbox (proximo_intento)
  WHERE enviado_at IS NULL;

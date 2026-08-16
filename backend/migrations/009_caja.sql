-- Caja: apertura del día con fondo inicial, cierre con arqueo.
--
-- Una sesión de caja agrupa todo lo que pasó entre la apertura y el cierre:
-- las ventas (con su medio de pago), los cobros de cuenta corriente y los
-- movimientos manuales de dinero (retiros, pagos a proveedor, ingresos).

CREATE TABLE IF NOT EXISTS cash_sessions (
  id             BIGSERIAL PRIMARY KEY,
  commerce_id    BIGINT NOT NULL REFERENCES commerces(id),
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_amount NUMERIC(12,2) NOT NULL DEFAULT 0,   -- fondo con el que se abre
  opening_note   TEXT,
  closed_at      TIMESTAMPTZ,
  counted_amount NUMERIC(12,2),                      -- efectivo contado al cerrar
  closing_note   TEXT,
  -- Resumen congelado al cerrar: deja el arqueo tal como se vio ese día,
  -- aunque después se reembolse una venta o se edite algo.
  closing_summary JSONB
);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_commerce ON cash_sessions (commerce_id, opened_at DESC);
-- Una sola caja abierta por comercio
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_abierta
  ON cash_sessions (commerce_id) WHERE closed_at IS NULL;

-- Movimientos de dinero que no son ventas: retiro del dueño, pago a un
-- proveedor, un ingreso extra. Suman o restan del efectivo esperado.
CREATE TABLE IF NOT EXISTS cash_movements (
  id          BIGSERIAL PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id),
  session_id  BIGINT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('ingreso','egreso')),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements (session_id, created_at);

-- Las ventas quedan atadas a la sesión en la que se hicieron
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cash_session_id BIGINT REFERENCES cash_sessions(id);
CREATE INDEX IF NOT EXISTS idx_sales_session ON sales (cash_session_id);

-- Los cobros de cuenta corriente entran a la caja, y en qué forma importa
-- para el arqueo (si cobró en efectivo, el cajón tiene ese dinero).
ALTER TABLE customer_transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE customer_transactions ADD COLUMN IF NOT EXISTS cash_session_id BIGINT REFERENCES cash_sessions(id);

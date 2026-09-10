-- La cuenta corriente pasa de un saldo que se mueve a una pila de períodos.
--
-- Un resumen es un documento: estable, pagable, disputable y auditable. Un
-- saldo corriente no es ninguna de esas cosas —es una suma que cambia sola— y
-- por eso no se puede pagar online contra él: hace falta algo concreto contra
-- qué pagar.
--
-- El consumo del mes en curso NUNCA se suma con los resúmenes cerrados. Son dos
-- objetos distintos: uno es lo que ya se debe, el otro es lo que todavía está
-- pasando. Mezclarlos hace que el modelo deje de entenderse.

-- ── Configuración del comercio ──────────────────────────────────────────────
-- El día de cierre es del comercio y no nuestro: hay pueblos que cierran el 10
-- porque ahí cobra la gente, y el 31 fijo se rompe en la calle.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS closing_day INTEGER NOT NULL DEFAULT 31;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS due_day INTEGER NOT NULL DEFAULT 10;
ALTER TABLE commerces DROP CONSTRAINT IF EXISTS commerces_closing_day_check;
ALTER TABLE commerces ADD CONSTRAINT commerces_closing_day_check
  CHECK (closing_day BETWEEN 1 AND 31 AND due_day BETWEEN 1 AND 31);

-- Un comercio puede estar en el POS y no tener tienda publicada. En ese caso
-- NexoTienda muestra un cartel con sus datos, no un catálogo vacío.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS nexotienda_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── Los períodos ────────────────────────────────────────────────────────────
-- Uno por cliente y por ciclo. El día de cierre es del comercio, pero la pila
-- es de cada cliente: Juan puede tener dos resúmenes impagos y Ana ninguno.
--
-- Las fechas son DATE y no TIMESTAMPTZ a propósito. Un cierre "del 10" es una
-- fecha sin hora, y guardarla con huso la corre: en UTC, el día 10 argentino
-- arranca a las 21 del 9. Ya nos mordió una vez con las órdenes.
CREATE TABLE IF NOT EXISTS account_periods (
  id           BIGSERIAL PRIMARY KEY,
  commerce_id  BIGINT NOT NULL REFERENCES commerces(id),
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  -- Qué abarca. period_end es el día de cierre, inclusive.
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  label        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'abierto'
               CHECK (status IN ('abierto','cerrado','pagado_parcial','pagado')),
  -- Se congela al cerrar: de ahí en más el total no cambia aunque aparezca un
  -- movimiento viejo. Un documento que se mueve no es un documento.
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid         NUMERIC(12,2) NOT NULL DEFAULT 0,
  closed_at    TIMESTAMPTZ,
  due_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un solo período abierto por cliente: es lo que evita que dos ventas
-- simultáneas abran dos y los movimientos se repartan entre ambos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_periodo_abierto_unico
  ON account_periods (commerce_id, customer_id) WHERE status = 'abierto';
CREATE INDEX IF NOT EXISTS idx_periodos_cliente
  ON account_periods (customer_id, period_start);

-- Cada movimiento pertenece a un período. Los que ya existen quedan en NULL:
-- son de antes de que esto existiera y no se los puede repartir sin inventar.
ALTER TABLE customer_transactions ADD COLUMN IF NOT EXISTS period_id
  BIGINT REFERENCES account_periods(id);
CREATE INDEX IF NOT EXISTS idx_ctx_periodo ON customer_transactions (period_id);

-- Un pago puede repartirse entre varios resúmenes: $100.000 cancelan agosto y
-- dejan algo a cuenta de septiembre. Sin esta tabla no se podría decir cuánto
-- de ese pago fue a cada uno, que es lo que hace auditable el resumen.
CREATE TABLE IF NOT EXISTS account_payments (
  id             BIGSERIAL PRIMARY KEY,
  commerce_id    BIGINT NOT NULL REFERENCES commerces(id),
  period_id      BIGINT NOT NULL REFERENCES account_periods(id),
  transaction_id BIGINT NOT NULL REFERENCES customer_transactions(id),
  amount         NUMERIC(12,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_payments_periodo ON account_payments (period_id);

-- Descuento de socios ClubPay.
--
-- Criterio contable, y es lo que define este diseño: el descuento NO reduce
-- la venta. Una venta de $100.000 con $8.000 de beneficio se compone de
-- $92.000 cobrados + $8.000 de cupón que aplicó ClubPay. El comercio necesita
-- ver por separado cuánto vendió, cuánto cobró y cuánto entregó en beneficios.
--
-- Por eso las ventas pasan a tener varias formas de pago: hasta ahora había
-- una sola por venta y no alcanzaba para representar esto.

-- Clave de POS que ClubPay le da a cada comercio al activar el servicio
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS clubpay_api_key TEXT;

CREATE TABLE IF NOT EXISTS sale_payments (
  id          BIGSERIAL PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id),
  sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method      TEXT NOT NULL CHECK (method IN ('cash','wallet','card','transfer','account','coupon')),
  amount      NUMERIC(12,2) NOT NULL,
  -- Cupón: quién lo emitió y con qué comprobante, para poder conciliar
  -- cuando la institución le liquide al comercio lo que le reconoce.
  coupon_provider  TEXT,
  coupon_reference TEXT,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_commerce ON sale_payments (commerce_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_payments_cupon
  ON sale_payments (coupon_provider, coupon_reference) WHERE coupon_provider IS NOT NULL;

-- Datos del socio en la venta, para el ticket y para el detalle del turno
ALTER TABLE sales ADD COLUMN IF NOT EXISTS clubpay_transaction_id TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS clubpay_member TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS clubpay_club TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS clubpay_discount NUMERIC(12,2);

-- Las ventas que ya existen tenían una sola forma de pago: se registran como
-- tal para que el arqueo pueda leer siempre de sale_payments.
INSERT INTO sale_payments (commerce_id, sale_id, method, amount, created_at)
SELECT s.commerce_id, s.id, s.payment_method, s.total, s.created_at
FROM sales s
WHERE NOT EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id);

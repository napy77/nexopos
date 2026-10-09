-- Cobros con Mercado Pago, a través del vínculo que el comercio hizo en ClubPay.
--
-- Contrato: docs/RESPUESTA-COBROS-MERCADOPAGO-DE-CLUBPAY.md.
--
-- Se guarda cada cobro y no sólo el id en la venta o el pedido, por dos casos
-- que ClubPay avisó y que sin esta tabla no tienen dónde vivir:
--   · un cobro que el cajero canceló puede terminar pagado igual, si el
--     cliente ya estaba pagando. Hay que saber que lo cancelamos nosotros
--     para devolverlo en vez de perder la plata del cliente.
--   · un pedido puede tener varios intentos de pago (rechazó la tarjeta,
--     venció el link). Uno solo puede quedarse con la plata.
CREATE TABLE IF NOT EXISTS mp_cobros (
  id                 BIGSERIAL PRIMARY KEY,
  commerce_id        BIGINT NOT NULL REFERENCES commerces(id),
  payment_id         TEXT NOT NULL UNIQUE,   -- el de ClubPay
  external_reference TEXT NOT NULL UNIQUE,   -- el nuestro
  channel            TEXT NOT NULL CHECK (channel IN ('mostrador','tienda')),
  amount_cents       BIGINT NOT NULL,
  fee_cents          BIGINT NOT NULL DEFAULT 0,
  refunded_cents     BIGINT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL
                     CHECK (status IN ('pending','paid','rejected','expired','cancelled','refunded')),
  error              TEXT,
  paid_at            TIMESTAMPTZ,
  mp_payment_id      TEXT,
  sale_id            BIGINT REFERENCES sales(id),
  order_id           BIGINT REFERENCES orders(id),
  -- Lo cancelamos nosotros. Si igual se paga y no quedó en ninguna venta, se
  -- devuelve solo.
  abandonado         BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un cobro paga una sola venta. Con el índice y no de palabra: dos cajas
-- cerrando la venta con el mismo cobro a la vez es justo el caso.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_cobros_venta ON mp_cobros (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_cobros_pedido ON mp_cobros (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_cobros_comercio ON mp_cobros (commerce_id, created_at DESC);

-- Mercado Pago como forma de pago del mostrador. No es efectivo: va a la
-- cuenta del comercio, no al cajón.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash','wallet','card','transfer','account','online','mercadopago'));
ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
  CHECK (method IN ('cash','wallet','card','transfer','account','coupon','online','mercadopago'));

-- El pedido de la tienda: puede devolverse, y el rechazo trae un motivo que
-- el comprador tiene que leer.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('no_aplica','pendiente','pagado','rechazado','reembolsado'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_error TEXT;

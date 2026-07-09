-- Métodos de pago del POS estilo Odoo: contado, billetera (MP/QR),
-- tarjeta, transferencia, cuenta corriente. Y soporte de reembolsos.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash','wallet','card','transfer','account'));

-- Un reembolso es una venta espejo (cantidades negativas) que apunta a la original
ALTER TABLE sales ADD COLUMN IF NOT EXISTS refund_of BIGINT REFERENCES sales(id);

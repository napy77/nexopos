-- Con cuánto pagó el cliente, para calcular e imprimir el vuelto.
-- Solo aplica a pagos en efectivo; en el resto queda NULL.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2);

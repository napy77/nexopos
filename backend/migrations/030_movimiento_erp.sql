-- Un tipo de movimiento propio para lo que escribe el ERP.
--
-- Podría entrar como 'manual_adjustment', pero mentiría: el comerciante que
-- mira los movimientos para entender por qué un número no cuadra tiene que
-- poder distinguir lo que contó él de lo que le escribió su sistema. Son dos
-- explicaciones distintas y llevan a dos lugares distintos.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('purchase_reception','sale','manual_adjustment','return','erp'));

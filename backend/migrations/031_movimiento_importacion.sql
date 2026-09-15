-- El stock que entra al importar el catálogo propio.
--
-- Mismo criterio que 030: el comerciante que revisa por qué un número no
-- cuadra tiene que poder distinguir lo que contó él de lo que llegó con la
-- importación. Y en este caso además importa la fecha: ese número es una foto
-- del stock que tenía en NexoB2B el día que importó, no un espejo.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('purchase_reception','sale','manual_adjustment','return','erp','import'));

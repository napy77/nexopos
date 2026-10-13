-- Una cuenta de ClubPay es una sola ficha por comercio (CR-0003).
--
-- ClubPay lo garantiza de su lado (una relación por persona y comercio), y el
-- canje de cuentas nacidas en la tienda busca la ficha por esa cuenta: con dos
-- fichas para la misma cuenta, cuál devuelve dependería del orden de lectura.
--
-- El índice se crea sólo si los datos lo permiten. Una migración que falla deja
-- el servidor sin arrancar (process.exit), y un par repetido de antes de esto
-- no es motivo para tirar abajo los mostradores. Si hay repetidos, el arranque
-- lo avisa y el canje sigue protegido por su bloqueo; se limpian a mano y el
-- índice se crea con la consulta de abajo.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM customers
     WHERE clubpay_account_id IS NOT NULL
     GROUP BY commerce_id, clubpay_account_id HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'Hay cuentas de ClubPay repetidas en un mismo comercio: no se creó idx_customers_cuenta_clubpay';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_cuenta_clubpay
      ON customers (commerce_id, clubpay_account_id)
      WHERE clubpay_account_id IS NOT NULL;
  END IF;
END $$;

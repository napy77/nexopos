-- La libreta abierta desde la tienda.
--
-- Cuándo empezó a valer el vínculo actual de este cliente con ClubPay.
--
-- Es la única revocación que existe en este diseño, y NexoTienda tiene razón en
-- pedirla: una sesión de libreta vive en una cookie de un navegador ajeno, y si
-- el comerciante desvincula al cliente —o la persona pierde el teléfono— no hay
-- nadie que pueda cerrarla. Ni nosotros, ni ClubPay, ni ellos.
--
-- Con esta fecha alcanza: la tienda compara contra cuándo se abrió la sesión y
-- cierra sola las anteriores. Se mueve cada vez que el vínculo cambia de estado,
-- así que "desvinculado" y "vinculado de nuevo con otra cuenta" invalidan igual.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS clubpay_linked_at TIMESTAMPTZ;

-- Las que ya están vinculadas arrancan con la fecha de la última consulta, que
-- es lo más cercano a la verdad que tenemos. Dejarlas en NULL diría "nunca se
-- vinculó" de gente que sí está vinculada.
UPDATE customers
   SET clubpay_linked_at = COALESCE(clubpay_checked_at, created_at)
 WHERE clubpay_status IN ('vinculada', 'aceptada') AND clubpay_linked_at IS NULL;

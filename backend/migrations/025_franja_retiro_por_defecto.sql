-- Las tiendas ya publicadas que quedaron sin ninguna franja.
--
-- El switch de "retira del local" no alcanzaba: lo que el comprador elige en la
-- tienda es una franja, y sin ninguna cargada todo pedido se rechazaba. La
-- tienda quedaba publicada y linda, sin poder recibir un pedido —que es peor
-- que no estar publicada, porque el que se entera es el cliente cuando ya
-- armó el changuito—.
--
-- Se les crea la franja obvia. "Retiro en el local" no necesita que nadie
-- elija un horario; el reparto sí, porque tiene su costo y su ventana, así que
-- ese lo sigue cargando el comerciante.
INSERT INTO commerce_slots (commerce_id, label, kind, fee, orden)
SELECT c.id, 'Retiro en el local', 'retiro', 0, 0
  FROM commerces c
 WHERE c.nexotienda_enabled
   AND c.pickup_enabled
   AND NOT EXISTS (SELECT 1 FROM commerce_slots s WHERE s.commerce_id = c.id);

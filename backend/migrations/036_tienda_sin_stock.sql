-- Si la tienda muestra lo que no tiene.
--
-- Hay dos comercios distintos en esto y los dos tienen razón.
--
-- El almacén de barrio quiere mostrar todo: el cliente ve que el producto
-- existe, que lo tiene habitualmente, y vuelve mañana. Esconderlo es perder la
-- venta de pasado mañana.
--
-- El que importó tres mil artículos de un catálogo mayorista quiere lo
-- contrario: la mayoría no los tiene en el mostrador, y una tienda que abre con
-- veinte "No disponible" seguidos parece cerrada.
--
-- Por defecto se muestran, que es lo que la tienda hace hoy: un cambio de
-- comportamiento no puede entrar por la puerta de atrás en la tienda de nadie.
ALTER TABLE commerces
  ADD COLUMN IF NOT EXISTS tienda_muestra_sin_stock BOOLEAN NOT NULL DEFAULT true;

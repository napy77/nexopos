-- La libreta pasa a ser un permiso que da el comercio, no algo que viene con
-- ser cliente (CR-0003).
--
-- Hasta acá toda ficha de `customers` era una libreta: la abría el comerciante
-- en el mostrador, a sabiendas, y sin límite cargado no tenía tope —así
-- funciona el cuaderno—. Con CR-0003 van a aparecer clientes que nadie dio de
-- alta: personas que se identifican en la tienda con un correo verificado. Si
-- nacieran con libreta, cualquiera con un correo podría comprar fiado sin tope.
--
-- Por eso el default es `false` y lo que ya existe se marca `true` a mano: lo
-- que entre por una puerta nueva, o por una que nos olvidemos, nace cerrado.
-- Un cajero que no puede fiar lo ve en el momento y lo arregla con un toque;
-- un fiado que no debió darse se descubre a fin de mes.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS libreta_activa BOOLEAN NOT NULL DEFAULT false;
UPDATE customers SET libreta_activa = true;

-- Por dónde entró la persona. Sirve para que la ficha explique por qué no tiene
-- libreta ("se identificó en la tienda") en vez de que parezca un error.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'mostrador'
  CHECK (origen IN ('mostrador', 'tienda'));

-- Las reglas de identidad para pedidos de la tienda, por comercio. Arranca
-- apagado: prenderlo cambia qué pedidos se aceptan, y eso lo decide cada
-- comerciante, no un deploy. Todavía no lo lee nadie; las reglas vienen después.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS identity_rules_enabled BOOLEAN NOT NULL DEFAULT false;

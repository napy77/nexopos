-- Reglas para los pedidos de la tienda que se pagan en mano (CR-0003).
--
-- Un pedido falso con pago al retirar le hace armar al comercio cincuenta
-- productos que nadie va a buscar, y con reparto le manda el pedido a la casa
-- de alguien que no pidió nada. El correo verificado de ClubPay prueba que hay
-- una casilla detrás, no quién es: lo que protege al comercio son los topes.
--
-- Todo arranca apagado (`commerces.identity_rules_enabled`, de la 043). Los
-- topes de ejemplo los aprobó German el 13/10; no salen de estadística —había
-- 22 tickets de un solo comercio— sino de criterio. Viven en el código
-- (modules/reglas-pedidos.ts) y se copian acá recién cuando el comerciante los
-- cambia: así un ajuste del ejemplo llega a todos los que no tocaron nada.

-- Una fila por nivel de verificación, sólo si el comerciante la cambió.
CREATE TABLE IF NOT EXISTS commerce_order_limits (
  commerce_id        BIGINT NOT NULL REFERENCES commerces(id),
  verification_level SMALLINT NOT NULL CHECK (verification_level BETWEEN 0 AND 3),
  pickup_cash        BOOLEAN NOT NULL,      -- puede pagar al retirar
  delivery_cash      BOOLEAN NOT NULL,      -- puede pagar al recibir el reparto
  max_total          NUMERIC(12,2),         -- en pesos; null = sin tope
  max_items          INT,                   -- renglones del pedido; null = sin tope
  PRIMARY KEY (commerce_id, verification_level)
);

-- Pedidos de cuentas sin retiros previos por encima de esto entran marcados
-- para que el comerciante los mire antes de aceptar. Null = el ejemplo.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS review_threshold NUMERIC(12,2);
-- Cuántos retiros entregados hacen falta para pagar al recibir un reparto.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS delivery_cash_min_pickups INT;

-- Bloquear a una persona en la tienda de ESTE comercio. No hay lista global a
-- propósito: que un comercio bloquee a alguien no es un dato para los demás.
-- El motivo es interno, no se le muestra al comprador.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tienda_bloqueada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bloqueo_motivo TEXT;

-- Con qué nivel entró el pedido, para poder explicar después por qué se
-- aceptó; y si el comerciante tiene que mirarlo antes de aceptarlo.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS verification_level SMALLINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_reason TEXT
  CHECK (review_reason IN ('cuenta_nueva_monto_alto', 'identidad_no_disponible'));

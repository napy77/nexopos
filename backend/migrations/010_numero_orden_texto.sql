-- El número de orden de NexoB2B pasó de ser un entero secuencial (1042) a un
-- identificador con prefijo ("ORD-00033"), así que guardarlo como INTEGER
-- hacía fallar el alta de toda compra nueva.
--
-- Es un número de documento, no una cantidad: nunca se hace aritmética con él.
ALTER TABLE purchase_orders ALTER COLUMN numero TYPE TEXT USING numero::text;

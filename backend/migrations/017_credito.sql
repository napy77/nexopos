-- Límite, pausa e identidad del comprador.

-- ── El id de la persona en ClubPay ──────────────────────────────────────────
-- Se guarda en la fila de ESTE comercio, no en una tabla de personas. Es la
-- diferencia entre poder resolver "esta persona en esta tienda" —que es lo
-- único que hace falta— y tener el mapa de en qué comercios debe cada uno.
--
-- Ese mapa ya existe en ClubPay (merchant_customers) y ahí se queda: la vista
-- agregada es del deudor y la arma su billetera. Duplicarla acá sería una
-- segunda copia de la misma verdad, dentro del sistema donde se loguean los
-- comerciantes.
--
-- Toda consulta por este campo lleva commerce_id. No es decoración.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS clubpay_person_id TEXT;

-- ── Límite de fiado ─────────────────────────────────────────────────────────
-- NULL es sin límite, que es como funciona el cuaderno y tiene que seguir
-- siendo el default: ponerle un tope a todo el mundo el día que se enciende
-- esto sería cambiarle las reglas a relaciones que ya existen.
--
-- El límite existe porque el mostrador y la cara del almacenero eran el control
-- de riesgo del fiado, y comprando desde el sillón ese freno no está.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2);

-- ── Pausa ───────────────────────────────────────────────────────────────────
-- Se pausó el crédito, no el comercio: la persona puede seguir comprando
-- pagando de otra forma. Si además le cortáramos la venta, el comerciante
-- perdería la de hoy por una deuda de julio, que es justo lo que ningún
-- almacenero haría.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_paused BOOLEAN NOT NULL DEFAULT false;

-- ── Fiado desde la tienda online ────────────────────────────────────────────
-- Apagado por default, para el comerciante conservador que quiere entrar sin
-- abrir de una la compra fiada desde casa.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS online_credit_enabled BOOLEAN NOT NULL DEFAULT false;

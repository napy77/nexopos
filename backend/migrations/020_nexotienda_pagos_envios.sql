-- Qué acepta el comercio en su tienda online: cómo le pagan y cómo entrega.
--
-- Van como columnas y no como un JSONB de configuración porque son decisiones
-- con consecuencias —una tienda sin forma de pago toma pedidos que nadie puede
-- pagar— y sobre columnas se pueden escribir las reglas que lo impiden.

-- ── Cómo le pagan ───────────────────────────────────────────────────────────
-- Contra entrega: paga cuando el delivery llega o cuando pasa a retirar.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS pay_on_delivery_enabled BOOLEAN NOT NULL DEFAULT true;

-- Transferencia. El alias y el titular no son decoración: sin ellos el
-- comprador no tiene a dónde transferir, y un pedido que nadie puede pagar
-- queda colgado hasta que alguien llama por teléfono. Por eso habilitarla sin
-- esos datos se rechaza.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS transfer_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS transfer_alias TEXT;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS transfer_holder TEXT;

-- ClubPay. Depende de que el comercio tenga su clave cargada: sin eso el botón
-- existiría y no cobraría nada.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS clubpay_pay_enabled BOOLEAN NOT NULL DEFAULT false;

-- La cuenta corriente online ya existe como online_credit_enabled (017): es la
-- misma decisión y no se duplica.

-- ── Cómo entrega ────────────────────────────────────────────────────────────
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS pickup_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS own_delivery_enabled BOOLEAN NOT NULL DEFAULT false;

-- NexoRider no tiene columna a propósito: todavía no existe, y una columna que
-- se puede poner en true prometería algo que no va a pasar. Se muestra en la
-- pantalla como "próximamente" y no se guarda nada.

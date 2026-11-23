-- El correo de quien hace el pedido en la tienda.
--
-- Opcional, como el resto del contacto. Va en el pedido y no sólo en la ficha
-- porque la mayoría de los pedidos son anónimos y no tienen ficha, y es a ese
-- correo al que algún día va a ir el ticket o el aviso de "tu pedido está
-- listo". Si el pedido trae cuenta, además completa la ficha vacía.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_email TEXT;

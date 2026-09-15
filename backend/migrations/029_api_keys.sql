-- Claves de API del comercio, para que su ERP —o Odoo, o lo que sea— pueda
-- leer y escribir sin pasar por la pantalla del POS.
--
-- Es lo que permite no obligar al uso de NexoPOS: un negocio con 3000
-- productos no le va a poner precio a mano, y el que ya tiene un sistema no lo
-- va a tirar para usar el nuestro.

CREATE TABLE IF NOT EXISTS api_keys (
  id           BIGSERIAL PRIMARY KEY,
  commerce_id  BIGINT NOT NULL REFERENCES commerces(id) ON DELETE CASCADE,
  -- Para qué es. "ERP Rivera", "Odoo", "pruebas de Juan": cuando haya que
  -- revocar una, el comerciante tiene que saber cuál está apagando.
  nombre       TEXT NOT NULL,

  /*
   * Se guarda el hash, nunca la clave.
   *
   * Un backup, un dump de la base o una consulta de soporte no pueden exponer
   * algo con lo que se escriben precios y stock. La clave se muestra UNA vez,
   * cuando se crea; si se pierde, se crea otra y se revoca la anterior. Eso es
   * incómodo a propósito: una clave recuperable es una clave que alguien puede
   * ir a buscar.
   */
  hash         TEXT NOT NULL UNIQUE,
  -- Los primeros caracteres, para reconocerla en la lista sin revelarla
  prefijo      TEXT NOT NULL,

  -- Cuándo se usó por última vez: es lo que permite revocar una clave vieja
  -- sin miedo a romper algo que todavía anda.
  usada_at     TIMESTAMPTZ,
  revocada_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_comercio ON api_keys (commerce_id);

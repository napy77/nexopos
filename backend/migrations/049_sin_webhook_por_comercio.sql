-- Fuera la puerta de stock por comercio (`/api/nexob2b/stock/:token`).
--
-- Pedía copiar una URL y un secreto a NexoB2B por cada comercio, y el portal
-- del comercio no tiene dónde pegarlos. NexoB2B ya avisa por la puerta de
-- plataforma (`POST /api/nexob2b/stock`, el comercio por su id) y la vieja no
-- recibió ni un aviso en producción. Se borran las columnas y no sólo la ruta:
-- un token y un secreto que no sirven para nada siguen siendo algo que se filtra.
ALTER TABLE commerces DROP COLUMN IF EXISTS b2b_webhook_token;
ALTER TABLE commerces DROP COLUMN IF EXISTS b2b_webhook_secret;
ALTER TABLE commerces DROP COLUMN IF EXISTS b2b_webhook_secret_ok_at;

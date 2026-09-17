-- Campañas: las tandas de ofertas que el comercio publica en su tienda.
--
-- El comerciante pone un nombre —"Ofertas imperdibles", que es el título de la
-- sección tal cual se ve—, una ventana de días, un porcentaje y qué productos
-- entran.
--
-- El descuento se aplica de este lado y el precio viaja ya rebajado. Si lo
-- multiplicara la tienda, el changuito diría un número y la nota de venta otro,
-- y de los dos el que vale es el nuestro.
CREATE TABLE IF NOT EXISTS campaigns (
  id          BIGSERIAL PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id),
  nombre      TEXT NOT NULL,
  /*
   * Días, no timestamps. El comerciante piensa "del 1 al 15", y el 15 incluye
   * el 15 entero. La hora exacta del corte se deriva de la fecha en la zona del
   * comercio; guardarla acá invitaría a que alguien la cargue en UTC y la
   * campaña termine a las nueve de la noche del día anterior.
   */
  desde       DATE NOT NULL,
  hasta       DATE NOT NULL,
  /*
   * Tope en 95: un 100 tipeado de más regala la mercadería, y eso no se
   * descubre hasta que alguien cierra la caja. El que quiera regalar algo tiene
   * formas más explícitas de hacerlo.
   */
  descuento   NUMERIC(5,2) NOT NULL CHECK (descuento > 0 AND descuento <= 95),
  /** En qué orden se ven las secciones en la tienda. Lo decide el comerciante. */
  orden       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_ventana CHECK (hasta >= desde)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_vigentes
  ON campaigns (commerce_id, desde, hasta);

CREATE TABLE IF NOT EXISTS campaign_products (
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  PRIMARY KEY (campaign_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_products_producto
  ON campaign_products (product_id);

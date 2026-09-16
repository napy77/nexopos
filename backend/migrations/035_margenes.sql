-- Márgenes: ponerle precio a miles de productos sin tocarlos de a uno.
--
-- Un comercio que importa su catálogo o recibe una compra se queda con miles de
-- productos con costo y sin precio de venta. Sin precio no se pueden vender ni
-- salen a la tienda, y cargarlos a mano no es trabajo de un día: es trabajo que
-- no se hace nunca.
--
-- La regla se busca de lo más específico a lo más general —producto, subrubro,
-- rubro, pasillo, global— y gana la primera que aparezca. El que no tiene nada
-- propio hereda lo de arriba.

CREATE TABLE IF NOT EXISTS price_rules (
  id          BIGSERIAL PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id),
  nivel       TEXT NOT NULL CHECK (nivel IN ('global','pasillo','rubro','subrubro','producto')),
  /*
   * Qué acota la regla. NULL en 'global'; el id del producto en 'producto'.
   *
   * En los tres niveles de taxonomía es el NOMBRE y no el id, por lo mismo que
   * las solapas de la tienda: la importación de catálogo propio guarda los
   * nombres y no los ids, así que una regla por id no alcanzaría a ninguno de
   * los productos del comercio que más necesita esto.
   */
  clave       TEXT,
  /** Porcentaje sobre el costo. Negativo es un descuento. */
  margen      NUMERIC(6,2) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE a secas no sirve: en Postgres dos NULL no chocan, y 'global' quedaría
-- repetible.
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_rules_unica
  ON price_rules (commerce_id, nivel, COALESCE(clave, ''));

-- Si el precio lo escribió una persona.
--
-- Es lo que separa "este precio lo calculó el margen y se puede recalcular" de
-- "este lo puso el comerciante y no se toca". Sin esa distinción, aplicar
-- márgenes le pisaría los precios que eligió uno por uno.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS precio_manual BOOLEAN NOT NULL DEFAULT false;

-- Todo lo que hoy tiene precio lo puso alguien a mano: hasta ahora no había
-- otra forma de ponerlo. Marcarlo es la lectura segura; al revés sería estrenar
-- la función pisando lo que ya andaba.
UPDATE stock_items SET precio_manual = true WHERE sale_price IS NOT NULL;

-- Cómo se arma el precio final, por comercio.
--
-- El costo es NETO —el precio de NexoB2B es sin IVA, y la recepción de compra
-- se lo suma aparte— y el precio del mostrador es FINAL: la venta no le agrega
-- nada encima. Así que sin sumar el IVA, cada producto saldría un 21% —o un
-- 10,5%— por debajo de lo que el comerciante cree que le está cobrando.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS margen_suma_iva BOOLEAN NOT NULL DEFAULT true;

-- A cuánto redondear hacia arriba. 0 = sin redondear.
--
-- Un precio de $8.437,53 no es un precio: es el resultado de una cuenta. Nadie
-- lo escribe en un cartel ni lo cobra en un mostrador.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS margen_redondeo NUMERIC(10,2) NOT NULL DEFAULT 10;

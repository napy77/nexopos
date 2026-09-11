-- Los pedidos de la tienda online.
--
-- Un pedido NO es una venta todavía. Nace cuando alguien cierra el carrito, y
-- recién se convierte en nota de venta cuando se entrega: ahí entra la plata,
-- ahí se descuenta la caja y ahí se anota el fiado. Que le llegue al comercio
-- no es que lo haya aceptado, y que lo haya aceptado no es que lo haya cobrado.

CREATE TABLE IF NOT EXISTS orders (
  id           BIGSERIAL PRIMARY KEY,
  commerce_id  BIGINT NOT NULL REFERENCES commerces(id),
  -- Lo que el comprador ve y comparte. Va en la URL de seguimiento, así que no
  -- es secuencial: con un número correlativo cualquiera mira los pedidos del
  -- vecino cambiando un dígito.
  code         TEXT NOT NULL UNIQUE,

  status       TEXT NOT NULL DEFAULT 'recibido'
               CHECK (status IN ('recibido','aceptado','listo','en_camino','entregado','cancelado')),

  -- Quién compró. Una de las dos, nunca las dos:
  --   customer_id  → compró a la libreta, y esa cuenta se abrió en el mostrador
  --   contact_*    → compra anónima, que es la mayoría: alguien pide dos
  --                  paquetes de harina y paga al recibirlos. Lo único que
  --                  sabemos es un nombre y un teléfono, y alcanza, porque lo
  --                  que el comercio necesita es poder avisarle.
  customer_id  BIGINT REFERENCES customers(id),
  contact_name TEXT,
  contact_phone TEXT,

  slot_id      BIGINT REFERENCES commerce_slots(id),
  slot_label   TEXT NOT NULL DEFAULT '',
  slot_kind    TEXT NOT NULL DEFAULT 'retiro' CHECK (slot_kind IN ('retiro','reparto')),
  address      TEXT,
  notes        TEXT,

  payment_method TEXT NOT NULL
                 CHECK (payment_method IN ('efectivo_entrega','online','cuenta_corriente')),
  payment_status TEXT NOT NULL DEFAULT 'no_aplica'
                 CHECK (payment_status IN ('no_aplica','pendiente','pagado','rechazado')),
  payment_id   TEXT,

  subtotal     NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Para cuándo lo tiene. Lo declara el comercio al aceptar; la plataforma
  -- nunca lo inventa: es una promesa sobre el trabajo de otro.
  ready_estimate TEXT,

  -- Texto libre del comerciante, no un código nuestro. "No me quedan de ananá,
  -- tengo de muzzarella; pasá igual y te las hago" mantiene la venta y la
  -- relación; "cancelado: sin stock" las corta las dos.
  cancel_reason TEXT,
  cancelled_by  TEXT CHECK (cancelled_by IN ('comercio','comprador','vencimiento')),

  /** La nota de venta que salió de este pedido, cuando se entregó */
  sale_id      BIGINT REFERENCES sales(id),

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_comercio ON orders (commerce_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_abiertos ON orders (commerce_id)
  WHERE status IN ('recibido','aceptado','listo','en_camino');

CREATE TABLE IF NOT EXISTS order_lines (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'unidad',
  quantity   NUMERIC(12,3) NOT NULL,
  -- Congelado al crear el pedido: si el comercio cambia el precio mientras el
  -- pedido está en curso, se cobra el que el comprador vio.
  unit_price NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_lines ON order_lines (order_id);

-- Un pedido cobrado online entra a la caja como lo que es. Sin esto habría que
-- disfrazarlo de transferencia, y el arqueo del comercio mentiría.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash','wallet','card','transfer','account','online'));

-- De qué pedido salió esta venta, para poder ir y volver
ALTER TABLE sales ADD COLUMN IF NOT EXISTS order_id BIGINT REFERENCES orders(id);

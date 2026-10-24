-- Alta masiva de productos: por CSV desde la pantalla, o por la API del ERP.
--
-- Un comercio con dos mil productos comprados no los va a cargar de a uno. Pero
-- dos mil EAN que NexoPOS no conoce son dos mil consultas al catálogo de
-- NexoB2B, que tardan minutos, y nginx corta la conexión al minuto. Por eso la
-- importación es un trabajo con estado y no un request: se analiza en segundo
-- plano, el comerciante ve la vista previa, y recién ahí se aplica.
--
-- Queda guardada después de aplicada: dentro de un mes, cuando un precio no
-- cuadre, la pregunta va a ser de dónde salió.
CREATE TABLE IF NOT EXISTS importaciones (
  id          BIGSERIAL PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id),
  origen      TEXT NOT NULL CHECK (origen IN ('csv', 'api')),
  -- analizando → lista → aplicando → aplicada, o error en cualquier punto.
  -- La API no espera a nadie: pasa de lista a aplicada sola.
  estado      TEXT NOT NULL DEFAULT 'analizando'
              CHECK (estado IN ('analizando', 'lista', 'aplicando', 'aplicada', 'error')),
  auto_aplicar BOOLEAN NOT NULL DEFAULT false,
  archivo     TEXT,                 -- el nombre del CSV, para reconocerlo después
  total       INT NOT NULL,
  procesadas  INT NOT NULL DEFAULT 0,
  filas       JSONB NOT NULL,       -- lo que llegó, ya normalizado
  plan        JSONB,                -- qué se va a hacer con cada fila
  resumen     JSONB,                -- cuántas de cada cosa
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_importaciones_comercio ON importaciones (commerce_id, created_at DESC);

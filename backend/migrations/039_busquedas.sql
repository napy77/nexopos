-- Lo que la gente busca en la tienda.
--
-- NexoTienda pide "lo más buscado" como ids de producto. Hoy la búsqueda se
-- resuelve del lado de ellos, en memoria, así que nadie tiene ese dato: con el
-- filtro `q` en el catálogo la búsqueda pasa por acá y se puede empezar a
-- juntar.
--
-- Se guarda el término y nada más. No hay ip, ni sesión, ni quién: para saber
-- qué le falta a la góndola alcanza con qué se buscó, y lo demás sería juntar
-- datos de personas porque se puede.
CREATE TABLE IF NOT EXISTS store_searches (
  id          BIGSERIAL PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id),
  termino     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_searches_reciente
  ON store_searches (commerce_id, created_at DESC);

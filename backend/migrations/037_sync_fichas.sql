-- Hasta dónde leímos de cada sincronización incremental.
--
-- El cursor lleva fecha Y id, no sólo fecha. NexoB2B lo midió: un UPDATE
-- masivo deja varias filas con la marca de tiempo idéntica —las filas se
-- procesan más rápido que la resolución del reloj— y con 7000 productos los
-- empates son la norma. Paginando sólo por fecha, `> desde` saltea todo lo que
-- comparta marca con el último de la página y `>= desde` devuelve siempre la
-- misma página. Los dos fallan callados, que es lo peor que puede hacer una
-- sincronización.
CREATE TABLE IF NOT EXISTS sync_cursor (
  clave      TEXT PRIMARY KEY,
  fecha      TIMESTAMPTZ,
  id         TEXT,
  corrida_at TIMESTAMPTZ,
  ultimo_error TEXT,
  leidos     INT NOT NULL DEFAULT 0
);

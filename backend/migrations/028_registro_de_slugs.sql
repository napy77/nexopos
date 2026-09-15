-- Un registro único para todo lo que cuelga del dominio.
--
-- Hasta acá los slugs vivían en tres tablas —comercios, sus slugs anteriores y
-- regiones— y la unicidad se chequeaba consultando las tres. Eso deja una
-- ventana: entre que se pregunta si está libre y se guarda, alguien lo toma.
-- NexoB2B lo levantó y tienen razón; una lectura no reserva nada.
--
-- Con una sola tabla, la clave primaria ES la reserva: dos intentos
-- simultáneos no pueden ganar los dos, y no hay ventana que cerrar porque no
-- hay dos pasos.
CREATE TABLE IF NOT EXISTS slugs (
  slug       TEXT PRIMARY KEY,
  tipo       TEXT NOT NULL CHECK (tipo IN ('comercio', 'region')),
  -- A qué comercio o región pertenece. Los slugs que un comercio dejó atrás
  -- quedan acá con su comercio: siguen siendo suyos, y por eso los puede
  -- retomar y nadie más los puede agarrar.
  ref_id     BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los que ya estaban, para que el registro arranque completo
INSERT INTO slugs (slug, tipo, ref_id)
SELECT slug, 'comercio', id FROM commerces WHERE slug IS NOT NULL
ON CONFLICT (slug) DO NOTHING;

INSERT INTO slugs (slug, tipo, ref_id)
SELECT slug, 'comercio', commerce_id FROM commerce_previous_slugs
ON CONFLICT (slug) DO NOTHING;

INSERT INTO slugs (slug, tipo, ref_id)
SELECT slug, 'region', NULL FROM regions
ON CONFLICT (slug) DO NOTHING;

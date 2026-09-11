-- La dirección web del comercio y las regiones del pueblo.
--
-- Comercios y regiones comparten un solo espacio de nombres: lo que va antes
-- del punto en {algo}.nexotienda.app puede ser un comercio o un pueblo, nunca
-- los dos. Si un comercio tomara "morrison" se quedaría con la página del
-- pueblo.
--
-- Los slugs se crean en dos sistemas —las regiones en el admin de Nexo B2B, los
-- comercios acá— así que alguien tiene que arbitrar. Es NexoPOS, porque es
-- quien contesta qué es cada subdominio.

ALTER TABLE commerces ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commerces_slug ON commerces (slug) WHERE slug IS NOT NULL;

-- ── Los slugs que el comercio tuvo antes ────────────────────────────────────
-- Cambiar de slug rompe links, y acá los links viajan por WhatsApp: el estado
-- del súper, el grupo del barrio, la señora que reenvía. Los viejos siguen
-- resolviendo —NexoTienda redirige al actual— y quedan tomados PARA SIEMPRE:
-- reasignarlos le daría a otro comercio el tráfico del primero.
CREATE TABLE IF NOT EXISTS commerce_previous_slugs (
  slug        TEXT PRIMARY KEY,
  commerce_id BIGINT NOT NULL REFERENCES commerces(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Las regiones ────────────────────────────────────────────────────────────
-- Copia local de lo que administra Nexo B2B, con el mismo criterio con que ya
-- espejamos la taxonomía: para servir la página del pueblo sin preguntar en
-- cada request, y para validar los slugs de comercio contra ellas.
--
-- El slug no se deriva del nombre a propósito: hay varias Santa Rosa y varios
-- San Martín, y el segundo homónimo que entre colisionaría con el primero.
CREATE TABLE IF NOT EXISTS regions (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  province    TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL DEFAULT '',
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Qué comercio va en qué región ───────────────────────────────────────────
-- Dos decisiones distintas que conviene no mezclar:
--
--   pertenece  — se deriva de su zona de reparto. Lo decide Nexo, en B2B.
--   aparece    — si sale listado en la página del pueblo. Lo decide el
--                comerciante, y arranca apagado.
--
-- Lo segundo es opt-in porque poner a dos supermercados del mismo pueblo uno al
-- lado del otro con los precios a la vista es un objeto social distinto en un
-- pueblo que en Amazon: los dos dueños se conocen.
CREATE TABLE IF NOT EXISTS commerce_regions (
  commerce_id BIGINT NOT NULL REFERENCES commerces(id),
  region_slug TEXT NOT NULL REFERENCES regions(slug) ON DELETE CASCADE,
  aparece     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (commerce_id, region_slug)
);

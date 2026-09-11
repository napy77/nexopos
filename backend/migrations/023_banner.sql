-- El banner de la tienda: la foto ancha que va arriba de todo.
--
-- Va aparte del logo porque son dos cosas distintas: el logo identifica al
-- comercio en una lista de comercios, el banner es la cara de SU tienda. Un
-- logo estirado a lo ancho se ve mal, y una foto de la verdulería achicada a
-- un cuadradito no se entiende.
ALTER TABLE commerces ADD COLUMN IF NOT EXISTS banner_url TEXT;

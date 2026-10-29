-- Quién operó, cuando no fue el comercio.
--
-- El equipo Nexo puede entrar a la caja de un comercio sin su contraseña
-- (`/entrar`, modo soporte) para ayudarlo. Lo que haga queda hecho en la
-- cuenta del comercio, y el comercio tiene que poder ver que esa venta o esa
-- caja no las hizo él. NULL es el comercio; un email, el equipo Nexo.
--
-- Texto y no una FK: el admin vive en B2B y acá no hay tabla de usuarios.
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS operado_por TEXT;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS abierta_por TEXT;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS cerrada_por TEXT;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS operado_por TEXT;

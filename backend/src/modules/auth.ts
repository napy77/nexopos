import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { login as b2bLogin, isMockMode } from "../integrations/nexob2b.js";
import { HttpError } from "../middleware/error.js";

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * POST /api/auth/login
 * Valida credenciales contra NexoB2B y emite el JWT propio del POS (12 h).
 * El token de NexoB2B (30 días) se guarda por comercio y se usa para todas
 * las llamadas al marketplace en su nombre.
 */
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await b2bLogin(email, password);
    if (!result) throw new HttpError(401, "Credenciales inválidas o cuenta suspendida");
    const { token: b2bToken, comercio } = result;

    const { rows } = await pool.query(
      `INSERT INTO commerces (nexob2b_id, name, email, nexob2b_token, estado, ciudad, provincia)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE SET
         nexob2b_id = EXCLUDED.nexob2b_id, name = EXCLUDED.name,
         nexob2b_token = EXCLUDED.nexob2b_token, estado = EXCLUDED.estado,
         ciudad = EXCLUDED.ciudad, provincia = EXCLUDED.provincia
       RETURNING id, name, email`,
      [comercio.id, comercio.nombre, comercio.email, b2bToken, comercio.estado, comercio.ciudad ?? null, comercio.provincia ?? null]
    );
    const commerce = rows[0];
    const token = signToken({ commerceId: commerce.id, email: commerce.email, name: commerce.name });
    await audit(commerce.id, "auth.login");
    res.json({ token, commerce, mockMode: isMockMode() });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ commerce: req.auth, mockMode: isMockMode() });
});

/**
 * Contexto B2B del comercio autenticado: token de NexoB2B + su id de comercio.
 * Lo usan los módulos que llaman al marketplace.
 */
export async function b2bContext(req: Request): Promise<{ token: string; comercioId: string }> {
  const { rows } = await pool.query(
    "SELECT nexob2b_token, nexob2b_id FROM commerces WHERE id = $1",
    [req.auth.commerceId]
  );
  if (!rows[0]?.nexob2b_token)
    throw new HttpError(401, "Sesión de NexoB2B no disponible. Volvé a iniciar sesión.");
  return { token: rows[0].nexob2b_token, comercioId: rows[0].nexob2b_id };
}

import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { verifyCredentials, isMockMode } from "../integrations/nexob2b.js";
import { HttpError } from "../middleware/error.js";

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * POST /api/auth/login
 * Valida credenciales contra NexoB2B y emite un JWT propio del POS.
 * Si el comercio no existe localmente, se crea (alta transparente).
 */
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const nexoCommerce = await verifyCredentials(email, password);
    if (!nexoCommerce) throw new HttpError(401, "Credenciales inválidas");

    const { rows } = await pool.query(
      `INSERT INTO commerces (nexob2b_id, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET nexob2b_id = EXCLUDED.nexob2b_id, name = EXCLUDED.name
       RETURNING id, name, email`,
      [nexoCommerce.id, nexoCommerce.name, nexoCommerce.email]
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

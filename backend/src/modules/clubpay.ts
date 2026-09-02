import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { validarQR, aCentavos, isMockMode } from "../integrations/clubpay.js";

export const clubpayRouter = Router();

/** Clave de POS del comercio. Cada comercio tiene la suya. */
export async function clubpayKey(req: Request): Promise<string> {
  const { rows } = await pool.query(
    "SELECT clubpay_api_key FROM commerces WHERE id = $1",
    [req.auth.commerceId]
  );
  const key = rows[0]?.clubpay_api_key ?? "";
  if (!key && !isMockMode()) {
    throw new HttpError(400, "Este comercio todavía no tiene configurado ClubPay.");
  }
  return key;
}

const validarSchema = z.object({
  qrToken: z.string().min(1),
  /** Total del ticket en pesos; se convierte a centavos para ClubPay */
  total: z.coerce.number().nonnegative().optional(),
});

/**
 * POST /api/clubpay/validar
 * Valida el QR del socio y devuelve sus beneficios con el importe exacto que
 * corresponde a este ticket. El token no se guarda: vence a los 60 segundos.
 */
clubpayRouter.post("/validar", async (req, res, next) => {
  try {
    const { qrToken, total } = validarSchema.parse(req.body);
    const key = await clubpayKey(req);
    const validacion = await validarQR(
      key,
      qrToken,
      total !== undefined ? aCentavos(total) : undefined
    );
    await audit(req.auth.commerceId, "clubpay.validar", undefined, undefined, {
      membershipId: validacion.member.membership_id,
      ofertas: validacion.offers.length,
    });
    res.json(validacion);
  } catch (err) {
    next(err);
  }
});

/** GET /api/clubpay/estado — si el comercio tiene ClubPay configurado */
clubpayRouter.get("/estado", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT clubpay_api_key FROM commerces WHERE id = $1",
      [req.auth.commerceId]
    );
    const key: string = rows[0]?.clubpay_api_key ?? "";
    res.json({
      configurado: Boolean(key) || isMockMode(),
      mockMode: isMockMode(),
      // Nunca se devuelve la clave entera
      clavePreview: key ? `${key.slice(0, 8)}…${key.slice(-4)}` : null,
    });
  } catch (err) {
    next(err);
  }
});

const keySchema = z.object({ apiKey: z.string().trim() });

/** PUT /api/clubpay/api-key — la clave que ClubPay le dio al comercio */
clubpayRouter.put("/api-key", async (req, res, next) => {
  try {
    const { apiKey } = keySchema.parse(req.body);
    await pool.query("UPDATE commerces SET clubpay_api_key = $1 WHERE id = $2", [
      apiKey || null,
      req.auth.commerceId,
    ]);
    await audit(req.auth.commerceId, "clubpay.api_key", "commerces", req.auth.commerceId);
    res.json({ ok: true, configurado: Boolean(apiKey) });
  } catch (err) {
    next(err);
  }
});

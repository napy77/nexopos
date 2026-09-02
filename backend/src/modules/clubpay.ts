import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import {
  validarQR, aCentavos, aPesos, isMockMode,
  crearCharge, consultarCharge, cancelarCharge, RECORTE_TEXTO,
} from "../integrations/clubpay.js";

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

// ── QR mostrado por el comercio ──────────────────────────────────────────────

const chargeSchema = z.object({ total: z.coerce.number().positive() });

/**
 * POST /api/clubpay/cobro
 * Crea la intención de cobro y devuelve el QR ya dibujado, listo para mostrar
 * en la pantalla del mostrador. El socio lo escanea con su teléfono, que es
 * el que tiene cámara: el comercio normalmente solo tiene lector láser, que
 * lee código de barras pero no QR.
 */
clubpayRouter.post("/cobro", async (req, res, next) => {
  try {
    const { total } = chargeSchema.parse(req.body);
    const key = await clubpayKey(req);
    const charge = await crearCharge(key, {
      ticketTotalCents: aCentavos(total),
      // Identifica la operación para que un reintento por corte de red no
      // genere dos cobros distintos
      externalReference: `nexopos-${req.auth.commerceId}-${randomUUID().slice(0, 8)}`,
    });
    const qrDataUrl = await QRCode.toDataURL(charge.qr_payload, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
    });
    await audit(req.auth.commerceId, "clubpay.cobro", undefined, undefined, { chargeId: charge.charge_id, total });
    res.status(201).json({ ...charge, qr_data_url: qrDataUrl });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/clubpay/cobro/:chargeId
 * Estado del cobro mientras el QR está en pantalla. El POS consulta cada
 * ~2 segundos hasta que el socio confirma en su teléfono o vence.
 */
clubpayRouter.get("/cobro/:chargeId", async (req, res, next) => {
  try {
    const key = await clubpayKey(req);
    const estado = await consultarCharge(key, req.params.chargeId);
    res.json({
      ...estado,
      // Para la pantalla, en pesos
      descuento: estado.discount_cents !== undefined ? aPesos(estado.discount_cents) : null,
      neto: estado.neto_cents !== undefined ? aPesos(estado.neto_cents) : null,
      recorteTexto: estado.recorte ? RECORTE_TEXTO[estado.recorte] ?? null : null,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/clubpay/cobro/:chargeId/cancelar — el cajero cierra la pantalla */
clubpayRouter.post("/cobro/:chargeId/cancelar", async (req, res, next) => {
  try {
    const key = await clubpayKey(req);
    await cancelarCharge(key, req.params.chargeId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

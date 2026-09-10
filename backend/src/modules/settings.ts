import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";

export const settingsRouter = Router();

/**
 * Configuración de la balanza etiquetadora del comercio.
 *
 * Las balanzas imprimen etiquetas con un código de barras EAN-13 que lleva
 * adentro el código del producto y su peso (o el importe ya calculado):
 *
 *     2 0   0 1 2 3 4   0 1 5 0 0   C
 *     └prefijo┘ └código┘ └ valor ┘ └verificador
 *
 * El prefijo 20-29 está reservado por GS1 para uso interno del comercio, y
 * el resto de la estructura la define cada marca de balanza, por eso es
 * configurable. Es del comercio (no del dispositivo): la balanza es una sola
 * aunque haya varias cajas.
 */
export const balanzaSchema = z.object({
  habilitado: z.boolean().default(true),
  /** Prefijos con los que arrancan las etiquetas (2 dígitos c/u) */
  prefijos: z.array(z.string().regex(/^\d{1,2}$/)).min(1).default(["20"]),
  /** Qué trae el código: el peso pesado o el importe ya calculado */
  contenido: z.enum(["peso", "precio"]).default("peso"),
  /** Dígitos que ocupa el código del producto (PLU) */
  digitosCodigo: z.number().int().min(3).max(7).default(5),
  /** Dígitos que ocupa el peso/importe */
  digitosValor: z.number().int().min(3).max(7).default(5),
  /** Divisor del valor: 1000 = gramos→kg, 100 = centavos→pesos */
  divisor: z.number().positive().default(1000),
});

export type BalanzaConfig = z.infer<typeof balanzaSchema>;

export const BALANZA_DEFAULT: BalanzaConfig = {
  habilitado: false,
  prefijos: ["20"],
  contenido: "peso",
  digitosCodigo: 5,
  digitosValor: 5,
  divisor: 1000,
};

/** GET /api/settings/balanza */
settingsRouter.get("/balanza", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT balanza_config FROM commerces WHERE id = $1", [
      req.auth.commerceId,
    ]);
    res.json({ balanza: rows[0]?.balanza_config ?? BALANZA_DEFAULT });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/settings/balanza */
settingsRouter.put("/balanza", async (req, res, next) => {
  try {
    const config = balanzaSchema.parse(req.body);
    await pool.query("UPDATE commerces SET balanza_config = $1 WHERE id = $2", [
      JSON.stringify(config),
      req.auth.commerceId,
    ]);
    await audit(req.auth.commerceId, "settings.balanza", "commerces", req.auth.commerceId, config);
    res.json({ ok: true, balanza: config });
  } catch (err) {
    next(err);
  }
});

// ── Cuenta corriente y tienda online ────────────────────────────────────────

const cuentaSchema = z.object({
  /**
   * El día en que cierra el resumen. Es del comercio y no nuestro: hay pueblos
   * que cierran el 10 porque ahí cobra la gente, y el 31 fijo se rompe en la
   * calle. Un 31 en febrero se recorta al último día del mes.
   */
  closingDay: z.coerce.number().int().min(1).max(31).optional(),
  /** Hasta cuándo tiene para pagarlo. Si es menor al de cierre, vence al mes siguiente. */
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
  /** Un comercio puede estar en el POS y no tener tienda publicada. */
  nexotiendaEnabled: z.boolean().optional(),
});

/** GET /api/settings/cuenta-corriente */
settingsRouter.get("/cuenta-corriente", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT closing_day, due_day, nexotienda_enabled FROM commerces WHERE id = $1",
      [req.auth.commerceId]
    );
    res.json({
      closingDay: Number(rows[0].closing_day),
      dueDay: Number(rows[0].due_day),
      nexotiendaEnabled: rows[0].nexotienda_enabled,
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/settings/cuenta-corriente */
settingsRouter.put("/cuenta-corriente", async (req, res, next) => {
  try {
    const body = cuentaSchema.parse(req.body);
    const { rows } = await pool.query(
      `UPDATE commerces SET
         closing_day = COALESCE($2, closing_day),
         due_day = COALESCE($3, due_day),
         nexotienda_enabled = COALESCE($4, nexotienda_enabled)
       WHERE id = $1
       RETURNING closing_day, due_day, nexotienda_enabled`,
      [req.auth.commerceId, body.closingDay ?? null, body.dueDay ?? null,
       body.nexotiendaEnabled ?? null]
    );
    await audit(req.auth.commerceId, "settings.cuenta-corriente", "commerces", req.auth.commerceId, body);
    res.json({
      closingDay: Number(rows[0].closing_day),
      dueDay: Number(rows[0].due_day),
      nexotiendaEnabled: rows[0].nexotienda_enabled,
    });
  } catch (err) {
    next(err);
  }
});

import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { pool } from "../db.js";
import { HttpError } from "./error.js";

/** El hash con el que se guarda y se busca. Nunca la clave. */
export const hashClave = (clave: string): string =>
  createHash("sha256").update(clave).digest("hex");

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      erp?: { commerceId: number; keyId: number };
    }
  }
}

/**
 * Autentica al sistema del comercio —su ERP, Odoo, lo que sea— con la clave
 * que él mismo generó desde el POS.
 *
 * Es por comercio y no de plataforma: si se filtra, el alcance del daño es ese
 * comercio. Es la misma decisión que tomamos con ClubPay, y por la misma razón.
 */
export async function requiereClaveErp(
  req: Request, _res: Response, next: NextFunction
): Promise<void> {
  try {
    const enviada = (req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!enviada) throw new HttpError(401, "Falta la clave de API");

    const { rows } = await pool.query(
      "SELECT id, commerce_id, revocada_at FROM api_keys WHERE hash = $1",
      [hashClave(enviada)]
    );
    const key = rows[0];
    if (!key) throw new HttpError(401, "Clave de API inválida");
    if (key.revocada_at) throw new HttpError(401, "Esa clave fue revocada");

    req.erp = { commerceId: Number(key.commerce_id), keyId: Number(key.id) };
    // Sin await: registrar el uso no puede demorar la respuesta ni hacerla
    // fallar. Sirve para poder revocar una clave vieja sabiendo si anda.
    pool.query("UPDATE api_keys SET usada_at = now() WHERE id = $1", [key.id])
      .catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
}

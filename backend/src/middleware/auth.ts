import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthPayload {
  commerceId: number;
  email: string;
  name: string;
  /**
   * Presente cuando quien opera es el equipo Nexo entrando por `/entrar`, no
   * el comercio. Viaja en el JWT y no en una tabla para que cada venta sepa
   * quién la hizo sin una consulta más.
   */
  soporte?: { adminEmail: string | null; adminId: string; ingresoId: string };
}

/**
 * Quién hizo algo, para guardar al lado de una venta o una caja. NULL es el
 * comercio; el email, el equipo Nexo. Cuando alguien pregunte por una venta
 * que no reconoce, la respuesta tiene que estar en la fila.
 */
export function operador(auth: AuthPayload): string | null {
  if (!auth.soporte) return null;
  return auth.soporte.adminEmail ?? `soporte:${auth.soporte.adminId}`;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth: AuthPayload;
    }
  }
}

/**
 * `vence` (segundos epoch) acorta la sesión: la de soporte dura lo que dura el
 * JWT que emitió B2B (2 h), y B2B pidió expresamente que no la estiremos.
 */
export function signToken(payload: AuthPayload, vence?: number): string {
  if (vence) return jwt.sign({ ...payload, exp: vence }, config.jwtSecret);
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "12h" });
}

/**
 * Todas las rutas protegidas exigen un JWT del POS. El commerceId del token
 * es la única fuente del tenant: ningún endpoint acepta commerce_id por
 * parámetro, garantizando aislamiento total entre comercios.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token requerido" });
    return;
  }
  try {
    req.auth = jwt.verify(header.slice(7), config.jwtSecret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}

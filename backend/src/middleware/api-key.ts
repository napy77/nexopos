import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { HttpError } from "./error.js";

export type Capacidad = "catalogo" | "pedidos" | "cuentas";

/**
 * La API pública se autentica con una clave por capacidad.
 *
 * Que sean tres y no una no es ceremonia: la de catálogo abre lo que la tienda
 * le muestra a cualquiera que entre —es la vitrina—, y la de cuentas abre la
 * cuenta corriente de una persona. Con una sola llave, filtrarla por un log de
 * un servidor de tienda expondría también las libretas del pueblo.
 */
export function requiereClave(capacidad: Capacidad) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const esperada = config.apiKeys[capacidad];
    // Sin clave configurada se cierra, no se abre: una API pública sin
    // credencial es una API pública de verdad.
    if (!esperada) {
      next(new HttpError(503, `La API de ${capacidad} no está habilitada en este servidor.`));
      return;
    }
    const enviada = (req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (enviada !== esperada) {
      next(new HttpError(401, "Clave inválida para esta parte de la API"));
      return;
    }
    next();
  };
}

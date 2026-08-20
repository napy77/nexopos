import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Datos inválidos", details: err.issues });
    return;
  }

  // Fallo no previsto: se registra con la ruta y el detalle para poder
  // rastrearlo en el log, y se le devuelve al comercio una referencia con la
  // que ubicar ese registro exacto en vez de un "Error interno" a secas.
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  const detalle = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(
    `[error ${ref}] ${req.method} ${req.originalUrl}` +
      (req.auth ? ` comercio=${req.auth.commerceId}` : "") +
      `\n${detalle}`
  );
  res.status(500).json({
    error: `Ocurrió un error inesperado (referencia ${ref}). Si se repite, pasale este código al soporte.`,
    ref,
  });
}

import { Router } from "express";
import { z } from "zod";
import { audit } from "../db.js";
import { getMayoristas, getMediosPago, solicitarAlta } from "../integrations/nexob2b.js";
import { b2bContext } from "./auth.js";

export const mayoristasRouter = Router();

/** GET /api/mayoristas?busqueda= — mayoristas con estado de relación */
mayoristasRouter.get("/", async (req, res, next) => {
  try {
    const { token } = await b2bContext(req);
    const mayoristas = await getMayoristas(token, req.query.busqueda ? String(req.query.busqueda) : undefined);
    res.json({ mayoristas });
  } catch (err) {
    next(err);
  }
});

const solicitudSchema = z.object({ mayoristaId: z.string(), mensaje: z.string().default("") });

/** POST /api/mayoristas/solicitudes — pedir alta con un mayorista */
mayoristasRouter.post("/solicitudes", async (req, res, next) => {
  try {
    const { mayoristaId, mensaje } = solicitudSchema.parse(req.body);
    const { token } = await b2bContext(req);
    const result = await solicitarAlta(token, mayoristaId, mensaje);
    await audit(req.auth.commerceId, "mayorista.solicitud", undefined, undefined, { mayoristaId });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /api/mayoristas/:id/medios-pago — para el checkout de compras */
mayoristasRouter.get("/:id/medios-pago", async (req, res, next) => {
  try {
    const { token } = await b2bContext(req);
    res.json({ mediosPago: await getMediosPago(token, req.params.id) });
  } catch (err) {
    next(err);
  }
});

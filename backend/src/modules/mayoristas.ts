import { Router } from "express";
import { z } from "zod";
import { audit } from "../db.js";
import {
  getMayoristas, getMediosPago, solicitarAlta, descubrirMayoristas, fichaComercio, tiposDeComercio,
  RUBROS_MAYORISTA,
} from "../integrations/nexob2b.js";
import { config } from "../config.js";
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

// Cambian poco y se piden en cada búsqueda: en memoria, con vencimiento.
let equivalenciasCache: { data: Record<string, string[]>; at: number } | null = null;
const ubicacionCache = new Map<number, { lat: number | null; lng: number | null; tipos: string[]; at: number }>();

async function equivalencias(): Promise<Record<string, string[]>> {
  if (!equivalenciasCache || Date.now() - equivalenciasCache.at > 3600_000) {
    equivalenciasCache = { data: await tiposDeComercio(), at: Date.now() };
  }
  return equivalenciasCache.data;
}

/**
 * Ubicación y tipo del comercio, de su ficha en B2B. No se guardan en la base:
 * el comerciante los cambia allá, y una copia acá dejaría de coincidir el día
 * que mueva el pin del mapa. Cinco minutos alcanzan para no pedirlos en cada
 * tecla.
 */
async function ubicacion(commerceId: number, token: string) {
  const c = ubicacionCache.get(commerceId);
  if (c && Date.now() - c.at < 300_000) return c;
  const ficha = await fichaComercio(token);
  const r = ficha?.rubros;
  const tipos = (Array.isArray(r) ? r : typeof r === "string" ? [r] : []).map(String).filter(Boolean);
  const num = (x: unknown) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
  const u = { lat: num(ficha?.lat), lng: num(ficha?.lng), tipos, at: Date.now() };
  ubicacionCache.set(commerceId, u);
  return u;
}

const RADIOS = [25, 50, 100, 200, 9999];

/**
 * GET /api/mayoristas/descubrir?radio_km=&rubros=&busqueda=
 *
 * La misma búsqueda que «Descubrí mayoristas» del portal de B2B, para que el
 * comerciante vea lo mismo en los dos lados (PARA-NEXOPOS-DESCUBRIR-MAYORISTAS.md).
 *
 * - Sin `rubros` en la URL, usa los que le sirven a su tipo de comercio. Con
 *   `rubros=` vacío, todos.
 * - Si con sus rubros sugeridos no aparece nadie, repite sin rubros y lo avisa
 *   en `sinDeSusRubros`. Una pantalla vacía porque la equivalencia está
 *   incompleta parece que no hay mayoristas, y sí hay.
 */
mayoristasRouter.get("/descubrir", async (req, res, next) => {
  try {
    const { token } = await b2bContext(req);
    const [u, eq] = await Promise.all([
      ubicacion(req.auth.commerceId, token),
      equivalencias().catch(() => ({} as Record<string, string[]>)),
    ]);

    // La comparación de nombres es sin mayúsculas, como en B2B.
    const porNombre = new Map(Object.entries(eq).map(([k, v]) => [k.trim().toLowerCase(), v]));
    const sugeridos = RUBROS_MAYORISTA.filter((r) =>
      u.tipos.some((t) => (porNombre.get(t.trim().toLowerCase()) ?? []).includes(r)));

    const pedidos = typeof req.query.rubros === "string"
      ? req.query.rubros.split(",").map((x) => x.trim()).filter(Boolean)
      : [...sugeridos];
    const radio = Number(req.query.radio_km);
    const radioKm = RADIOS.includes(radio) ? radio : 50;
    const busqueda = String(req.query.busqueda ?? "").trim() || undefined;

    const filtros = { lat: u.lat, lng: u.lng, radioKm, busqueda };
    let mayoristas = await descubrirMayoristas(token, { ...filtros, rubros: pedidos });
    let sinDeSusRubros = false;
    if (pedidos.length > 0 && mayoristas.length === 0) {
      const todos = await descubrirMayoristas(token, { ...filtros, rubros: [] });
      if (todos.length > 0) { mayoristas = todos; sinDeSusRubros = true; }
    }

    res.json({
      mayoristas,
      meta: {
        tieneUbicacion: u.lat != null && u.lng != null,
        radioKm, rubros: pedidos, rubrosSugeridos: sugeridos, sinDeSusRubros,
        rubrosDisponibles: RUBROS_MAYORISTA.filter((r) => r !== "Otros"),
        // La ubicación se carga en el perfil de B2B; acá no se edita.
        perfilUrl: `${config.nexob2b.publicUrl.replace(/\/$/, "")}/comercio/perfil`,
      },
    });
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

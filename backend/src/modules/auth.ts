import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { sincronizarFicha } from "./perfil-b2b.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import jwt from "jsonwebtoken";
import { login as b2bLogin, canjearEntrada, isMockMode } from "../integrations/nexob2b.js";
import { HttpError } from "../middleware/error.js";

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * POST /api/auth/login
 * Valida credenciales contra NexoB2B y emite el JWT propio del POS (12 h).
 * El token de NexoB2B (30 días) se guarda por comercio y se usa para todas
 * las llamadas al marketplace en su nombre.
 */
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await b2bLogin(email, password);
    if (!result) throw new HttpError(401, "Credenciales inválidas o cuenta suspendida");
    const { token: b2bToken, comercio } = result;

    const { rows } = await pool.query(
      `INSERT INTO commerces (nexob2b_id, name, email, nexob2b_token, estado, ciudad, provincia)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE SET
         nexob2b_id = EXCLUDED.nexob2b_id, name = EXCLUDED.name,
         nexob2b_token = EXCLUDED.nexob2b_token, estado = EXCLUDED.estado,
         ciudad = EXCLUDED.ciudad, provincia = EXCLUDED.provincia
       RETURNING id, name, email`,
      [comercio.id, comercio.nombre, comercio.email, b2bToken, comercio.estado, comercio.ciudad ?? null, comercio.provincia ?? null]
    );
    const commerce = rows[0];
    const token = signToken({ commerceId: commerce.id, email: commerce.email, name: commerce.name });
    // La ficha de B2B se copia acá para poder servirla en la tienda. Va
    // después de responder el login en lo que importa: si B2B tarda, el
    // comerciante no espera. Los datos quedan como estaban hasta la próxima.
    sincronizarFicha(Number(rows[0].id), b2bToken).catch((err) =>
      console.error("[nexob2b] no se pudo sincronizar la ficha:", err));

    await audit(commerce.id, "auth.login");
    res.json({ token, commerce, mockMode: isMockMode() });
  } catch (err) {
    next(err);
  }
});

const entrarSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{8,200}$/) });

/** Qué le mostramos al navegador según el código que devolvió B2B. */
const ERRORES_ENTRADA: Record<string, { status: number; error: string }> = {
  token_invalido: { status: 404, error: "El enlace no es válido." },
  comercio_suspendido: { status: 403, error: "El comercio está suspendido." },
  token_usado: { status: 410, error: "Este enlace ya se usó." },
  token_vencido: { status: 410, error: "El enlace venció." },
};

/** Segundos epoch en que vence un JWT, sin verificarlo (lo firmó B2B, no nosotros). */
function venceJwt(token: string): number | null {
  const d = jwt.decode(token) as { exp?: number } | null;
  return typeof d?.exp === "number" ? d.exp : null;
}

/**
 * POST /api/auth/entrar { token }
 *
 * Lo llama la página `/entrar` con el código de un solo uso que B2B puso en la
 * URL. El canje contra B2B va desde acá porque necesita la clave de
 * plataforma, que no puede llegar al navegador.
 *
 * Contrato: `docs/PEDIDO-A-NEXOPOS-ENTRAR.md` (B2B, 28/10).
 */
authRouter.post("/entrar", async (req, res, next) => {
  try {
    const parsed = entrarSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(404, "El enlace no es válido.", "token_invalido");

    const r = await canjearEntrada(parsed.data.token);
    if (!r.ok) {
      // Una clave mal configurada es nuestra; el comerciante sólo ve "volvé a entrar".
      if (r.codigo === "clave_invalida")
        console.error("[entrar] B2B rechazó NEXOPOS_PLATFORM_KEY: revisar el .env de los dos lados");
      const e = ERRORES_ENTRADA[r.codigo];
      throw new HttpError(e?.status ?? 401, e?.error ?? "No se pudo entrar. Ingresá con tu usuario.", r.codigo);
    }
    const { token: b2bToken, comercio, soporte } = r;

    /*
     * El token de B2B se guarda por comercio y lo usan todas las sesiones de
     * ese comercio. El de soporte dura 2 h: si pisara el del dueño, el dueño
     * —logueado en la caja de al lado— se quedaría sin B2B a las dos horas.
     * Por eso sólo entra si no hay uno guardado o el guardado ya venció.
     */
    const ahora = Math.floor(Date.now() / 1000);
    const { rows } = await pool.query(
      `INSERT INTO commerces (nexob2b_id, name, email, nexob2b_token, estado, ciudad, provincia)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE SET
         nexob2b_id = EXCLUDED.nexob2b_id, name = EXCLUDED.name, estado = EXCLUDED.estado,
         ciudad = EXCLUDED.ciudad, provincia = EXCLUDED.provincia
       RETURNING id, name, email, nexob2b_token`,
      [comercio.id, comercio.nombre, comercio.email, b2bToken, comercio.estado, comercio.ciudad ?? null, comercio.provincia ?? null]
    );
    const commerce = rows[0];
    const guardado = commerce.nexob2b_token as string | null;
    const guardadoVence = guardado ? venceJwt(guardado) : null;
    const guardadoVencido = !guardado || (guardadoVence !== null && guardadoVence <= ahora);
    if (!soporte || guardadoVencido) {
      await pool.query("UPDATE commerces SET nexob2b_token = $1 WHERE id = $2", [b2bToken, commerce.id]);
    }

    const payload = {
      commerceId: Number(commerce.id), email: commerce.email, name: commerce.name,
      ...(soporte ? { soporte: { adminEmail: soporte.admin_email, adminId: soporte.admin_id, ingresoId: soporte.ingreso_id } } : {}),
    };
    // La sesión de soporte vence cuando vence la de B2B (2 h). En modo mock el
    // token no es un JWT: se calcula igual, para poder probar el vencimiento.
    const vence = soporte ? venceJwt(b2bToken) ?? ahora + 2 * 3600 : undefined;
    const token = signToken(payload, vence);

    if (!soporte) {
      sincronizarFicha(Number(commerce.id), b2bToken).catch((err) =>
        console.error("[nexob2b] no se pudo sincronizar la ficha:", err));
    }
    await audit(commerce.id, soporte ? "auth.entrar_soporte" : "auth.entrar",
      undefined, undefined, soporte ? { ...soporte } : undefined);

    res.json({
      token,
      commerce: { id: commerce.id, name: commerce.name, email: commerce.email },
      soporte: soporte
        ? { adminEmail: soporte.admin_email, desde: soporte.desde, vence: new Date(vence! * 1000).toISOString() }
        : null,
      mockMode: isMockMode(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Perfil del comercio: los datos vienen de NexoB2B (se refrescan en cada
 * login) y se editan allá, acá son de solo lectura.
 */
authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nexob2b_id, name, email, tax_id, estado, ciudad, provincia, created_at,
              address, phone, category
       FROM commerces WHERE id = $1`,
      [req.auth.commerceId]
    );
    if (!rows[0]) throw new HttpError(404, "Comercio no encontrado");
    res.json({ commerce: rows[0], mockMode: isMockMode() });
  } catch (err) {
    next(err);
  }
});

/**
 * Contexto B2B del comercio autenticado: token de NexoB2B + su id de comercio.
 * Lo usan los módulos que llaman al marketplace.
 */
export async function b2bContext(req: Request): Promise<{ token: string; comercioId: string }> {
  const { rows } = await pool.query(
    "SELECT nexob2b_token, nexob2b_id FROM commerces WHERE id = $1",
    [req.auth.commerceId]
  );
  if (!rows[0]?.nexob2b_token)
    throw new HttpError(401, "Sesión de NexoB2B no disponible. Volvé a iniciar sesión.");
  return { token: rows[0].nexob2b_token, comercioId: rows[0].nexob2b_id };
}

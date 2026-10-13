import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { requiereClave } from "../middleware/api-key.js";
import {
  canjearTokenTienda, pedirEmparejamiento, estadoEmparejamiento, asignarNumeroCliente,
  type SesionTienda,
} from "../integrations/clubpay.js";
import { enTransaccion } from "./clubpay-sync.js";
import { estadoCredito, cicloDe, vencimientoDe } from "./cuenta-corriente.js";
import { hoy } from "../lib/fechas.js";

/**
 * La libreta, abierta desde la tienda.
 *
 * En NexoTienda no existe estar logueado: existe "en esta tienda está abierta
 * la libreta CLI-4231". La identidad de la persona vive en ClubPay y no se
 * copia a ningún lado.
 *
 * El circuito completo:
 *
 *   1. la app pide el token           app → ClubPay
 *   2. la app abre la tienda          jure.nexotienda.app/entrar?t=…
 *   3. la tienda canjea               NexoTienda → acá
 *   4. preguntamos de quién es        acá → ClubPay
 *   5. vuelve la sesión               { accountId, storeId, displayName }
 *
 * La sesión que sale de acá **no tiene autoridad**: dice qué libreta es y nada
 * más. Si se puede comprar, cuánto hay disponible y si el comerciante pausó el
 * fiado se pregunta en cada operación, acá abajo. Una sesión abierta deja de
 * servir en el instante en que el comerciante pausa, sin que nadie tenga que
 * acordarse de revocarla.
 */

export const cuentasRouter = Router();
const cuentas = requiereClave("cuentas");

const centavos = (pesos: number | null): number | null =>
  pesos === null ? null : Math.round(pesos * 100);

/**
 * El identificador de la libreta en esta frontera es `CLI-<id>`, el nuestro.
 *
 * NO es el `account_id` de ClubPay, aunque el canje pase por ahí. Es el mismo
 * que `POST /v1/orders` ya acepta en `accountId`, y tener dos formas de nombrar
 * la misma libreta según el endpoint es la clase de cosa que se descubre con un
 * pedido que no se puede cargar a la cuenta.
 */
const refDeCliente = (id: number): string => `CLI-${id}`;
const idDeRef = (ref: string): number => Number(String(ref).replace(/^CLI-/, ""));

// ── El canje ────────────────────────────────────────────────────────────────

const canjeSchema = z.object({
  token: z.string().min(1),
  /**
   * De qué tienda es la persona que está entrando.
   *
   * Hace falta y no es opcional: para preguntarle a ClubPay necesitamos la
   * clave de ESE comercio, y el token no dice de cuál es —justamente por eso
   * ClubPay puede validarlo contra la clave—. NexoTienda lo sabe siempre,
   * porque el canje ocurre en jure.nexotienda.app.
   */
  storeId: z.string().min(1),
});

/** POST /v1/cuentas/canjear */
cuentasRouter.post("/cuentas/canjear", cuentas, async (req, res, next) => {
  try {
    const body = canjeSchema.parse(req.body);
    const commerceId = Number(body.storeId);
    if (!Number.isInteger(commerceId)) throw new HttpError(400, "storeId inválido");

    const { rows: [com] } = await pool.query(
      "SELECT clubpay_api_key FROM commerces WHERE id = $1", [commerceId]
    );
    if (!com) throw new HttpError(404, "No existe ese comercio");
    if (!com.clubpay_api_key) {
      throw new HttpError(409, "Este comercio todavía no tiene configurado ClubPay.");
    }

    const apiKey = String(com.clubpay_api_key);
    const sesion = await canjearTokenTienda(apiKey, body.token);
    const customerId = sesion.external_id
      ? idDeRef(sesion.external_id)
      : await clienteNacidoEnLaTienda(commerceId, apiKey, sesion);
    if (!Number.isInteger(customerId)) throw new HttpError(502, "ClubPay devolvió una referencia que no entendemos");

    const { rows: [cliente] } = await pool.query(
      `SELECT id, commerce_id, name, clubpay_status, clubpay_linked_at
         FROM customers WHERE id = $1`,
      [customerId]
    );
    if (!cliente) throw new HttpError(404, "Esa libreta ya no existe en este comercio");

    /*
     * El token dice de qué persona; el storeId dice en qué puerta está parada.
     * Si no coinciden, alguien trajo a la tienda de Delfín un token emitido para
     * Jure. NexoTienda ya lo comprueba de su lado; se comprueba acá también
     * porque de los dos, el único que sabe de verdad a qué comercio pertenece
     * esa libreta somos nosotros.
     */
    if (Number(cliente.commerce_id) !== commerceId) {
      throw new HttpError(403, "Ese acceso no es de esta tienda");
    }

    await audit(commerceId, "cuenta.canje", "customers", cliente.id);
    res.json({
      accountId: refDeCliente(Number(cliente.id)),
      storeId: String(commerceId),
      displayName: sesion.persona ?? cliente.name,
      /*
       * Desde cuándo vale el vínculo actual. Es la única revocación que existe
       * en este diseño: la sesión vive en una cookie de un navegador ajeno y no
       * hay nadie que pueda cerrarla, así que la tienda compara esta fecha
       * contra cuándo abrió la sesión y cierra sola las anteriores.
       */
      linkedAt: cliente.clubpay_linked_at
        ? new Date(cliente.clubpay_linked_at).toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * La persona se identificó por primera vez desde la tienda (CR-0003): ClubPay
 * nos manda su cuenta sin número de cliente, y el número lo ponemos nosotros.
 *
 * Nace **sin libreta**. Identificarse con un correo no es que el comercio le
 * fíe: eso lo decide el comerciante después, desde la ficha.
 *
 * Se busca primero por la cuenta de ClubPay, porque el `PUT` del número puede
 * haber fallado en un canje anterior. Pero sólo se reusa una ficha que nació
 * en la tienda. ClubPay reusa la misma cuenta cuando la persona rechazó una
 * vinculación del mostrador —el DNI estaba mal tipeado y la ficha era de otro—,
 * y esa ficha vieja tiene la deuda de otra persona: devolverla le abriría a
 * alguien la libreta de un desconocido. Esa se desasocia y se crea una nueva.
 */
async function clienteNacidoEnLaTienda(
  commerceId: number, apiKey: string, sesion: SesionTienda
): Promise<number> {
  const customerId = await enTransaccion(async (c) => {
    // Dos canjes a la vez de la misma persona —doble toque, dos pestañas— no
    // tienen que crear dos fichas.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",
      [`canje:${commerceId}:${sesion.account_id}`]);

    const { rows: [previa] } = await c.query(
      `SELECT id, origen FROM customers WHERE commerce_id = $1 AND clubpay_account_id = $2`,
      [commerceId, sesion.account_id]
    );
    if (previa?.origen === "tienda") return Number(previa.id);
    if (previa) {
      await c.query(
        `UPDATE customers SET clubpay_account_id = NULL, clubpay_linked_at = now() WHERE id = $1`,
        [previa.id]
      );
      console.warn(`[clubpay] ${sesion.account_id} volvió sin número: CLI-${previa.id} deja de ser suyo`);
    }

    const { rows: [nuevo] } = await c.query(
      `INSERT INTO customers (commerce_id, name, libreta_activa, origen,
                              clubpay_status, clubpay_account_id, clubpay_linked_at, clubpay_checked_at)
       VALUES ($1, $2, false, 'tienda', 'vinculada', $3, now(), now()) RETURNING id`,
      [commerceId, sesion.persona?.trim() || "Cliente de la tienda", sesion.account_id]
    );
    return Number(nuevo.id);
  });

  /*
   * El número va después de la transacción y su falla no corta el canje: la
   * ficha ya existe acá, y el próximo canje la encuentra por la cuenta y
   * vuelve a intentar. Mientras tanto ClubPay no tiene con qué emparejar
   * movimientos, pero una ficha sin libreta no tiene movimientos que mandar.
   */
  try {
    await asignarNumeroCliente(apiKey, sesion.account_id, refDeCliente(customerId));
  } catch (err) {
    console.warn(`[clubpay] no se pudo asignar CLI-${customerId} a ${sesion.account_id}:`,
      err instanceof Error ? err.message : err);
  }
  return customerId;
}

// ── El estado, que se pregunta en cada operación ────────────────────────────

/**
 * GET /v1/cuentas/:accountId?storeId=
 *
 * Lo que la tienda necesita saber antes de dejar cargar algo a la libreta. Se
 * pregunta cada vez a propósito: es lo que hace que la sesión no tenga
 * autoridad y que pausar el fiado tenga efecto inmediato.
 *
 * `availableCents` puede ser `null`, y **ése es el caso más común**: sin límite
 * es el default, porque así funciona el cuaderno. Mostrar 0 sería exactamente
 * al revés de la verdad.
 */
cuentasRouter.get("/cuentas/:accountId", cuentas, async (req, res, next) => {
  try {
    const commerceId = Number(req.query.storeId);
    if (!Number.isInteger(commerceId)) throw new HttpError(400, "Falta storeId");
    const customerId = idDeRef(String(req.params.accountId));
    if (!Number.isInteger(customerId)) throw new HttpError(400, "accountId inválido");

    const { rows: [cliente] } = await pool.query(
      `SELECT c.id, c.name, c.clubpay_status, c.clubpay_linked_at,
              co.closing_day, co.due_day
         FROM customers c JOIN commerces co ON co.id = c.commerce_id
        WHERE c.id = $1 AND c.commerce_id = $2`,
      [customerId, commerceId]
    );
    if (!cliente) throw new HttpError(404, "Esa libreta no existe en esta tienda");

    const estado = await estadoCredito(pool, commerceId, customerId);
    /*
     * Cuándo cierra y cuándo vence.
     *
     * Van el número del día —que es lo que dice la frase "cierra el 10 de cada
     * mes"— y también las fechas concretas del período en curso, porque
     * calcularlas tiene una trampa: un cierre el 31 en febrero es el 28, y el
     * 29 en los bisiestos. Mandando la fecha ya resuelta, esa cuenta se hace en
     * un solo lugar y no en cada sistema que la necesite.
     *
     * `dueDay` va aunque no lo hayan pedido: "cierra el 10" sin "vence el 20"
     * es media frase, y el que quiera escribir la otra mitad tendría que pedir
     * otro viaje.
     */
    const cierre = Number(cliente.closing_day);
    const vence = Number(cliente.due_day);
    const ciclo = cicloDe(hoy(), cierre);
    res.json({
      accountId: refDeCliente(Number(cliente.id)),
      storeId: String(commerceId),
      displayName: cliente.name,
      balanceCents: centavos(estado.saldo),
      limitCents: centavos(estado.limite),
      availableCents: centavos(estado.disponible),
      paused: estado.pausado,
      /*
       * El comerciante puede tener el fiado online apagado aunque la libreta
       * exista y esté al día. Son dos cosas distintas y la tienda tiene que
       * poder contarlas distinto: "no podés cargar" no es lo mismo que "este
       * comercio no vende fiado por internet".
       */
      onlineEnabled: estado.onlineHabilitado,
      /*
       * Si esta persona tiene libreta en este comercio. Hasta CR-0003 una
       * sesión abierta lo implicaba; desde ahí hay gente identificada sin
       * libreta, y la tienda no tiene que ofrecerle cargar a la cuenta.
       */
      creditEnabled: estado.libreta,
      closingDay: cierre,
      dueDay: vence,
      /** El período en curso, con la fecha de cierre ya resuelta. */
      currentPeriod: {
        from: ciclo.desde,
        to: ciclo.hasta,
        dueDate: vencimientoDe(ciclo.hasta, cierre, vence),
      },
      linkedAt: cliente.clubpay_linked_at
        ? new Date(cliente.clubpay_linked_at).toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
});

// ── Emparejar dos pantallas ─────────────────────────────────────────────────

/**
 * La tienda abierta en la computadora de casa y ClubPay en el teléfono.
 *
 * El handoff no cubre ese caso: abre la tienda EN el teléfono, y la compu no
 * tiene con qué demostrar quién es. Se emparejan con un código corto que la
 * persona lee en la compu y escribe en su app.
 *
 * Los dos endpoints son pase de pelota a ClubPay, por lo mismo que el canje:
 * su API pide la clave del comercio, NexoTienda no la tiene ni puede tenerla
 * —es un solo servidor que renderiza la tienda de cualquiera— y nosotros sí.
 *
 * Y termina en `POST /v1/cuentas/canjear`, el que ya existe. Una segunda forma
 * de abrir sesión sería una segunda superficie que auditar por el resto de la
 * vida del producto.
 */

const emparejarSchema = z.object({
  storeId: z.string().min(1),
  /**
   * Lo que el navegador dice de sí mismo, para que la persona reconozca su
   * propia compu en la pantalla de confirmación.
   *
   * Viaja tal cual y no se le agrega nada, como pidió NexoTienda. Se recorta
   * porque va a una pantalla de teléfono, no porque desconfiemos del largo.
   */
  dispositivo: z.string().trim().max(120).optional(),
  /**
   * El mismo dato con el nombre que NexoTienda terminó usando. Se aceptan los
   * dos: renombrar un campo opcional no rompe nada visible —sigue andando— pero
   * deja de viajar justo el dato que sostiene la confirmación de la app.
   */
  clientHint: z.string().trim().max(120).optional(),
});

/** POST /v1/cuentas/emparejar */
cuentasRouter.post("/cuentas/emparejar", cuentas, async (req, res, next) => {
  try {
    const body = emparejarSchema.parse(req.body);
    const commerceId = Number(body.storeId);
    if (!Number.isInteger(commerceId)) throw new HttpError(400, "storeId inválido");

    const apiKey = await claveDe(commerceId);
    const p = await pedirEmparejamiento(apiKey, {
      dispositivo: body.clientHint ?? body.dispositivo, commerceId,
    });
    res.json({ requestId: p.request_id, code: p.code, expiresAt: p.expira_at });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/cuentas/emparejar/:requestId?storeId=
 *
 * Contesta lo que contesta ClubPay y nada más. El `token` que vuelve en
 * `listo` es el mismo de un solo uso del handoff: se canjea con
 * `POST /v1/cuentas/canjear`.
 */
cuentasRouter.get("/cuentas/emparejar/:requestId", cuentas, async (req, res, next) => {
  try {
    const commerceId = Number(req.query.storeId);
    if (!Number.isInteger(commerceId)) throw new HttpError(400, "Falta storeId");
    const apiKey = await claveDe(commerceId);

    const estado = await estadoEmparejamiento(
      apiKey, String(req.params.requestId),
      // Sólo para el modo demo: el token que devolvería ClubPay al aprobar es
      // el external_id de una libreta vinculada de este comercio.
      async () => {
        const { rows: [c] } = await pool.query(
          `SELECT id FROM customers
            WHERE commerce_id = $1 AND clubpay_status IN ('vinculada','aceptada')
            ORDER BY id LIMIT 1`,
          [commerceId]
        );
        return c ? refDeCliente(Number(c.id)) : null;
      }
    );
    res.json(estado);
  } catch (err) {
    next(err);
  }
});

/** La clave de ClubPay de ese comercio, o el motivo por el que no se puede. */
async function claveDe(commerceId: number): Promise<string> {
  const { rows: [com] } = await pool.query(
    "SELECT clubpay_api_key FROM commerces WHERE id = $1", [commerceId]
  );
  if (!com) throw new HttpError(404, "No existe ese comercio");
  if (!com.clubpay_api_key) {
    throw new HttpError(409, "Este comercio todavía no tiene configurado ClubPay.");
  }
  return String(com.clubpay_api_key);
}

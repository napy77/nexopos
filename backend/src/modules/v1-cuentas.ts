import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { requiereClave } from "../middleware/api-key.js";
import { canjearTokenTienda } from "../integrations/clubpay.js";
import { estadoCredito } from "./cuenta-corriente.js";

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

    const sesion = await canjearTokenTienda(String(com.clubpay_api_key), body.token);
    const customerId = idDeRef(sesion.external_id);
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
      `SELECT id, name, clubpay_status, clubpay_linked_at
         FROM customers WHERE id = $1 AND commerce_id = $2`,
      [customerId, commerceId]
    );
    if (!cliente) throw new HttpError(404, "Esa libreta no existe en esta tienda");

    const estado = await estadoCredito(pool, commerceId, customerId);
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
      linkedAt: cliente.clubpay_linked_at
        ? new Date(cliente.clubpay_linked_at).toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
});

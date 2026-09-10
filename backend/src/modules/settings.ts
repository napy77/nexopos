import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { isMockMode } from "../integrations/clubpay.js";

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

// ── Cuenta corriente ────────────────────────────────────────────────────────

const cuentaSchema = z.object({
  /**
   * El día en que cierra el resumen. Es del comercio y no nuestro: hay pueblos
   * que cierran el 10 porque ahí cobra la gente, y el 31 fijo se rompe en la
   * calle. Un 31 en febrero se recorta al último día del mes.
   */
  closingDay: z.coerce.number().int().min(1).max(31).optional(),
  /** Hasta cuándo tiene para pagarlo. Si es menor al de cierre, vence al mes siguiente. */
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
});

/** GET /api/settings/cuenta-corriente */
settingsRouter.get("/cuenta-corriente", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT closing_day, due_day FROM commerces WHERE id = $1",
      [req.auth.commerceId]
    );
    res.json({ closingDay: Number(rows[0].closing_day), dueDay: Number(rows[0].due_day) });
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
         due_day = COALESCE($3, due_day)
       WHERE id = $1 RETURNING closing_day, due_day`,
      [req.auth.commerceId, body.closingDay ?? null, body.dueDay ?? null]
    );
    await audit(req.auth.commerceId, "settings.cuenta-corriente", "commerces", req.auth.commerceId, body);
    res.json({ closingDay: Number(rows[0].closing_day), dueDay: Number(rows[0].due_day) });
  } catch (err) {
    next(err);
  }
});

// ── NexoTienda: si publica, cómo le pagan y cómo entrega ────────────────────

const tiendaSchema = z.object({
  habilitada: z.boolean().optional(),
  pagos: z.object({
    contraEntrega: z.boolean().optional(),
    transferencia: z.boolean().optional(),
    transferenciaAlias: z.string().trim().max(120).nullable().optional(),
    transferenciaTitular: z.string().trim().max(160).nullable().optional(),
    clubpay: z.boolean().optional(),
    cuentaCorriente: z.boolean().optional(),
  }).optional(),
  envios: z.object({
    retiroEnLocal: z.boolean().optional(),
    envioPropio: z.boolean().optional(),
  }).optional(),
});

const COLUMNAS = `nexotienda_enabled, pay_on_delivery_enabled, transfer_enabled,
                  transfer_alias, transfer_holder, clubpay_pay_enabled,
                  online_credit_enabled, pickup_enabled, own_delivery_enabled,
                  clubpay_api_key`;

function armarTienda(r: Record<string, unknown>) {
  const clubpayListo = Boolean(r.clubpay_api_key) || isMockMode();
  return {
    habilitada: r.nexotienda_enabled,
    pagos: {
      contraEntrega: r.pay_on_delivery_enabled,
      transferencia: r.transfer_enabled,
      transferenciaAlias: r.transfer_alias ?? null,
      transferenciaTitular: r.transfer_holder ?? null,
      clubpay: r.clubpay_pay_enabled,
      /** Sin la clave de ClubPay el botón existiría y no cobraría nada */
      clubpayDisponible: clubpayListo,
      cuentaCorriente: r.online_credit_enabled,
    },
    envios: {
      retiroEnLocal: r.pickup_enabled,
      envioPropio: r.own_delivery_enabled,
      /**
       * NexoRider todavía no existe. Se muestra apagado y no se puede
       * encender: prometer un reparto que no hay es peor que no ofrecerlo.
       */
      nexoRider: false,
      nexoRiderDisponible: false,
      nexoRiderMotivo: "Próximamente",
    },
  };
}

/** GET /api/settings/nexotienda */
settingsRouter.get("/nexotienda", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLUMNAS} FROM commerces WHERE id = $1`,
      [req.auth.commerceId]
    );
    res.json(armarTienda(rows[0]));
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/settings/nexotienda
 *
 * Las validaciones de acá no son burocracia: cada una evita una tienda que
 * toma pedidos que después nadie puede cumplir, y el que queda mal con su
 * vecino es el comerciante.
 */
settingsRouter.put("/nexotienda", async (req, res, next) => {
  try {
    const body = tiendaSchema.parse(req.body);
    const commerceId = req.auth.commerceId;

    const { rows: previas } = await pool.query(
      `SELECT ${COLUMNAS} FROM commerces WHERE id = $1`, [commerceId]
    );
    const antes = previas[0];

    // Se mezcla lo que viene con lo que había: la pantalla puede mandar solo
    // el switch que se tocó.
    const p = body.pagos ?? {};
    const e = body.envios ?? {};
    const nuevo = {
      habilitada: body.habilitada ?? antes.nexotienda_enabled,
      contraEntrega: p.contraEntrega ?? antes.pay_on_delivery_enabled,
      transferencia: p.transferencia ?? antes.transfer_enabled,
      alias: p.transferenciaAlias !== undefined ? (p.transferenciaAlias || null) : antes.transfer_alias,
      titular: p.transferenciaTitular !== undefined ? (p.transferenciaTitular || null) : antes.transfer_holder,
      clubpay: p.clubpay ?? antes.clubpay_pay_enabled,
      cuentaCorriente: p.cuentaCorriente ?? antes.online_credit_enabled,
      retiro: e.retiroEnLocal ?? antes.pickup_enabled,
      envioPropio: e.envioPropio ?? antes.own_delivery_enabled,
    };

    // Sin alias no hay a dónde transferir: el pedido queda esperando un pago
    // que el comprador no sabe cómo hacer.
    if (nuevo.transferencia && !nuevo.alias) {
      throw new HttpError(400, "Para cobrar por transferencia cargá el alias o CBU donde te depositan.");
    }
    if (nuevo.clubpay && !antes.clubpay_api_key && !isMockMode()) {
      throw new HttpError(400, "Para cobrar con ClubPay cargá primero la clave del comercio en la configuración de ClubPay.");
    }

    // Una tienda publicada sin forma de pago o sin forma de entrega toma
    // pedidos que no se pueden cerrar. Se bloquea al publicar y no al apagar
    // el último switch: el comerciante puede estar en el medio de reordenar.
    if (nuevo.habilitada) {
      const pagos = [nuevo.contraEntrega, nuevo.transferencia, nuevo.clubpay, nuevo.cuentaCorriente];
      if (!pagos.some(Boolean)) {
        throw new HttpError(400, "Elegí al menos una forma de pago antes de publicar la tienda.");
      }
      if (!nuevo.retiro && !nuevo.envioPropio) {
        throw new HttpError(400, "Elegí al menos una forma de entrega: retiro en el local o envío propio.");
      }
    }

    const { rows } = await pool.query(
      `UPDATE commerces SET
         nexotienda_enabled = $2, pay_on_delivery_enabled = $3,
         transfer_enabled = $4, transfer_alias = $5, transfer_holder = $6,
         clubpay_pay_enabled = $7, online_credit_enabled = $8,
         pickup_enabled = $9, own_delivery_enabled = $10
       WHERE id = $1 RETURNING ${COLUMNAS}`,
      [commerceId, nuevo.habilitada, nuevo.contraEntrega, nuevo.transferencia,
       nuevo.alias, nuevo.titular, nuevo.clubpay, nuevo.cuentaCorriente,
       nuevo.retiro, nuevo.envioPropio]
    );
    await audit(commerceId, "settings.nexotienda", "commerces", commerceId, nuevo);
    res.json(armarTienda(rows[0]));
  } catch (err) {
    next(err);
  }
});

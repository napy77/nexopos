import { Router } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { isMockMode } from "../integrations/clubpay.js";
import { formaDelSlug, sugerirSlug } from "../lib/slug.js";

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

const COLUMNAS = `slug, name, logo_url, banner_url, whatsapp, opening_hours,
                  free_delivery_over, nexotienda_enabled, pay_on_delivery_enabled, transfer_enabled,
                  transfer_alias, transfer_holder, clubpay_pay_enabled,
                  online_credit_enabled, pickup_enabled, own_delivery_enabled,
                  clubpay_api_key`;

function armarTienda(r: Record<string, unknown>, regiones: unknown[] = []) {
  const clubpayListo = Boolean(r.clubpay_api_key) || isMockMode();
  const slug = (r.slug as string | null) ?? null;
  return {
    habilitada: r.nexotienda_enabled,
    slug,
    /** La propuesta, para que la acepte o la cambie */
    slugSugerido: sugerirSlug(String(r.name ?? "")),
    logoUrl: r.logo_url ?? null,
    bannerUrl: r.banner_url ?? null,
    whatsapp: r.whatsapp ?? null,
    aclaracionHorario: r.opening_hours ?? null,
    envioGratisDesde: r.free_delivery_over === null ? null : Number(r.free_delivery_over),
    direccion: slug ? `https://${slug}.nexotienda.app` : null,
    regiones,
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
    res.json(armarTienda(rows[0], await regionesDe(req.auth.commerceId)));
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
      // Sin slug no hay dirección: la tienda existiría sin lugar donde abrirla.
      if (!antes.slug) {
        throw new HttpError(400, "Elegí la dirección de tu tienda antes de publicarla.");
      }
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
    res.json(armarTienda(rows[0], await regionesDe(commerceId)));
  } catch (err) {
    next(err);
  }
});

// ── La dirección de la tienda ───────────────────────────────────────────────

/**
 * Las regiones a las que pertenece el comercio, con el switch de si aparece.
 *
 * Pertenecer y aparecer son dos decisiones distintas: la primera se deriva de
 * su zona de reparto y la decide Nexo; la segunda la decide el comerciante y
 * arranca apagada. Poner a dos supermercados del mismo pueblo uno al lado del
 * otro con los precios a la vista es un objeto social distinto en un pueblo que
 * en Amazon: los dos dueños se conocen.
 */
async function regionesDe(commerceId: number) {
  const { rows } = await pool.query(
    `SELECT r.slug, r.name, r.label, cr.aparece
       FROM commerce_regions cr JOIN regions r ON r.slug = cr.region_slug
      WHERE cr.commerce_id = $1 ORDER BY r.name`,
    [commerceId]
  );
  return rows.map((r) => ({
    slug: r.slug, nombre: r.name, label: r.label || r.name, aparece: r.aparece,
  }));
}

const slugSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1),
});

/**
 * PUT /api/settings/tienda-slug — el comerciante elige su dirección.
 *
 * Cambiarla rompe links, y acá los links viajan por WhatsApp: el estado del
 * súper, el grupo del barrio, la señora que reenvía. Por eso el anterior no se
 * libera —queda tomado para siempre— y NexoTienda lo sigue resolviendo con un
 * redirect al nuevo. Reasignarlo le daría a otro comercio el tráfico del
 * primero.
 */
settingsRouter.put("/tienda-slug", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { slug } = slugSchema.parse(req.body);
    const commerceId = req.auth.commerceId;

    const forma = formaDelSlug(slug);
    if (!forma.ok) throw new HttpError(400, forma.motivo!);

    await client.query("BEGIN");
    const { rows: actuales } = await client.query(
      "SELECT slug FROM commerces WHERE id = $1 FOR UPDATE", [commerceId]
    );
    const anterior: string | null = actuales[0]?.slug ?? null;
    if (anterior === slug) {
      await client.query("COMMIT");
      res.json({ slug, direccion: `https://${slug}.nexotienda.app` });
      return;
    }

    // Contra los tres conjuntos. El propio anterior sí se puede retomar: es
    // suyo, nadie más pudo haberlo agarrado.
    const { rows: choques } = await client.query(
      `SELECT 'Ya lo usa otro comercio' AS motivo FROM commerces WHERE slug = $1 AND id <> $2
       UNION ALL
       SELECT 'Lo usaba otro comercio antes' FROM commerce_previous_slugs
        WHERE slug = $1 AND commerce_id <> $2
       UNION ALL
       SELECT 'Es la página de un pueblo' FROM regions WHERE slug = $1
       LIMIT 1`,
      [slug, commerceId]
    );
    if (choques[0]) throw new HttpError(409, `No se puede usar "${slug}": ${choques[0].motivo}.`);

    if (anterior) {
      await client.query(
        `INSERT INTO commerce_previous_slugs (slug, commerce_id) VALUES ($1, $2)
         ON CONFLICT (slug) DO NOTHING`,
        [anterior, commerceId]
      );
    }
    await client.query("UPDATE commerces SET slug = $2 WHERE id = $1", [commerceId, slug]);
    await client.query("COMMIT");
    await audit(commerceId, "settings.slug", "commerces", commerceId, { anterior, slug });
    res.json({ slug, direccion: `https://${slug}.nexotienda.app`, anterior });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/** PUT /api/settings/regiones/:slug — aparecer o no en la página del pueblo */
settingsRouter.put("/regiones/:slug", async (req, res, next) => {
  try {
    const aparece = Boolean(req.body?.aparece);
    const { rowCount } = await pool.query(
      `UPDATE commerce_regions SET aparece = $3
        WHERE commerce_id = $1 AND region_slug = $2`,
      [req.auth.commerceId, String(req.params.slug), aparece]
    );
    if (rowCount === 0) throw new HttpError(404, "Este comercio no reparte en esa región.");
    await audit(req.auth.commerceId, "settings.region", "commerces", req.auth.commerceId,
      { region: req.params.slug, aparece });
    res.json({ regiones: await regionesDe(req.auth.commerceId) });
  } catch (err) {
    next(err);
  }
});

// ── Lo que la tienda necesita y NexoB2B no tiene ────────────────────────────

const perfilSchema = z.object({
  /** Identifica al comercio en una lista. Cuadrado. */
  logoUrl: z.string().nullable().optional(),
  /** La cara de su tienda: la foto ancha de arriba. */
  bannerUrl: z.string().nullable().optional(),
  /** El número de atención al comprador, que puede no ser el de B2B */
  whatsapp: z.string().trim().max(40).nullable().optional(),
  /** "Feriados cerrado" y cosas así. El horario sale de los tramos. */
  aclaracionHorario: z.string().trim().max(200).nullable().optional(),
  envioGratisDesde: z.coerce.number().nonnegative().nullable().optional(),
});

/**
 * PUT /api/settings/tienda-perfil
 *
 * Solo lo que B2B no tiene. La dirección, el teléfono y el rubro se editan
 * allá y se copian al iniciar sesión: dos lugares donde cambiar la misma
 * dirección terminan en dos direcciones distintas.
 */
settingsRouter.put("/tienda-perfil", async (req, res, next) => {
  try {
    const b = perfilSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    const { rows } = await pool.query(
      `UPDATE commerces SET
         logo_url = CASE WHEN $2::boolean THEN $3 ELSE logo_url END,
         banner_url = CASE WHEN $4::boolean THEN $5 ELSE banner_url END,
         whatsapp = CASE WHEN $6::boolean THEN $7 ELSE whatsapp END,
         opening_hours = CASE WHEN $8::boolean THEN $9 ELSE opening_hours END,
         free_delivery_over = CASE WHEN $10::boolean THEN $11 ELSE free_delivery_over END
       WHERE id = $1 RETURNING ${COLUMNAS}`,
      [commerceId,
       b.logoUrl !== undefined, b.logoUrl ?? null,
       b.bannerUrl !== undefined, b.bannerUrl ?? null,
       b.whatsapp !== undefined, b.whatsapp || null,
       b.aclaracionHorario !== undefined, b.aclaracionHorario || null,
       b.envioGratisDesde !== undefined, b.envioGratisDesde ?? null]
    );
    await audit(commerceId, "settings.tienda-perfil", "commerces", commerceId,
      { logo: b.logoUrl !== undefined, banner: b.bannerUrl !== undefined });
    res.json(armarTienda(rows[0], await regionesDe(commerceId)));
  } catch (err) {
    next(err);
  }
});

// ── Horario y franjas ───────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const tramoSchema = z.object({
  dia: z.coerce.number().int().min(0).max(6),
  desde: z.string().regex(HHMM, "La hora va como HH:MM"),
  hasta: z.string().regex(HHMM, "La hora va como HH:MM"),
});

/**
 * PUT /api/settings/horario — reemplaza el horario completo.
 *
 * Se manda entero y no tramo por tramo: un horario es una sola cosa, y
 * editarlo de a pedazos deja estados intermedios donde el comercio figura
 * abierto un rato que ya borró.
 */
settingsRouter.put("/horario", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tramos = z.array(tramoSchema).max(30).parse(req.body?.tramos ?? []);
    for (const t of tramos) {
      if (t.desde >= t.hasta) {
        throw new HttpError(400, `El tramo ${t.desde}–${t.hasta} termina antes de empezar.`);
      }
    }
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    await client.query("DELETE FROM commerce_hours WHERE commerce_id = $1", [commerceId]);
    for (const t of tramos) {
      await client.query(
        "INSERT INTO commerce_hours (commerce_id, dia, desde, hasta) VALUES ($1,$2,$3,$4)",
        [commerceId, t.dia, t.desde, t.hasta]
      );
    }
    await client.query("COMMIT");
    await audit(commerceId, "settings.horario", "commerces", commerceId, { tramos: tramos.length });
    res.json({ tramos });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/** GET /api/settings/horario */
settingsRouter.get("/horario", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT dia, desde::text, hasta::text FROM commerce_hours WHERE commerce_id = $1 ORDER BY dia, desde",
      [req.auth.commerceId]
    );
    res.json({ tramos: rows.map((r) => ({
      dia: Number(r.dia), desde: String(r.desde).slice(0, 5), hasta: String(r.hasta).slice(0, 5),
    })) });
  } catch (err) {
    next(err);
  }
});

const slotsSchema = z.array(z.object({
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["retiro", "reparto"]),
  fee: z.coerce.number().nonnegative().default(0),
})).max(20);

/**
 * PUT /api/settings/franjas
 *
 * Las franjas no son una limitación: son lo que hace rentable el reparto
 * propio, porque permiten salir a las 12 y a las 19 con cinco pedidos de la
 * misma zona. El reparto inmediato convierte cada pedido en un viaje.
 */
settingsRouter.put("/franjas", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const franjas = slotsSchema.parse(req.body?.franjas ?? []);
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    await client.query("DELETE FROM commerce_slots WHERE commerce_id = $1", [commerceId]);
    let orden = 0;
    for (const f of franjas) {
      await client.query(
        "INSERT INTO commerce_slots (commerce_id, label, kind, fee, orden) VALUES ($1,$2,$3,$4,$5)",
        [commerceId, f.label, f.kind, f.fee, orden++]
      );
    }
    await client.query("COMMIT");
    await audit(commerceId, "settings.franjas", "commerces", commerceId, { franjas: franjas.length });
    res.json({ franjas });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

/** GET /api/settings/franjas */
settingsRouter.get("/franjas", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, label, kind, fee FROM commerce_slots WHERE commerce_id = $1 ORDER BY orden, id",
      [req.auth.commerceId]
    );
    res.json({ franjas: rows.map((r) => ({
      id: Number(r.id), label: r.label, kind: r.kind, fee: Number(r.fee),
    })) });
  } catch (err) {
    next(err);
  }
});

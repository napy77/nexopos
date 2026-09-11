import { Router } from "express";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { requiereClave } from "../middleware/api-key.js";
import { disponibilidadDe, type Availability } from "./disponibilidad.js";
import { ZONA } from "../lib/fechas.js";

/**
 * La API que consume NexoTienda.
 *
 * La forma de cada objeto está tipada en `src/lib/nexopos/types.ts` del repo de
 * NexoTienda: ese archivo es el contrato. Los nombres de campo son de ellos,
 * incluso donde acá se llaman distinto.
 *
 * Dos convenciones que no se negocian:
 *
 * - **Todos los importes en centavos enteros.** Adentro guardamos NUMERIC en
 *   pesos; la conversión pasa en esta frontera y en ningún otro lado.
 * - **Nada se cachea.** El stock cambia con cada venta del mostrador, y un
 *   catálogo de hace cinco minutos vende lo que ya no está.
 */
export const v1Router = Router();

const centavos = (pesos: unknown): number => Math.round(Number(pesos ?? 0) * 100);

// ── Está abierto ahora ──────────────────────────────────────────────────────

/**
 * `null` cuando el comercio no cargó su horario. No `false`.
 *
 * Decir "cerrado" porque no sabemos es afirmar algo que no se puede respaldar,
 * y encima le apaga la tienda a alguien que está atendiendo. La tienda ya sabe
 * mostrar "no sabemos": es lo mismo que hace con `availability: unknown`.
 */
function abiertoAhora(tramos: { dia: number; desde: string; hasta: string }[]): boolean | null {
  if (tramos.length === 0) return null;
  const ahora = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const partes = Object.fromEntries(fmt.formatToParts(ahora).map((p) => [p.type, p.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dia = dias[partes.weekday as string];
  const hm = `${partes.hour}:${partes.minute}`;
  return tramos.some((t) => t.dia === dia && t.desde.slice(0, 5) <= hm && hm < t.hasta.slice(0, 5));
}

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/**
 * "Lun a Sáb 08:30 a 13:00 y 17:00 a 21:30 | Dom 09:00 a 13:00"
 *
 * Los días con el mismo horario se agrupan: siete renglones iguales no los lee
 * nadie. La aclaración del comerciante —"feriados cerrado"— va al final, que es
 * lo único que no se puede derivar de los tramos.
 */
function textoHorario(
  tramos: { dia: number; desde: string; hasta: string }[],
  aclaracion: string | null
): string | undefined {
  if (tramos.length === 0) return aclaracion ?? undefined;

  const porDia = new Map<number, string>();
  for (const t of tramos) {
    const previo = porDia.get(t.dia);
    const tramo = `${t.desde} a ${t.hasta}`;
    porDia.set(t.dia, previo ? `${previo} y ${tramo}` : tramo);
  }

  // De lunes a domingo, que es como se lee un horario
  const orden = [1, 2, 3, 4, 5, 6, 0].filter((d) => porDia.has(d));
  const grupos: { dias: number[]; horario: string }[] = [];
  for (const d of orden) {
    const h = porDia.get(d)!;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.horario === h) ultimo.dias.push(d);
    else grupos.push({ dias: [d], horario: h });
  }

  const partes = grupos.map((g) => {
    const etiqueta = g.dias.length === 1 ? DIAS[g.dias[0]]
      : g.dias.length === 2 ? `${DIAS[g.dias[0]]} y ${DIAS[g.dias[1]]}`
      : `${DIAS[g.dias[0]]} a ${DIAS[g.dias[g.dias.length - 1]]}`;
    return `${etiqueta} ${g.horario}`;
  });
  return [partes.join(" | "), aclaracion].filter(Boolean).join(" · ");
}

// ── Store ───────────────────────────────────────────────────────────────────

const SELECT_STORE = `
  SELECT c.id, c.slug, c.name, c.category, c.address, c.phone, c.whatsapp,
         c.logo_url, c.banner_url, c.opening_hours, c.verified, c.nexotienda_enabled,
         c.free_delivery_over, c.ciudad, c.provincia,
         c.pay_on_delivery_enabled, c.transfer_enabled, c.clubpay_pay_enabled,
         c.online_credit_enabled, c.clubpay_api_key
    FROM commerces c`;

async function armarStore(fila: Record<string, unknown>) {
  const id = Number(fila.id);
  const [horas, slots, region] = await Promise.all([
    pool.query("SELECT dia, desde::text, hasta::text FROM commerce_hours WHERE commerce_id = $1", [id]),
    pool.query(
      "SELECT id, label, kind, fee FROM commerce_slots WHERE commerce_id = $1 ORDER BY orden, id",
      [id]
    ),
    // La región donde el comercio eligió aparecer. Pertenecer no alcanza: es
    // opt-in, porque poner a dos supermercados del mismo pueblo con los precios
    // a la vista es un objeto social distinto en un pueblo que en Amazon.
    pool.query(
      `SELECT r.slug, r.name FROM commerce_regions cr JOIN regions r ON r.slug = cr.region_slug
        WHERE cr.commerce_id = $1 AND cr.aparece ORDER BY r.name LIMIT 1`,
      [id]
    ),
  ]);

  const online = Boolean(fila.pay_on_delivery_enabled) || Boolean(fila.transfer_enabled)
    || (Boolean(fila.clubpay_pay_enabled) && Boolean(fila.clubpay_api_key));

  return {
    id: String(id),
    slug: fila.slug ?? null,
    name: fila.name,
    category: fila.category ?? null,
    town: region.rows[0]?.name ?? fila.ciudad ?? null,
    townSlug: region.rows[0]?.slug ?? null,
    address: fila.address ?? null,
    phone: fila.phone ?? undefined,
    whatsapp: fila.whatsapp ?? undefined,
    logoUrl: fila.logo_url ?? undefined,
    /** La foto ancha de la tienda. El logo identifica; el banner es su cara. */
    bannerUrl: fila.banner_url ?? undefined,
    /**
     * El texto del horario se arma de los tramos en vez de pedírselo escrito.
     * Si fueran dos campos, tarde o temprano dicen cosas distintas y el que se
     * come el viaje al local es el cliente.
     */
    openingHours: textoHorario(
      horas.rows.map((h) => ({ dia: Number(h.dia), desde: String(h.desde).slice(0, 5), hasta: String(h.hasta).slice(0, 5) })),
      (fila.opening_hours as string | null) ?? null
    ),
    /** Los tramos, para que la tienda pueda mostrar el horario y calcular sola */
    hours: horas.rows.map((h) => ({
      dia: Number(h.dia), desde: String(h.desde).slice(0, 5), hasta: String(h.hasta).slice(0, 5),
    })),
    isOpenNow: abiertoAhora(horas.rows.map((h) => ({
      dia: Number(h.dia), desde: String(h.desde), hasta: String(h.hasta),
    }))),
    verified: Boolean(fila.verified),
    storefrontPublished: Boolean(fila.nexotienda_enabled),
    slots: slots.rows.map((s) => ({
      id: String(s.id), label: s.label, kind: s.kind,
      ...(Number(s.fee) > 0 ? { feeCents: centavos(s.fee) } : {}),
    })),
    ...(fila.free_delivery_over !== null
      ? { freeDeliveryOverCents: centavos(fila.free_delivery_over) } : {}),
    acceptsOnlinePayment: online,
    allowsCredit: Boolean(fila.online_credit_enabled),
  };
}

// ── Product ─────────────────────────────────────────────────────────────────

const SELECT_PRODUCTOS = `
  SELECT p.id, p.name, p.brand, p.descripcion, p.ean, p.unit, p.origen, s.commerce_id,
         p.pasillo_id, p.pasillo_nombre, p.subrubro_nombre,
         COALESCE(s.image_url, p.image_url) AS image_url,
         s.sale_price, s.quantity, s.availability_policy, s.declared_state,
         s.quota_total, s.quota_remaining, s.quota_day
    FROM stock_items s JOIN products p ON p.id = s.product_id
   WHERE s.commerce_id = $1
     -- El insumo no se vende en ningún lado; published_in_store es el que el
     -- comercio vende en el mostrador pero no quiere publicar. Son distintos.
     AND NOT s.es_insumo AND s.published_in_store`;

function armarProduct(r: Record<string, unknown>, storeId: string) {
  return {
    id: String(r.id),
    storeId,
    name: r.name,
    brand: r.brand ?? undefined,
    description: r.descripcion ?? undefined,
    imageUrl: r.image_url ?? undefined,
    priceCents: centavos(r.sale_price),
    unit: r.unit ?? "unidad",
    pasilloId: r.pasillo_id ?? "sin-pasillo",
    subCategory: r.subrubro_nombre ?? undefined,
    origin: r.origen === "propio" ? "propio" : "canonico",
    ean: r.ean ?? undefined,
    availability: disponibilidadDe(r as never) as Availability,
  };
}

async function comercioPublicado(por: "slug" | "id", valor: string) {
  const { rows } = await pool.query(
    `${SELECT_STORE} WHERE c.${por === "slug" ? "slug" : "id"} = $1`,
    [por === "slug" ? valor : Number(valor)]
  );
  return rows[0] ?? null;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

v1Router.use(requiereClave("catalogo"));

/**
 * GET /v1/hosts/:sub — ¿qué es este subdominio?
 *
 * Es la consulta que decide si una tienda existe: un slug funciona en el
 * instante en que esto lo devuelve, porque el certificado y el DNS son comodín.
 *
 * Resuelve también los slugs que un comercio dejó atrás, para que los links que
 * ya circularon por WhatsApp no mueran; la tienda redirige al actual.
 */
v1Router.get("/hosts/:sub", async (req, res, next) => {
  try {
    const sub = String(req.params.sub).trim().toLowerCase();

    const region = await pool.query("SELECT slug, name FROM regions WHERE slug = $1", [sub]);
    if (region.rows[0]) {
      res.json({ kind: "town", townSlug: region.rows[0].slug, name: region.rows[0].name });
      return;
    }

    const actual = await comercioPublicado("slug", sub);
    if (actual) {
      res.json({ kind: "store", store: await armarStore(actual) });
      return;
    }

    const { rows: viejos } = await pool.query(
      `SELECT c.slug FROM commerce_previous_slugs ps
         JOIN commerces c ON c.id = ps.commerce_id
        WHERE ps.slug = $1 AND c.slug IS NOT NULL`,
      [sub]
    );
    if (viejos[0]) {
      res.json({ kind: "moved", slug: viejos[0].slug });
      return;
    }
    throw new HttpError(404, "No existe ese subdominio");
  } catch (err) {
    next(err);
  }
});

/** GET /v1/stores/:slug */
v1Router.get("/stores/:slug", async (req, res, next) => {
  try {
    const fila = await comercioPublicado("slug", String(req.params.slug).toLowerCase());
    if (!fila) throw new HttpError(404, "No existe ese comercio");
    res.json(await armarStore(fila));
  } catch (err) {
    next(err);
  }
});

/** GET /v1/stores/:storeId/pasillos */
v1Router.get("/stores/:storeId/pasillos", async (req, res, next) => {
  try {
    const storeId = Number(req.params.storeId);
    const { rows } = await pool.query(
      `SELECT COALESCE(p.pasillo_id, 'sin-pasillo') AS id,
              COALESCE(MAX(p.pasillo_nombre), 'Otros') AS name,
              COUNT(*)::int AS product_count,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.subrubro_nombre), NULL) AS subs
         FROM stock_items s JOIN products p ON p.id = s.product_id
        WHERE s.commerce_id = $1 AND NOT s.es_insumo AND s.published_in_store
        GROUP BY COALESCE(p.pasillo_id, 'sin-pasillo')
        ORDER BY name`,
      [storeId]
    );
    res.json(rows.map((r) => ({
      id: r.id, name: r.name, subCategories: r.subs ?? [], productCount: r.product_count,
    })));
  } catch (err) {
    next(err);
  }
});

/** GET /v1/stores/:storeId/products */
v1Router.get("/stores/:storeId/products", async (req, res, next) => {
  try {
    const storeId = String(Number(req.params.storeId));
    const { rows } = await pool.query(`${SELECT_PRODUCTOS} ORDER BY p.name`, [Number(storeId)]);
    res.json(rows.map((r) => armarProduct(r, storeId)));
  } catch (err) {
    next(err);
  }
});

/** GET /v1/stores/:storeId/products/:id */
v1Router.get("/stores/:storeId/products/:id", async (req, res, next) => {
  try {
    const storeId = String(Number(req.params.storeId));
    const { rows } = await pool.query(`${SELECT_PRODUCTOS} AND p.id = $2`,
      [Number(storeId), Number(req.params.id)]);
    if (!rows[0]) throw new HttpError(404, "No existe ese producto");
    res.json(armarProduct(rows[0], storeId));
  } catch (err) {
    next(err);
  }
});

/** GET /v1/towns/:townSlug/stores — los que eligieron aparecer */
v1Router.get("/towns/:townSlug/stores", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `${SELECT_STORE}
        JOIN commerce_regions cr ON cr.commerce_id = c.id
       WHERE cr.region_slug = $1 AND cr.aparece AND c.slug IS NOT NULL
       ORDER BY c.name`,
      [String(req.params.townSlug).toLowerCase()]
    );
    res.json(await Promise.all(rows.map(armarStore)));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/towns/:townSlug/search?q= — buscar en el pueblo
 *
 * `exhaustive: false` siempre, y no es un detalle: **nunca podemos afirmar que
 * nadie tiene algo.** La respuesta vacía es "no lo encontramos cargado", no
 * "nadie lo tiene" — puede haber un comercio que lo tenga y no lo haya subido.
 */
v1Router.get("/towns/:townSlug/search", async (req, res, next) => {
  try {
    const town = String(req.params.townSlug).toLowerCase();
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.json({ query: q, hits: [], exhaustive: false });
      return;
    }

    const { rows } = await pool.query(
      `${SELECT_PRODUCTOS.replace("WHERE s.commerce_id = $1", "WHERE true")}
         AND s.commerce_id IN (
           SELECT cr.commerce_id FROM commerce_regions cr
            WHERE cr.region_slug = $1 AND cr.aparece)
         AND (p.name ILIKE $2 OR p.brand ILIKE $2)
       ORDER BY p.name LIMIT 60`,
      [town, `%${q}%`]
    );

    const porComercio = new Map<number, Record<string, unknown>>();
    const hits = [];
    for (const r of rows) {
      const cid = Number((r as { commerce_id?: number }).commerce_id ?? 0);
      if (!porComercio.has(cid)) {
        const fila = await comercioPublicado("id", String(cid));
        if (!fila) continue;
        porComercio.set(cid, await armarStore(fila));
      }
      const store = porComercio.get(cid)!;
      hits.push({
        product: armarProduct(r, String(cid)),
        store: {
          id: store.id, slug: store.slug, name: store.name,
          isOpenNow: store.isOpenNow, storefrontPublished: store.storefrontPublished,
        },
      });
    }
    // Las búsquedas sin resultado se registran: son señal de demanda para el
    // comercio, para el mayorista y para el equipo comercial de Nexo B2B.
    if (hits.length === 0) {
      await pool.query(
        `INSERT INTO audit_log (commerce_id, action, entity, payload)
         VALUES (NULL, 'tienda.busqueda_vacia', 'regions', $1)`,
        [JSON.stringify({ region: town, q })]
      ).catch(() => {});
    }
    res.json({ query: q, hits, exhaustive: false });
  } catch (err) {
    next(err);
  }
});

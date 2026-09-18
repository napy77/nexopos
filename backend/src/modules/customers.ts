import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { pool, audit } from "../db.js";
import { gruposDuplicados, telefonoNormalizado, documentoNormalizado } from "../lib/identidad.js";
import { HttpError } from "../middleware/error.js";
import { sesionAbierta } from "./caja.js";
import { clubpayKey } from "./clubpay.js";
import { vincularCliente } from "../integrations/clubpay.js";
import { encolarMovimiento, refrescarVinculacion } from "./clubpay-outbox.js";
import { periodoAbierto, imputarPago, pilaDe, estadoCredito, ritmoDePago } from "./cuenta-corriente.js";

export const customersRouter = Router();

const customerSchema = z.object({
  name: z.string().min(1),
  docNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

/** GET /api/customers — clientes del comercio con saldo */
customersRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, doc_number, phone, email, balance, created_at,
              clubpay_status, clubpay_checked_at
       FROM customers WHERE commerce_id = $1 ORDER BY name`,
      [req.auth.commerceId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers/duplicados — las fichas que parecen la misma persona.
 *
 * Existe porque el comerciante no tenía forma de enterarse: busca por nombre,
 * ve una línea, y las dos fichas del mismo señor conviven años con saldos
 * distintos. En Jure hay dos "Germán Yovan", uno con $850 y otro con $27.519,20,
 * y el documento de uno tiene un dígito comido.
 *
 * No fusiona nada. Fusionar es sumar saldos y mover movimientos, y si está mal
 * alguien queda debiendo lo que no debe: eso lo decide el comerciante ficha por
 * ficha, mirándolas.
 */
customersRouter.get("/duplicados", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, doc_number, phone, balance, clubpay_status
         FROM customers WHERE commerce_id = $1 ORDER BY name`,
      [req.auth.commerceId]
    );
    const saldoDe = new Map(rows.map((r) => [Number(r.id), r]));
    res.json(
      gruposDuplicados(rows.map((r) => ({
        id: Number(r.id), name: r.name, doc_number: r.doc_number, phone: r.phone,
      }))).map((g) => ({
        motivo: g.motivo,
        clave: g.clave,
        fichas: g.fichas.map((f) => {
          const fila = saldoDe.get(f.id);
          return {
            id: f.id, nombre: f.name, documento: f.doc_number, telefono: f.phone,
            saldo: Number(fila?.balance ?? 0),
            clubpay: fila?.clubpay_status ?? null,
          };
        }),
      }))
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers/similar?phone=&doc= — ¿ya tengo a esta persona?
 *
 * Se consulta mientras el comerciante escribe el alta, antes de guardar. Cortar
 * el nacimiento de duplicados nuevos es barato; limpiar los viejos no.
 */
customersRouter.get("/similar", async (req, res, next) => {
  try {
    const tel = telefonoNormalizado(String(req.query.phone ?? ""));
    const doc = documentoNormalizado(String(req.query.doc ?? ""));
    if (!tel && !doc) { res.json([]); return; }

    const { rows } = await pool.query(
      "SELECT id, name, doc_number, phone, balance FROM customers WHERE commerce_id = $1",
      [req.auth.commerceId]
    );
    const parecidas = rows.filter((r) =>
      (tel && telefonoNormalizado(r.phone) === tel) ||
      (doc && documentoNormalizado(r.doc_number) === doc)
    );
    res.json(parecidas.map((r) => ({
      id: Number(r.id), nombre: r.name, documento: r.doc_number,
      telefono: r.phone, saldo: Number(r.balance),
      motivo: tel && telefonoNormalizado(r.phone) === tel ? "telefono" : "documento",
    })));
  } catch (err) {
    next(err);
  }
});

/** POST /api/customers — alta de cliente */
customersRouter.post("/", async (req, res, next) => {
  try {
    const body = customerSchema.parse(req.body);
    const {
      rows: [customer],
    } = await pool.query(
      `INSERT INTO customers (commerce_id, name, doc_number, phone, email)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.auth.commerceId, body.name, body.docNumber ?? null, body.phone ?? null, body.email ?? null]
    );
    await audit(req.auth.commerceId, "customer.create", "customers", customer.id);
    if (body.docNumber) await proponerVinculacion(req, customer.id, body.docNumber);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/customers/:id — corregir la ficha.
 *
 * En el mostrador se tipea mal: un DNI con un dígito de menos, un nombre a las
 * apuradas. Sin esto el error queda para siempre y, peor, la vinculación con
 * ClubPay queda apuntando a otra persona o a nadie.
 *
 * Si cambia el DNI se vuelve a proponer la vinculación con el nuevo y se borra
 * el estado anterior: era el de otro documento y no dice nada de este.
 */
customersRouter.put("/:id", async (req, res, next) => {
  try {
    const body = customerSchema.parse(req.body);
    const id = Number(req.params.id);
    const { rows: previas } = await pool.query(
      "SELECT doc_number FROM customers WHERE id = $1 AND commerce_id = $2",
      [id, req.auth.commerceId]
    );
    if (!previas[0]) throw new HttpError(404, "Cliente no encontrado");

    const docNuevo = body.docNumber ?? null;
    const cambioDni = (previas[0].doc_number ?? null) !== docNuevo;

    const { rows: [customer] } = await pool.query(
      `UPDATE customers SET name = $1, doc_number = $2, phone = $3, email = $4
         ${cambioDni ? ", clubpay_status = NULL, clubpay_checked_at = NULL" : ""}
       WHERE id = $5 AND commerce_id = $6 RETURNING *`,
      [body.name, docNuevo, body.phone ?? null, body.email ?? null, id, req.auth.commerceId]
    );
    await audit(req.auth.commerceId, "customer.update", "customers", id, body);
    if (cambioDni && docNuevo) await proponerVinculacion(req, id, docNuevo);

    const { rows: [fresco] } = await pool.query(
      `SELECT id, name, doc_number, phone, email, balance, created_at,
              clubpay_status, clubpay_checked_at
       FROM customers WHERE id = $1`,
      [customer.id]
    );
    res.json(fresco);
  } catch (err) {
    next(err);
  }
});

/**
 * Le propone a la persona ver esta cuenta corriente en su ClubPay.
 *
 * Nunca hace fallar el alta: que ClubPay esté caído no puede impedir que el
 * almacenero cargue un cliente. Si no sale, queda sin estado y se puede
 * reintentar desde la ficha.
 */
async function proponerVinculacion(
  req: Request, customerId: number, dni: string, silencioso = true
): Promise<string | null> {
  try {
    const key = await clubpayKey(req);
    const r = await vincularCliente(key, { dni, externalId: `CLI-${customerId}` });
    await pool.query(
      `UPDATE customers SET clubpay_status = $1, clubpay_checked_at = now(),
              clubpay_linked_at = CASE
                WHEN clubpay_status IS DISTINCT FROM $1 THEN now() ELSE clubpay_linked_at END
        WHERE id = $2`,
      [r.status, customerId]
    );
    return r.status;
  } catch (err) {
    console.error("[clubpay] no se pudo proponer la vinculación:", err instanceof Error ? err.message : err);
    /*
     * Al dar de alta el cliente se traga el error a propósito: el alta no puede
     * fallar porque ClubPay no conteste, y el comerciante está esperando para
     * fiarle a alguien que tiene enfrente.
     *
     * Pero cuando el que aprieta es el botón de "Proponer vinculación", el
     * error tiene que salir. Si se lo traga, la pantalla dice "todavía no se le
     * propuso" para siempre y el comerciante aprieta el mismo botón toda la
     * semana sin enterarse de que le falta cargar la clave de ClubPay.
     */
    if (!silencioso) throw err;
    return null;
  }
}

/**
 * POST /api/customers/:id/clubpay — propone la vinculación, o vuelve a
 * preguntar en qué quedó.
 *
 * Hace falta porque ClubPay no nos avisa cuando la persona acepta: la única
 * forma de enterarse es volver a preguntar. Repetirlo es inofensivo, no pisa
 * una vinculación ya aceptada.
 */
customersRouter.post("/:id/clubpay", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, doc_number, clubpay_status FROM customers WHERE id = $1 AND commerce_id = $2",
      [Number(req.params.id), req.auth.commerceId]
    );
    if (!rows[0]) throw new HttpError(404, "Cliente no encontrado");
    if (!rows[0].doc_number) {
      throw new HttpError(400, "Cargale el DNI al cliente para poder proponerle la vinculación.");
    }

    /*
     * Proponer o volver a preguntar, según en qué esté. La pantalla ya muestra
     * dos textos distintos en el botón; hasta ahora el backend hacía siempre lo
     * mismo —consultar— así que el que decía "Proponer vinculación" no proponía
     * nada.
     *
     * Y consultar por alguien que nunca se propuso no puede funcionar: ClubPay
     * no lo conoce. El cliente quedaba trabado para siempre, y el mensaje
     * mandaba a esperar un rato.
     */
    if (!rows[0].clubpay_status) {
      const status = await proponerVinculacion(
        req, Number(rows[0].id), String(rows[0].doc_number), false
      );
      res.json({ status });
      return;
    }

    // Ya propuesta: se consulta, que además recupera los movimientos que
    // quedaron sin avisar si la persona aceptó y no nos enteramos.
    const status = await refrescarVinculacion(req.auth.commerceId, Number(rows[0].id), false);
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

/** GET /api/customers/:id/transactions — historial de cuenta corriente */
customersRouter.get("/:id/transactions", async (req, res, next) => {
  try {
    // Devuelve la ficha completa, no solo el saldo: la pantalla reemplaza con
    // esto al cliente que tenía seleccionado, así que lo que falte acá
    // desaparece de la ficha.
    const { rows: customers } = await pool.query(
      `SELECT id, name, doc_number, phone, email, balance,
              clubpay_status, clubpay_checked_at
       FROM customers WHERE id = $1 AND commerce_id = $2`,
      [Number(req.params.id), req.auth.commerceId]
    );
    if (!customers[0]) throw new HttpError(404, "Cliente no encontrado");

    // Si estaba esperando respuesta, se vuelve a preguntar al abrir la ficha:
    // es el momento en que al almacenero le importa saberlo, y es cuando
    // suele estar la persona delante preguntando por qué no lo ve.
    if (customers[0].clubpay_status === "propuesta") {
      const nuevo = await refrescarVinculacion(req.auth.commerceId, customers[0].id);
      if (nuevo) customers[0].clubpay_status = nuevo;
    }
    const { rows: transactions } = await pool.query(
      `SELECT id, type, amount, sale_id, note, created_at
       FROM customer_transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [customers[0].id]
    );
    const [{ periods }, credito, ritmo] = await Promise.all([
      pilaDe(req.auth.commerceId, Number(customers[0].id)),
      estadoCredito(pool, req.auth.commerceId, Number(customers[0].id)),
      ritmoDePago(req.auth.commerceId, Number(customers[0].id)),
    ]);
    res.json({ customer: customers[0], transactions, periods, credito, ritmo });
  } catch (err) {
    next(err);
  }
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  note: z.string().optional(),
  // Con qué pagó: importa para el arqueo (si fue efectivo, está en el cajón)
  paymentMethod: z.enum(["cash", "wallet", "card", "transfer"]).default("cash"),
  /**
   * Forzar a qué resumen se imputa. Sin esto va del más viejo al más nuevo,
   * que es lo que hace el cuaderno; el override existe porque a veces el
   * comerciante dice "no, dejá, esto es lo de este mes".
   */
  periodId: z.coerce.number().int().optional(),
});

/** POST /api/customers/:id/payments — registra un pago que baja la deuda */
customersRouter.post("/:id/payments", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = paymentSchema.parse(req.body);
    const commerceId = req.auth.commerceId;
    await client.query("BEGIN");
    const { rows: customers } = await client.query(
      "SELECT id, balance FROM customers WHERE id = $1 AND commerce_id = $2 FOR UPDATE",
      [Number(req.params.id), commerceId]
    );
    if (!customers[0]) throw new HttpError(404, "Cliente no encontrado");
    const sesion = await sesionAbierta(commerceId, client);
    const periodo = await periodoAbierto(client, commerceId, Number(customers[0].id));
    const { rows: [movimiento] } = await client.query(
      `INSERT INTO customer_transactions
         (commerce_id, customer_id, type, amount, note, payment_method, cash_session_id, period_id)
       VALUES ($1, $2, 'payment', $3, $4, $5, $6, $7) RETURNING id`,
      [commerceId, customers[0].id, -body.amount, body.note ?? "Pago recibido",
       body.paymentMethod, sesion?.id ?? null, periodo.id]
    );
    // Se imputa a los resúmenes cerrados, del más viejo al más nuevo. Lo que
    // sobre queda a cuenta del período abierto: la plata no queda colgada.
    const imputado = await imputarPago(
      client, commerceId, Number(customers[0].id), Number(movimiento.id),
      body.amount, body.periodId
    );
    await encolarMovimiento(client, {
      commerceId,
      customerId: Number(customers[0].id),
      transactionId: movimiento.id,
      kind: "pago",
      amount: -body.amount,
      description: body.note ?? "Pago recibido",
    });
    const {
      rows: [updated],
    } = await client.query(
      "UPDATE customers SET balance = balance - $1 WHERE id = $2 RETURNING balance",
      [body.amount, customers[0].id]
    );
    await client.query("COMMIT");
    await audit(commerceId, "customer.payment", "customers", customers[0].id, body);
    res.json({ ok: true, balance: Number(updated.balance), imputado });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

const creditoSchema = z.object({
  /** null saca el límite. Sin límite es el default: así funciona el cuaderno. */
  creditLimit: z.coerce.number().nonnegative().nullable().optional(),
  creditPaused: z.boolean().optional(),
});

/**
 * PUT /api/customers/:id/credito — el límite y la pausa.
 *
 * Decidir tiene que costar un toque: es un switch en la ficha, no un formulario
 * de configuración. Y la decisión es del comerciante siempre — el sistema puede
 * sugerirle que pause a alguien con dos cierres impagos, nunca hacerlo solo.
 */
customersRouter.put("/:id/credito", async (req, res, next) => {
  try {
    const body = creditoSchema.parse(req.body);
    const id = Number(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE customers SET
         credit_limit = CASE WHEN $3::boolean THEN $4 ELSE credit_limit END,
         credit_paused = COALESCE($5, credit_paused)
       WHERE id = $1 AND commerce_id = $2`,
      [id, req.auth.commerceId, body.creditLimit !== undefined,
       body.creditLimit ?? null, body.creditPaused ?? null]
    );
    if (rowCount === 0) throw new HttpError(404, "Cliente no encontrado");
    await audit(req.auth.commerceId, "customer.credito", "customers", id, body);
    res.json(await estadoCredito(pool, req.auth.commerceId, id));
  } catch (err) {
    next(err);
  }
});

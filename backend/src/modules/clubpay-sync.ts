import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { HttpError } from "../middleware/error.js";
import { enviarTienda, espejarLibreta, vinculacionAceptada } from "../integrations/clubpay.js";

/**
 * Lo que ClubPay espeja de nosotros: la tienda de cada comercio y la libreta de
 * cada cliente (CR-0003). Tabla y porqué en migrations/044_clubpay_sync.sql.
 *
 * Mismo principio que la cola de movimientos: la marca se escribe en la misma
 * transacción que el cambio, y la llamada por red pasa después, afuera. Que
 * ClubPay esté caído no impide publicar una tienda ni abrir una libreta.
 */

export type TipoSync = "tienda" | "libreta";

type Ejecutor = Pick<PoolClient, "query">;

/** Igual que la cola de movimientos: casi dos días y se deja de insistir. */
const MAX_INTENTOS = 12;
const esperaMinutos = (intentos: number): number => [1, 5, 15, 60][intentos] ?? 360;

/**
 * "Esto está desactualizado en ClubPay." Se llama dentro de la transacción del
 * cambio. Marcar de nuevo algo ya marcado sube la versión y reinicia los
 * intentos: un cambio nuevo merece la oportunidad completa.
 */
export async function marcarSync(
  db: Ejecutor, tipo: TipoSync, commerceId: number, refId: number
): Promise<void> {
  await db.query(
    `INSERT INTO clubpay_sync (tipo, ref_id, commerce_id) VALUES ($1, $2, $3)
     ON CONFLICT (tipo, ref_id) DO UPDATE
       SET version = clubpay_sync.version + 1, intentos = 0,
           proximo_intento = now(), ultimo_error = NULL, updated_at = now()`,
    [tipo, refId, commerceId]
  );
}

/** Para los cambios que hasta acá eran una sola consulta suelta. */
export async function enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Manda lo que está desactualizado, leyendo el estado del momento y no el del
 * cambio: si se cambió dos veces mientras ClubPay no contestaba, sale lo último.
 */
export async function despacharSync(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT s.tipo, s.ref_id, s.commerce_id, s.version, s.intentos,
            c.clubpay_api_key, c.slug, c.nexotienda_enabled,
            cu.libreta_activa, cu.clubpay_account_id, cu.clubpay_status
       FROM clubpay_sync s
       JOIN commerces c ON c.id = s.commerce_id
       LEFT JOIN customers cu ON s.tipo = 'libreta' AND cu.id = s.ref_id AND cu.commerce_id = s.commerce_id
      WHERE s.intentos < $1 AND s.proximo_intento <= now()
      ORDER BY s.updated_at
      LIMIT 50`,
    [MAX_INTENTOS]
  );

  let enviados = 0;
  for (const f of rows) {
    const borrar = () => pool.query(
      "DELETE FROM clubpay_sync WHERE tipo = $1 AND ref_id = $2 AND version = $3",
      [f.tipo, f.ref_id, f.version]
    );

    /*
     * Sin clave no hay a quién avisarle, y sin cuenta vinculada ClubPay no
     * tiene dónde anotarlo. No es un error: se borra la marca, y la carga de
     * la clave o la aceptación del vínculo vuelven a marcar.
     */
    if (!f.clubpay_api_key) { await borrar(); continue; }
    /*
     * Sin dirección elegida no se manda nada. Los dos campos en null le dicen
     * a ClubPay "cerró la tienda" y desde ahí ignora lo que tenga de Nexo B2B
     * para ese comercio: un comercio que cargó la clave antes de elegir su
     * dirección dejaría sin botón una tienda que ClubPay tenía cargada a mano.
     * En NexoPOS un slug se cambia pero no se borra, así que no hay un "volvió
     * a null" que avisar.
     */
    if (f.tipo === "tienda" && !f.slug) { await borrar(); continue; }
    if (f.tipo === "libreta" && (!f.clubpay_account_id || !vinculacionAceptada(f.clubpay_status))) {
      await borrar(); continue;
    }

    try {
      if (f.tipo === "tienda") {
        // Despublicada se manda con su slug y `false`, no con los dos en null:
        // el slug sigue siendo suyo, sólo deja de tener el botón en la app.
        await enviarTienda(f.clubpay_api_key, {
          slug: f.slug, publicada: Boolean(f.nexotienda_enabled),
        });
      } else {
        await espejarLibreta(f.clubpay_api_key, f.clubpay_account_id, Boolean(f.libreta_activa));
      }
      await borrar();
      enviados++;
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      /*
       * Un 4xx no se arregla reintentando: un slug que ClubPay tiene con otro
       * comercio (409), una clave inválida. Se deja la fila con el error a la
       * vista y se corta. ClubPay pidió que el 409 del slug se le avise a
       * German: es un dato viejo de su lado.
       *
       * El 404 es la excepción y se reintenta: es lo que contesta ClubPay
       * mientras no despliega estas rutas, y no se distingue de "esa cuenta no
       * es de este comercio". Si es lo segundo, deja de insistir solo a los
       * dos días; si es lo primero, sale cuando desplieguen.
       */
      const definitivo = err instanceof HttpError && err.status >= 400 && err.status < 500
        && err.status !== 404;
      const intentos = definitivo ? MAX_INTENTOS : f.intentos + 1;
      await pool.query(
        `UPDATE clubpay_sync
            SET intentos = $4, ultimo_error = $5,
                proximo_intento = now() + ($6 || ' minutes')::interval
          WHERE tipo = $1 AND ref_id = $2 AND version = $3`,
        [f.tipo, f.ref_id, f.version, intentos, detalle.slice(0, 400), esperaMinutos(intentos)]
      );
      if (intentos >= MAX_INTENTOS) {
        console.error(`[clubpay] ${f.tipo} ${f.ref_id} (comercio ${f.commerce_id}) sin enviar: ${detalle}`);
      }
    }
  }
  return enviados;
}

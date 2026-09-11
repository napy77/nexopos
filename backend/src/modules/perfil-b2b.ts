import { pool } from "../db.js";
import { fichaComercio, type B2BComercio } from "../integrations/nexob2b.js";

/**
 * Copia local de la ficha que el comerciante mantiene en NexoB2B.
 *
 * Dirección, teléfono y rubro son suyos y viven allá: el alta del comerciante
 * es en B2B y el login de NexoPOS es esa misma cuenta. Acá se copian para
 * poder servirlos en la tienda sin salir a buscarlos en cada request, **pero
 * no se editan**. Dos lugares donde cambiar la misma dirección terminan en dos
 * direcciones distintas, y la que ve el cliente es la que esté mal.
 *
 * Lo que sí es de acá —y por eso no viene de B2B— es lo que la tienda necesita
 * y el marketplace no: el WhatsApp de atención, el logo, el horario y las
 * franjas de reparto.
 */
export async function sincronizarFicha(commerceId: number, token: string): Promise<void> {
  const ficha = await fichaComercio(token);
  if (!ficha) return;

  // `rubros` es un JSON y puede venir como lista o como texto suelto. Se toma
  // el primero: en la tienda la categoría es una sola línea.
  const rubros = ficha.rubros;
  const categoria = Array.isArray(rubros) ? String(rubros[0] ?? "") || null
    : typeof rubros === "string" ? rubros || null : null;

  await pool.query(
    `UPDATE commerces SET
       address  = COALESCE($2, address),
       phone    = COALESCE($3, phone),
       category = COALESCE($4, category)
     WHERE id = $1`,
    [commerceId, ficha.direccion ?? null, ficha.telefono ?? null, categoria]
  );

  await sincronizarRegiones(commerceId, ficha.regiones ?? []);
}

/**
 * Los pueblos donde reparte, que los decide Nexo en el admin de B2B.
 *
 * El switch de **aparecer** en la página del pueblo no se toca acá: es del
 * comerciante y se conserva. Si B2B lo saca de una región, la fila se borra;
 * si se la vuelve a asignar, arranca apagada otra vez —y está bien, porque es
 * una decisión que él tomó sobre una pertenencia que ya no era la misma—.
 */
async function sincronizarRegiones(
  commerceId: number,
  regiones: { slug: string; name: string; province: string; label: string }[]
): Promise<void> {
  for (const r of regiones) {
    await pool.query(
      `INSERT INTO regions (slug, name, province, label) VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, province = EXCLUDED.province,
         label = EXCLUDED.label, synced_at = now()`,
      [r.slug, r.name, r.province ?? "", r.label ?? ""]
    );
    await pool.query(
      `INSERT INTO commerce_regions (commerce_id, region_slug) VALUES ($1, $2)
       ON CONFLICT (commerce_id, region_slug) DO NOTHING`,
      [commerceId, r.slug]
    );
  }

  const slugs = regiones.map((r) => r.slug);
  await pool.query(
    `DELETE FROM commerce_regions
      WHERE commerce_id = $1 AND NOT (region_slug = ANY($2::text[]))`,
    [commerceId, slugs]
  );
}

/**
 * Reglas del slug: lo que va antes del punto en `supersol.nexotienda.app`.
 *
 * **Es una copia de `src/lib/slug.ts` de NexoTienda, a pedido de ellos.** Las
 * reglas salen de cómo está armada su infraestructura y tienen que ser las
 * mismas de los dos lados: si acá aceptáramos algo que allá no resuelve, el
 * comerciante guardaría una dirección que no abre.
 *
 * Si cambian allá, hay que cambiarlas acá.
 */

/**
 * Un solo espacio de nombres para todo lo que cuelga del dominio: comercios y
 * regiones comparten subdominio.
 *
 * `acme` y `acme-ns` son la delegación del certificado comodín. Tomarlos
 * rompería la renovación de todas las tiendas a la vez, no la de una.
 */
export const SLUGS_RESERVADOS = new Set([
  "www", "api", "admin", "app", "cdn", "assets", "static", "mail", "smtp", "ftp",
  "acme", "acme-ns", "_acme-challenge",
  "ayuda", "soporte", "blog", "panel", "cuenta", "pagos", "status",
]);

export interface FormaSlug {
  ok: boolean;
  motivo?: string;
}

/**
 * Valida la forma. La unicidad se resuelve aparte, contra la base.
 *
 * El límite de un solo nivel no es una preferencia: el certificado es
 * `*.nexotienda.app` y un comodín cubre **una** etiqueta. `a.b.nexotienda.app`
 * no está cubierto y daría error de certificado en el navegador, que es peor
 * que no existir.
 */
export function formaDelSlug(slug: string): FormaSlug {
  if (!slug) return { ok: false, motivo: "Poné un nombre para la dirección." };
  if (slug.includes(".")) {
    return { ok: false, motivo: "No puede llevar puntos: el certificado cubre un solo nivel." };
  }
  if (slug.length < 3) return { ok: false, motivo: "Muy corto: mínimo 3 letras." };
  if (slug.length > 40) return { ok: false, motivo: "Muy largo: máximo 40 letras." };
  if (!/^[a-z0-9]/.test(slug)) return { ok: false, motivo: "Tiene que empezar con letra o número." };
  if (!/[a-z0-9]$/.test(slug)) return { ok: false, motivo: "Tiene que terminar con letra o número." };
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, motivo: "Solo minúsculas, números y guiones. Sin espacios ni acentos." };
  }
  if (slug.includes("--")) return { ok: false, motivo: "No puede llevar dos guiones seguidos." };
  if (SLUGS_RESERVADOS.has(slug)) return { ok: false, motivo: "Ese nombre está reservado." };
  return { ok: true };
}

/** La propuesta que se le muestra al comerciante para que la acepte o la cambie */
export function sugerirSlug(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
}

import { ZONA } from "../lib/fechas.js";

/**
 * El precio de campaña de una línea del stock, hoy.
 *
 * Vive solo, en su propio archivo, porque lo usan tres consultas de dos módulos
 * distintos: la lista de productos de la tienda, la ficha de un producto y el
 * cálculo del pedido. Si el pedido no aplicara el mismo descuento, el comprador
 * vería $6.375 en el changuito y le llegaría un pedido de $8.500. Escrito tres
 * veces, tarde o temprano son tres cuentas.
 *
 * Asume que la consulta tiene `s` como alias de stock_items.
 *
 * Cada producto trae lo suyo: un porcentaje o un precio fijo. El comerciante
 * piensa de las dos formas —"a éste hacele 25%" y "éste lo quiero a $5.000"— y
 * se guarda la que dijo. Convertir el precio a porcentaje lo traicionaría:
 * $8.500 a $5.000 es 41,176470…%, que redondeado devuelve $5.000,30.
 *
 * **Gana el precio más bajo, y no se acumulan.** Un producto puede estar en dos
 * campañas a la vez; acumular dos tandas del 25% daría un 50% que nadie
 * decidió. El más barato es el que el comerciante ya aceptó cobrar y el que el
 * cliente esperaría al ver las dos secciones.
 *
 * Las fechas se comparan en la zona del comercio: una campaña que termina el 15
 * vale hasta que en Córdoba termine el 15, no hasta que termine en Londres.
 */
export const PRECIO_DE_CAMPANA = `(
  SELECT MIN(
           CASE WHEN cp.precio IS NOT NULL
                THEN cp.precio
                ELSE ROUND(s.sale_price * (1 - cp.descuento / 100), 2)
           END)
    FROM campaigns c
    JOIN campaign_products cp ON cp.campaign_id = c.id
   WHERE c.commerce_id = s.commerce_id
     AND cp.product_id = s.product_id
     AND (now() AT TIME ZONE '${ZONA}')::date BETWEEN c.desde AND c.hasta
)`;

/**
 * El precio que se cobra.
 *
 * `LEAST` y no el de campaña a secas: si alguien carga un precio de campaña más
 * alto que el de lista —un cero de más al tipear—, eso no es una oferta y no
 * tiene por qué encarecer la góndola. Una campaña sólo puede bajar.
 */
export const PRECIO_EFECTIVO = `
  CASE WHEN ${PRECIO_DE_CAMPANA} IS NULL THEN s.sale_price
       ELSE LEAST(${PRECIO_DE_CAMPANA}, s.sale_price)
  END`;

/**
 * Cuánto baja, en porcentaje, para la cinta de la tienda.
 *
 * Se deriva de los dos precios en vez de leer el porcentaje guardado, porque
 * con precio fijo no hay porcentaje guardado y porque así lo que dice la cinta
 * y lo que dice la etiqueta no se pueden contradecir.
 *
 * `NULL` cuando no baja nada: la tienda no tacha un precio contra sí mismo.
 */
export const DESCUENTO_VIGENTE = `
  CASE WHEN ${PRECIO_DE_CAMPANA} IS NOT NULL
        AND s.sale_price > 0
        AND ${PRECIO_DE_CAMPANA} < s.sale_price
       THEN ROUND((1 - ${PRECIO_DE_CAMPANA} / s.sale_price) * 100, 2)
  END`;

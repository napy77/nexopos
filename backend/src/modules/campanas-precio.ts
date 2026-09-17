import { ZONA } from "../lib/fechas.js";

/**
 * El descuento de campaña que le toca a una línea del stock, hoy.
 *
 * Vive solo, en su propio archivo, porque lo usan tres consultas de dos módulos
 * distintos: la lista de productos de la tienda, la ficha de un producto y el
 * cálculo del pedido. Si el pedido no aplicara el mismo descuento, el comprador
 * vería $6.375 en el changuito y le llegaría un pedido de $8.500. Escrito tres
 * veces, tarde o temprano son tres cuentas.
 *
 * Asume que la consulta tiene `s` como alias de stock_items.
 *
 * **Gana el descuento más grande, y no se suman.** Un producto puede estar en
 * dos campañas —NexoTienda dejó a nuestro criterio qué precio sale—. Sumarlos
 * convertiría dos tandas del 25% en un 50% que nadie decidió; el más grande es
 * el que el comerciante ya aceptó cobrar y es el que el cliente esperaría.
 *
 * Las fechas se comparan en la zona del comercio: una campaña que termina el 15
 * vale hasta que en Córdoba termine el 15, no hasta que termine en Londres.
 */
export const DESCUENTO_VIGENTE = `(
  SELECT MAX(c.descuento)
    FROM campaigns c
    JOIN campaign_products cp ON cp.campaign_id = c.id
   WHERE c.commerce_id = s.commerce_id
     AND cp.product_id = s.product_id
     AND (now() AT TIME ZONE '${ZONA}')::date BETWEEN c.desde AND c.hasta
)`;

/**
 * El precio que se cobra: el de lista menos la campaña, si hay.
 *
 * Redondeado a dos decimales y nada más. No se le aplica el redondeo comercial
 * de los márgenes a propósito: ahí el número lo está inventando el sistema y
 * conviene que quede prolijo, pero acá el comerciante ya eligió $8.500 y dijo
 * "25%". Redondear el resultado hacia arriba sería cobrarle al cliente un poco
 * más que el descuento prometido.
 */
export const PRECIO_EFECTIVO = `
  CASE WHEN ${DESCUENTO_VIGENTE} IS NULL THEN s.sale_price
       ELSE ROUND(s.sale_price * (1 - ${DESCUENTO_VIGENTE} / 100), 2)
  END`;

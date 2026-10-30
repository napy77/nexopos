# Respuesta a NexoB2B: búsqueda de catálogo por palabras

**De:** NexoPOS · **Para:** NexoB2B · **Fecha:** 30/10/2026
**Sobre:** `PEDIDO-A-NEXOPOS-BUSQUEDA.md`

Gracias por el método y el código.

## La búsqueda en el servidor ya es la de ustedes

En NexoPOS, el catálogo no se busca en nuestra base. Lo pedimos a B2B, y
justo a las dos rutas donde ya está `busquedaProductos`:

| Pantalla del POS | Ruta de B2B |
|---|---|
| Catálogo NexoB2B (comprarle a mayoristas) | `GET /store/productos` |
| Productos → agregar del catálogo maestro | `GET /store/mayoristas/me/catalogo/buscar` |

No reordenamos lo que devuelven. El filtro por pasillo, rubro y marca que
hacemos del lado nuestro mantiene el orden. Desde que ustedes deployaron el 30/10, el
comerciante ya encuentra lo mismo en los dos sistemas, sin copiar
`busqueda.ts`. Si mañana lo mejoran, nos llega solo.

## En la pantalla

- **Catálogo NexoB2B:** aplicamos el punto 1 tal cual: la caja y lo que se
  busca van separados, se busca 400 ms después de la última tecla o al
  instante con Enter, y cada pedido va numerado. Si llega una respuesta vieja,
  se descarta.
- **Agregar del catálogo maestro:** ya cancelaba el pedido anterior y
  descartaba cualquier respuesta de otro término. Lo dejamos como está.

## Una sola cosa para confirmar

¿`/store/mayoristas/me/catalogo/buscar` también busca por EAN de las
presentaciones cuando viene `q`? Nosotros mandamos `ean=` sólo cuando el texto
son 8 a 14 dígitos. Un código más corto, como un PLU, viaja como `q`.

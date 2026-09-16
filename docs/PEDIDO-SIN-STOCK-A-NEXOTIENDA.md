# El comerciante puede esconder lo que no tiene

## Qué pasó

Rivera Hogar abrió su tienda con pantallas enteras de **"No disponible"**.
Importó tres mil artículos del catálogo mayorista y la mayoría no los tiene en
el mostrador. Una tienda que abre así parece cerrada.

Pero esconderlos siempre tampoco sirve: el almacén de barrio quiere mostrar que
el producto existe y que lo tiene habitualmente, porque eso es la venta de
pasado mañana.

Así que lo decide el comerciante, con un tilde en su configuración de NexoPOS.

## Qué cambia en la API

Un campo nuevo en el objeto `Store`:

```json
{
  "id": "12",
  "slug": "rivera-hogar",
  "showsOutOfStock": false
}
```

- `true` (el valor por defecto, y lo que pasa hoy en todas las tiendas): nada
  cambia. El catálogo viene completo y ustedes siguen pintando "No disponible"
  con el `availability` de cada producto, como hasta ahora.
- `false`: **los productos sin stock no vienen en la lista**. Los filtramos
  nosotros, antes de responder.

`GET /stores/:slug/pasillos` respeta el mismo filtro: los `productCount` cuentan
sólo lo que van a recibir. Una solapa nunca les va a prometer productos que la
lista no trae.

## Qué les pedimos

**Nada obligatorio.** Con `showsOutOfStock: false` el catálogo simplemente viene
más corto y todo sigue funcionando sin que toquen una línea.

Lo que sí conviene, y por eso mandamos el campo en vez de filtrar en silencio:

1. **Si tienen un filtro de "ver también los agotados"**, escondanlo cuando
   `showsOutOfStock` es `false`. Es un filtro que no puede cumplir: al marcarlo
   no va a aparecer nada nuevo, y el comprador va a pensar que la tienda está
   rota.

2. **Si tienen un texto tipo "no encontramos nada"** en una búsqueda vacía,
   quizá quieran matizarlo: con el tilde apagado, buscar algo que el comercio
   tiene en el catálogo pero no en la góndola no devuelve nada. No es un error,
   es la decisión del comerciante.

3. **No cacheen la lista más de lo que ya hacen.** El tilde se puede apagar y
   prender desde NexoPOS en cualquier momento, y el catálogo cambia de tamaño
   al instante.

## Qué contamos como "sin stock"

Es exactamente la misma cuenta que ya hace `availability`, para que no haya
manera de que escondamos algo que les decimos tener:

- `policy: "stock"` → lo escondemos si `onHand` es 0 o menos.
- `policy: "declared"` → lo escondemos si el estado es `out`, o si tiene cupo
  del día y ya no le queda.
- `policy: "unknown"` → **nunca lo escondemos.** No saber no es lo mismo que no
  tener, y esconder algo por las dudas le tapa la venta a un comercio que
  probablemente lo tenga.

## Lo que no cambia

El producto sigue existiendo: si entran por el enlace directo de un producto
escondido —`GET /stores/:id/products/:productId`— lo devolvemos igual, con su
`availability` diciendo que no hay. Un enlace que alguien compartió por
WhatsApp la semana pasada no tiene por qué romperse; que diga "no disponible"
es mejor que un 404.

Si prefieren que ese caso también devuelva 404, díganlo y lo cambiamos, pero
nos parece peor.

# Campañas: el endpoint está

Y con lo que pedían en el punto 2, que era lo único importante: **el precio
llega con el descuento ya aplicado.**

## El endpoint

```
GET /v1/stores/:storeId/campaigns      (clave `catalogo`)

[
  {
    "id": "1",
    "storeId": "1",
    "name": "Ofertas imperdibles",
    "startsAt": "2026-09-17T03:00:00.000Z",
    "endsAt": "2026-09-18T02:59:59.999Z",
    "discountPercent": 25,
    "productIds": ["331", "412"]
  }
]
```

Sólo las vigentes, `[]` cuando no hay, y en el orden que el comerciante eligió
—tiene flechitas para subirlas y bajarlas en su pantalla—.

Sobre las fechas: guardamos **días**, no instantes, porque el comerciante piensa
"del 1 al 15" y el 15 incluye el 15 entero. El `startsAt` y el `endsAt` que
reciben son los bordes de esos días en la zona del comercio, por eso el `endsAt`
cae a las 02:59 UTC del día siguiente.

## El precio, que era el punto

Tienen razón y está hecho así. Un producto de $8.500 en una campaña del 25%:

```json
{ "priceCents": 637500, "listPriceCents": 850000 }
```

`listPriceCents` va **sólo cuando hay descuento**. Mandarlo siempre haría que
tachen un precio contra sí mismo.

Y lo que más nos importó de su documento: eso los obligaba a ustedes a no
multiplicar, pero nos obligaba a nosotros a aplicarlo en **tres** lugares —la
lista de productos, la ficha de uno, y el cálculo del pedido—. El tercero es el
que importa y el que era fácil de olvidar: sin él, el comprador veía la oferta
en la vidriera y le llegaba un pedido al precio de lista. La expresión del
precio vive en un solo archivo y las tres consultas la importan; escrita tres
veces, tarde o temprano son tres cuentas.

Probado: un pedido de 2 yerbas en campaña del 25% cae con subtotal $12.750, que
es exactamente 2 × el precio que muestra el catálogo.

## Los dos casos que dejaron a nuestro criterio

**Un producto en dos campañas vigentes: gana el descuento más grande, y no se
suman.** Sumar dos tandas del 25% daría un 50% que nadie decidió. El más grande
es el que el comerciante ya aceptó cobrar, y es el que el cliente esperaría si
viera las dos secciones.

Aparece en las dos secciones con el mismo precio, como ustedes describieron.

**Un producto que ya estaba rebajado:** el `sale_price` del POS ya es el precio
rebajado, así que la campaña se aplica sobre ése. Mismo resultado.

## Lo de la cinta nos gustó

Sacar el porcentaje de los precios del producto y no del de la campaña es lo
correcto, y el ejemplo que dan —una campaña "del 35%" mostrando 18, 19 y 20
según el producto— es justo el caso donde el número de la campaña mentiría.
Nosotros mandamos los dos precios para que puedan hacerlo.

## Lo del punto 4: el changuito viejo

Todavía no está. Hoy `POST /v1/orders` devuelve el total correcto pero no avisa
que cambió respecto de lo que el comprador vio, porque **no nos mandan lo que
el comprador vio**.

Si nos agregan un `expectedTotalCents` opcional en el pedido, devolvemos algo
del estilo:

```json
{ "priceChanged": true, "expectedTotalCents": 1700000, "totalCents": 1275000 }
```

y ustedes le dicen "el precio cambió, ahora sale $X". Sin ese dato no podemos
distinguir un precio que cambió de un comprador que nunca vio un total.

Nos parece que vale la pena y es media hora de los dos lados, pero no lo
construimos por las nuestras porque el campo es de ustedes.

## Una decisión nuestra que conviene que sepan

**La campaña cambia el precio de la tienda, no el del mostrador.** El cajero
sigue cobrando $8.500 por la yerba que en la tienda sale $6.375.

No es un olvido: cambiar lo que cobra la caja es tocar el camino del dinero, y
nadie lo pidió. La pantalla del comerciante lo dice arriba de todo, para que no
publique "25% off" y después tenga una discusión en el mostrador.

Si algún comerciante pide que valga en los dos lados, lo agregamos como una
opción de la campaña. Por ahora no inventamos la opción.

## Para el piloto

Como pidieron: nombre, fechas, descuento y productos. Sin imagen de campaña, sin
banner y sin orden manual dentro de la tanda.

Lo único que agregamos fuera de esa lista es poder meter todo un rubro de una:
un comercio con siete mil productos no arma una tanda buscándolos de a uno. Se
expande a productos explícitos, así que sacar uno después es sacar uno.

# Campañas: el descuento pasó a ser de cada producto

Un cambio en el modelo de campañas que les toca en dos puntos. **Ninguno los
rompe**, pero uno de los dos les cambia lo que un número significa.

---

## Qué cambió del lado del comerciante

Antes la campaña tenía un porcentaje y se aplicaba a todo lo que entrara. Ahora
cada producto lleva el suyo, y se puede poner de dos formas: **un porcentaje** o
**un precio fijo**.

El motivo es de góndola: una tanda de ofertas no tiene un solo número. Al arroz
se le hace 30 y al aceite 12, porque el margen de cada uno es distinto. Con un
porcentaje por campaña, el comerciante terminaba armando tres campañas para lo
que es una sola oferta.

## 1. `discountPercent` ahora es "hasta", no "el descuento"

```json
{ "name": "Ofertas imperdibles", "discountPercent": 41.18, "productIds": ["423","421","422"] }
```

Es **el más alto de la tanda**. Antes era el único que había; ahora los productos
tienen distintos, así que un número solo miente salvo que se lea como *"hasta
41%"*.

Si lo muestran en algún lado, conviene esa palabra. Si no lo muestran, no
cambia nada: como ustedes mismos escribieron, el porcentaje de cada cinta sale
de los dos precios del producto, y eso sigue igual y sigue siendo lo correcto.

**Los precios no cambian de forma.** `priceCents` sigue llegando con el descuento
de ESE producto ya aplicado, y `listPriceCents` sigue yendo sólo cuando hay
diferencia:

```
Zucaritas       priceCents=595000   listPriceCents=850000     (30%)
Arroz Gallo     priceCents=400000   listPriceCents=850000     (precio fijo $4.000)
Aceite Natura   priceCents=500000   listPriceCents=850000     (precio fijo $5.000)
```

Tres productos de la misma campaña con tres rebajas distintas, cada uno con su
número. Y el pedido cobra lo mismo: probamos 2 arroces y cae en $8.000.

## 2. `productIds` ahora viene en el orden que eligió el comerciante

Antes salía ordenado por id. Ahora sale en el orden que él arrastró.

**Esto les importa por lo que nos contaron ustedes**: la tienda muestra los
primeros y el resto queda en "Ver todos". Si el comerciante tiene un producto
que empieza con Z y quiere que se vea primero, ahora puede, y el arreglo ya
viene así.

Lo único que les pedimos es que **no lo reordenen**. Si lo ordenan por nombre o
por precio del lado de ustedes, la decisión del comerciante se pierde sin que
nadie lo note — que es exactamente lo que pasaba hasta ahora.

## Lo que no cambió

- La forma de `Campaign` es la misma: mismos campos, mismos nombres.
- Sólo las vigentes, `[]` cuando no hay.
- El orden de las campañas entre sí sigue siendo el del arreglo, como
  acordamos. Ahora el comerciante las arrastra en vez de subirlas de a una.
- Un producto en dos campañas paga **el precio más bajo**, no la suma. Es el
  mismo criterio de antes —"el descuento más grande"— traducido a que ahora
  puede haber precios fijos.
- Una campaña sólo puede bajar el precio. Si alguien carga un precio de campaña
  más alto que el de lista —un cero de más al tipear— lo ignoramos: eso no es
  una oferta y no tiene por qué encarecer la góndola.

## Si tuvieran que tocar algo

Nada obligatorio. Las dos cosas que valen la pena:

1. Si muestran el `discountPercent` de la campaña, agregarle "hasta".
2. Si en algún lado reordenan `productIds`, dejar de hacerlo.

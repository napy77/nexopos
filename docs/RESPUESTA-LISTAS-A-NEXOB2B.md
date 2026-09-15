# Listas de precios y stock propio — respuesta de NexoPOS

## Lo que hicimos

**El precio ya entra al POS.** Hasta ahora `catalogoPropio()` descartaba
`precio` a propósito, y el comentario decía por qué: era el precio de lista del
mayorista, y tomarlo tenía poco sentido para el comercio. Con la lista aplicada
el número pasó a ser suyo, así que ahora entra **como costo** en la importación
de catálogo propio. El comerciante lo ve en la columna de costo de la pantalla
de productos y al lado del campo de precio de venta, que es donde lo necesita:
está poniendo el precio de mostrador y quiere saber sobre qué.

**El stock también entra**, en la primera importación, con un movimiento de
tipo `import` para que quede el asiento. Antes entraba en cero por precaución
—no sabíamos si el ERP del cliente escribía en los dos lados— y el resultado
era un catálogo entero sin stock, que no se puede vender ni publicar en la
tienda. Cero también es un número equivocado, y más caro de corregir.

**En una reimportación no se pisa nada del comerciante.** El precio de venta y
la cantidad quedan como los tenía. El costo sí se refresca: para sus propios
productos el número de ustedes no es una opinión, lo cargó él mismo allá.

Verificado contra la base, las dos ramas:

```
importación en limpio → stock 5.000 · costo 21629.30 · precio de venta (ninguno)
                        movimiento: import +5.000
reimportación         → costo refrescado; stock 15.000 y precio 52000.00 intactos
```

**El precio de venta sigue sin tomarse, y esto no cambió.** El de ustedes es el
costo. Un import que le ponga precio de mostrador a tres mil productos de golpe
los hace vender a costo hasta que alguien cierre la caja y lo note.

## `PUT /api/v1/pos/stock`: no lo llamábamos

No van a recibir ningún 403 nuestro. NexoPOS nunca llamó a ese endpoint —ni a
`/api/v1/mayorista/sync`—; el único consumo que tenemos del lado de ustedes es
`GET /api/v1/pos/productos` para la importación de catálogo propio.

Así que el agujero que cerraron no lo estábamos usando, y hacen bien en
cerrarlo igual.

## Preguntas

### 1. ¿La lista se aplica también en `/store/productos`?

Es la que más nos preocupa. El mensaje habla de `/api/v1/pos/productos`, que
nosotros usamos sólo para el catálogo propio. Pero la pantalla donde el
comerciante **compra** —la que mira precios, arma el carrito y manda la orden—
lee `/store/productos`, y de ahí salen `precio` y `precio_lista`.

Si la lista se aplica en uno y no en el otro, el comerciante con un 30%
acordado ve el precio de lista mientras arma la compra y recibe otro número en
la orden. Es el mismo error que acaban de corregir, del otro lado.

Si ya se aplica en los dos, decímelo y cerramos el tema.

### 2. `precio_lista` y `precio_sin_ajuste`, ¿son lo mismo?

Tenemos dos endpoints con dos nombres para lo que parece el mismo tachado.
Hoy mostramos `precio_lista` como columna en la pantalla de catálogo. Antes de
agregar `precio_sin_ajuste` necesito saber si son el mismo concepto con otro
nombre —y entonces conviene unificarlo— o si son dos cosas distintas, y cuál
va en el tachado.

### 3. El stock del mayorista, ¿lo podemos leer siempre?

Hoy lo leemos una sola vez, al importar, y lo dejamos como punto de partida.
Si `/api/v1/pos/productos` devuelve siempre el stock actual de la cuenta
propia, podríamos ofrecerle al híbrido un aviso del tipo "acá tenés 3 y en
NexoB2B 47" sin sincronizar nada. Mostrar la diferencia es barato y no se pisa
con ninguna de las dos opciones de abajo.

## La pregunta del ERP: (a) o (b)

Coincidimos en que hay que elegir una, y coincidimos en la preferencia por
**(b)** para el híbrido: el mostrador es el que se entera primero.

Pero (b) tal como está es medio circuito. Cubre POS → B2B: se vende una unidad
en el mostrador y baja en B2B. Falta el otro sentido: cuando el mayorista
despacha una orden por mayor, **el POS no se entera**, y sigue ofreciendo en el
mostrador —y en NexoTienda— unidades que ya salieron en un camión. Para el
híbrido ése es el caso más frecuente de los dos: mueve mucho más volumen por
mayor que por mostrador.

O sea que (b) completo son dos piezas, no una:

1. NexoPOS llama a `PUT /stock` con cantidad negativa en cada venta de
   mostrador de un producto `es_propio`. **Esto lo hacemos nosotros.**
2. NexoB2B nos avisa cuando el stock de una presentación propia cambia por algo
   que no fuimos nosotros —un despacho, una carga del ERP, un ajuste en el
   portal—. **Esto hace falta de ustedes**, y no existe.

Para (2) alcanza un webhook parecido al que ya acordamos con NexoTienda: nos
avisan `presentacion_id` y la cantidad nueva, nosotros escribimos el POS. Si
prefieren que lo consultemos nosotros, un endpoint que devuelva los cambios
desde una marca de tiempo también sirve; el webhook es mejor porque el mostrador
necesita el número ahora, no en el próximo poleo.

**Lo que proponemos:** no construimos la pieza 1 hasta que exista la 2 o hasta
que German confirme con Rivera Hogar que el volumen por mayor es chico y puede
convivir con la diferencia. Media sincronización es peor que ninguna: deja el
stock del POS bajando solo, sin subir nunca, y el comerciante deja de creerle.
Mientras tanto la foto de la importación más el aviso de diferencia de la
pregunta 3 le dan algo honesto: dos números y cuál es cuál.

Sobre si el ERP puede leer las ventas del mostrador —la pregunta que
formulamos y que decide entre (a) y (b)—: **ya está resuelta de nuestro lado.**
Desplegamos la API para ERP, con gestión de claves y documentación para humanos
en https://nexopos.app/docs/api. Expone catálogo, precios, stock y
`GET /api/erp/v1/ventas?desde=…`, que devuelve cada venta del mostrador con sus
líneas, el EAN y el SKU —los pedidos entregados de NexoTienda incluidos, porque
terminan como nota de venta igual—. Un reembolso viene con cantidades
negativas, no como un registro aparte.

O sea que (a) es técnicamente viable hoy: el ERP puede enterarse de las ventas
del mostrador. Lo que no sabemos es si el ERP de Rivera Hogar lo va a
implementar, y eso lo sabe el cliente, no nosotros. La diferencia entre (a) y
(b) dejó de ser "¿se puede?" para ser "¿quién lo escribe?".

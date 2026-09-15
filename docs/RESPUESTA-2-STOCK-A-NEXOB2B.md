# Stock compartido — la pieza 1 está construida

Gracias por el hallazgo del despacho que no descontaba. Ese es el tipo de cosa
que sólo aparece cuando alguien va a construir encima: el webhook habría
avisado de un evento que no ocurría, y lo habríamos dado por andando porque
nunca llegaba nada.

## Lo que hicimos

**La pieza 1 existe.** Cada venta de mostrador de un producto del catálogo
propio encola un aviso y sale a `PUT /api/v1/pos/stock` con cantidad negativa.
Una devolución manda el positivo. Van agrupados por comercio: una venta de diez
renglones sale en una sola llamada.

Sale **sólo** por las líneas del catálogo propio. El stock de lo que el
comercio le compró a otros mayoristas es del POS y no viaja, que es lo que
ustedes pidieron al cerrar el endpoint.

La cola tiene la forma de las otras dos que ya nos unen: la fila se escribe en
la misma transacción que la venta, y la llamada por red pasa después. Que
NexoB2B no conteste no puede frenar al cajero, pero el aviso tampoco puede
perderse, porque entonces allá sobra mercadería que ya se vendió. Reintenta a
1, 5, 15 y 60 minutos y después cada 6 horas. Un ítem que ustedes rechazan por
`ok: false` no se reintenta: doce vueltas no van a convertir ese EAN en propio.

**El webhook entrante también está.** Escribe el total que mandan, registra un
movimiento con la diferencia contra lo que teníamos —eso es lo que el
comerciante necesita leer cuando revisa por qué un número cambió— y contesta
200 aunque una presentación no exista todavía de nuestro lado. No les vamos a
devolver un 4xx por algo que no es problema de ustedes.

**Las dos mitades se prenden juntas**, con un interruptor por comercio, apagado
por defecto. Es la advertencia que hicimos y que ustedes comparten, hecha
código: no se puede encender una sola.

Verificado de punta a punta:

```
venta de 2 unidades   → cola: -2, despachada
webhook stock: 47     → quedó en 47, movimiento b2b +34
token inventado       → 404
presentación ajena    → 200, contada, sin error
interruptor apagado   → no se encola nada y el webhook no escribe
```

## Lo que necesitamos de ustedes

### 1. La URL la carga el comerciante, y se la damos hecha

En Configuración, cuando el comercio tiene catálogo propio importado, aparece
una tarjeta con la dirección lista para copiar:

```
https://nexopos.app/api/nexob2b/stock/<token de 64 caracteres>
```

El token va en la URL porque del otro lado se configura una URL y nada más. Es
aleatorio de 32 bytes, es por comercio, y el comerciante puede regenerarlo si
se filtra.

**Si pueden mandar un header además, mejor.** Una URL con el secreto adentro
queda escrita en logs de proxy, en historiales y en el portapapeles de quien la
pegue. No es motivo para frenar nada —lo construimos así y funciona—, pero si
en algún momento agregan un campo de secreto junto al de URL, lo tomamos.

### 2. `PUT /stock` por EAN nos deja un agujero

Su endpoint acepta `ean`. Nosotros mandamos el EAN y funciona, pero hay dos
casos donde no alcanza:

**Presentaciones que comparten el EAN del producto.** Una "unidad" y una "caja
x12" sin `ean_propio` propio llegan con el mismo EAN. Si ustedes actualizan
todas las presentaciones que coinciden —y `presentaciones_actualizadas` sugiere
que puede ser más de una—, vender una unidad descontaría también una caja. Doce
unidades de diferencia por cada venta.

**Presentaciones sin EAN.** Hoy las salteamos: no hay con qué nombrarlas. Para
ese comercio, esa parte del catálogo no se sincroniza y no hay forma de que se
entere.

Las dos se arreglan con lo mismo: que `PUT /stock` acepte `presentacion_id`
—el del maestro, el que ya nos mandan en el webhook y el que usamos para
deduplicar— como alternativa al EAN. Si lo aceptan, migramos a eso y sacamos el
EAN del circuito.

### 3. ¿Qué pasa si el mismo comercio manda dos avisos juntos?

Su endpoint suma deltas, entendemos. Si un reintento nuestro llega después de
uno que sí había entrado, ¿lo suman dos veces? Si es así necesitamos una clave
de idempotencia por aviso; podemos mandar la nuestra en cada ítem. Si ya
descartan repetidos, díganlo y no tocamos nada.

## Lo que no mandamos, a propósito

Un ajuste manual de stock en el POS **no** viaja. Si el comerciante cuenta la
góndola y corrige, eso queda acá.

La razón: el mostrador sabe primero que la unidad se fue, y eso es un hecho.
Pero un conteo es una opinión sobre el total, y el total es justo lo que el ERP
también cree saber. Dos sistemas corrigiendo el mismo total se pisan sin que
nadie note cuál ganó. Si prefieren que también viaje, lo agregamos, pero nos
parece que ahí empieza el problema que los dos queremos evitar.

## Sobre la advertencia del ERP

Coincidimos, y es exactamente por eso que el interruptor arranca apagado y la
pantalla lo dice antes de que el comerciante lo toque:

> Si tu ERP escribe el stock en NexoB2B, tiene que dejar de reescribir el total
> de estos productos. Si no, te devuelve las unidades que el mostrador acaba de
> descontar.

Para Rivera Hogar la decisión es del cliente. Nosotros dejamos las dos piezas
listas y el interruptor a mano; German lo prende cuando ellos confirmen.

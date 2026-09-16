# Stock compartido — migrado a lo nuevo

Los tres cambios están tomados y probados. De nuestro lado no queda nada
pendiente tampoco.

## 1. Migramos a `presentacion_id`

Ya no mandamos EAN cuando tenemos la presentación maestra, que es siempre para
lo que entró por la importación de catálogo propio. Con eso desaparecen los dos
problemas de una: la caja x12 que se descontaba de más, y las presentaciones
sin EAN que salteábamos.

El EAN queda como alternativa para un caso nuestro: hay filas viejas donde
guardamos el listing del mayorista (`pmp_`) en vez de la presentación maestra,
porque entraron por una recepción de compra y no por la importación. Para ésas
mandamos EAN. Con el criterio nuevo que aplicaron —si ninguna presentación
tiene ese `ean_propio`, es la unitaria— eso ahora es correcto.

## 2. La clave de idempotencia es el lote, y se fija antes de salir

Gracias por confirmar que sumaban dos veces. Nos hizo mirar la nuestra con más
cuidado, y ahí había una trampa que vale contar porque no es obvia:

la clave **no puede calcularse con lo que esté pendiente en el momento de
reintentar**. Si entre el intento que falló y el siguiente entra una venta
nueva, el conjunto cambia, la clave cambia, y lo que ya se había aplicado del
otro lado se aplica de nuevo — justo lo que la clave venía a evitar.

Así que el lote se asigna cuando el aviso sale por primera vez y no se mueve.
Se reintenta siempre el mismo lote, con los mismos ítems; lo que llegó después
espera al suyo. Verificado: con un lote esperando reintento, una venta nueva se
fue en un lote propio y el que falló conservó el suyo.

Una consecuencia para ustedes: van a ver más llamadas y más chicas de las que
verían si agrupáramos todo lo pendiente. Es a propósito.

## 3. El secreto

Tomado. `X-Nexob2b-Secret`, comparado en tiempo constante — un `===` sobre un
secreto contesta más rápido cuando los primeros caracteres no coinciden, y eso
se mide.

Convive con el token de la URL como plantearon: mientras el comerciante no
cargue el secreto de su lado, el header no llega y vale el token. Una vez que
está cargado acá, se exige; a esa altura la única razón para que falte es que
el pedido no venga de ustedes.

Probado: sin header 401, secreto equivocado 401, uno del mismo largo pero
distinto 401, el correcto 200.

## Lo que el comerciante tiene para copiar

En Configuración de NexoPOS, la tarjeta "Stock compartido con NexoB2B" muestra
los dos valores con su botón de copiar:

```
Dirección   https://nexopos.app/api/nexob2b/stock/<token de 64 caracteres>
Secreto     <64 caracteres>
```

Van los dos en la misma clave de API del comercio, en el campo de dirección y
en el de secreto. Con sólo la dirección funciona; con los dos es mejor.

Regenerar cambia los dos juntos, a propósito: el que regenera porque perdió el
control de uno no sabe si perdió el otro, y dejarle la mitad vieja es dejarle
el problema.

## El estado

```
mostrador vende     → PUT /stock con presentacion_id + lote  ✓ construido
mayorista despacha  → webhook con X-Nexob2b-Secret            ✓ construido
ERP carga stock     → webhook                                 ✓ construido
```

Falta lo que no depende de ninguno de los dos equipos: que Rivera Hogar
confirme si su ERP va a dejar de reescribir el total de estos productos. Hasta
entonces el interruptor se queda apagado, con la advertencia a la vista arriba
del switch.

Sobre el ajuste manual: de acuerdo en dejarlo afuera, y de acuerdo en que si
algún día hace falta sea un movimiento explícito y visible de los dos lados, no
un delta más mezclado con las ventas.

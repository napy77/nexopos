# Respuesta a lo que contestaron

Todo lo que pidieron está construido y probado de este lado. Abajo van las
confirmaciones que pedían, la URL del webhook y las dos preguntas que nos
hicieron.

Primero, la corrección.

---

## Tenían razón: no había nada que reponer

Escribimos que ustedes «eliminaron `/account/statements`» y «sacaron el campo
`period`». **Es falso y la palabra era nuestra, no de ustedes.** Su documento
decía «se cae de la propuesta, no lo implementamos» — o sea que nunca existió, y
lo que se sacó fue del acuerdo, en la conversación, antes de que ninguno de los
dos escribiera una línea.

No es una diferencia de matiz: convierte «restaurar» en «escribir por primera
vez», que es un trabajo distinto e incluye una pantalla de su app. La disculpa
del documento anterior sobraba y la corrección la aceptamos entera.

---

## Las confirmaciones que pedían

### `statement_id` en los tres lugares — de acuerdo

Tienen razón y el argumento es el correcto: lo que la persona ve es un resumen.
Ya sale así en el movimiento, en el cierre y en el pago. No queda ningún
`period_id` en el contrato.

### El total del resumen es la verdad; los movimientos no suman — **confirmado**

Su regla es exactamente la nuestra, y la habíamos implementado antes de leerla:
**el cierre congela el total**. De este lado, un período cerrado no cambia aunque
después aparezca algo, porque un documento que se mueve no se puede pagar ni
discutir.

Así que sí: los movimientos con ese `statement_id` son el detalle para que la
persona abra el resumen y vea qué compró, y lo único que suma es el período
abierto. Un movimiento que llega tarde —nuestra cola reintentando— se cuelga del
resumen como detalle y no mueve el total.

Bien pescado que esto podía costar plata.

### `paid_cents` lo reenviamos — **construido**, y el disparador es este

Tienen razón en que no lo pueden derivar: los pagos en efectivo del mostrador son
la mayoría y no pasan por ustedes.

**El disparador es un barrido cada minuto.** Cada resumen cerrado guarda cuándo
cambió y cuándo se sincronizó por última vez; el que cambió después de
sincronizarse se vuelve a mandar. No es "al imputar" porque un envío atado a la
transacción del pago la haría depender de la red de ustedes, y un problema
de red no puede dejar a un cajero sin poder cobrar.

**Cuán viejo puede estar el número: hasta un minuto en el caso normal.** Si
ClubPay está caído, hasta que vuelva —se reintenta solo, no se abandona—. El
"actualizado hace X" que muestran es la lectura correcta.

Probado de punta a punta:

```
resumen nexopos-per-3  total 5000000  pagado 0          ← al cerrar
   ... el cliente paga $20.000 en el mostrador ...
resumen nexopos-per-3  total 5000000  pagado 2000000    ← reenvío, 1 min después
```

### Los tiempos — de acuerdo con el orden que proponen

Su tabla nos sirve tal cual, y el dato de que el validador descarta campos
desconocidos ya lo estamos usando: **el `statement_id` viaja desde ahora**.

Lo anotamos para NexoTienda, que es a quien le importa: **la app de ClubPay no va
a mostrar la pila de resúmenes hasta la próxima versión de tienda**, y no hay
fecha en iOS. NexoTienda cobra con importe libre mientras tanto, que ya funciona.

### Fechas — de acuerdo

`period_start`, `period_end` y `due_date` viajan como `YYYY-MM-DD`, calculadas en
`America/Argentina/Cordoba` escrito y no heredado del servidor. `label` se manda
armado y se muestra tal cual.

---

## El `account_id`: tienen razón, y el argumento es mejor que el nuestro

Aceptado sin objeciones. **No habíamos visto el agujero que abre un id por
persona**: dos comercios pueden cruzar sus listas y descubrir que `prs_9f3a` es el
mismo cliente en los dos. Hoy no pueden, y nada en el diseño pedía habilitarlo.

Renombramos la columna a `clubpay_account_id` para que diga lo que guarda.

Y tienen razón en la otra mitad: lo que nos faltaba no era un identificador, era
**una ruta de solo lectura**. Ya la estamos usando: `GET /pos/customers/CLI-42`.
**El DNI dejó de viajar en cada consulta**; ahora sale una sola vez, cuando se
propone la vinculación.

Sobre el token de un solo uso para el salto a NexoTienda: nos cierra, y el
argumento de que un id permanente en una URL es una credencial que no vence es
correcto. **Especifíquenlo aparte cuando puedan** — no nos bloquea todavía,
porque NexoTienda no está construida de nuestro lado.

---

## El webhook de vinculación: acá está la URL

```
https://nexopos.app/api/clubpay/webhook/vinculacion
```

Es el valor de `NEXOPOS_LINK_WEBHOOK_URL`. **Ya está andando**, con la clave del
comercio en `X-API-Key`, igual que el de pago.

Probado con lo que mandan:

- `{"external_id":"CLI-42","status":"vinculada","account_id":"acc_..."}` → guarda
  el estado y el id, y **recupera los movimientos** que habían quedado sin avisar
  mientras la persona no había aceptado.
- `{"external_id":"CLI-42","status":"rechazada"}` → guarda el estado. Sin
  `account_id`, como definieron.
- Clave equivocada → `401`. Cliente de otro comercio → `404`.

**Y gracias por agregar el rechazo.** Lo habíamos pedido a medias y tienen razón
en que es el aviso que más le sirve al almacenero: casi siempre significa que se
tipeó un dígito de más. Lo estamos guardando y va a la ficha del cliente.

---

## Sus dos preguntas

### ¿Una URL para toda la plataforma alcanza?

**Sí, y no está previsto que cambie.** NexoPOS es **una sola instancia
multi-tenant**: los comercios son filas con `commerce_id`, no despliegues. No hay
instancias por comercio ni nada on-premise en los planes.

Si alguna vez eso cambiara se lo avisamos antes, no después. Pero por diseño el
aislamiento acá es por fila, y moverlo sería rehacer el producto.

### ¿Se reasigna un número de cliente?

**No, nunca.** `customers.id` es un `BIGSERIAL` de Postgres: no se reusa ni
después de un borrado. Y además **no hay borrado de clientes en NexoPOS** —lo
verificamos, no existe ningún `DELETE FROM customers` en el código—, entre otras
cosas porque una ficha con movimientos de cuenta corriente es historia contable.

O sea que `CLI-42` es esa persona en ese comercio para siempre. Con el `409` que
van a poner alcanza y sobra; no va a dispararse nunca por reasignación.

Lo que sí puede pasar, y lo dejamos anotado: **corregir el DNI de un cliente**. Es
una función nueva de acá, porque en el mostrador se tipea mal y antes ese error
quedaba para siempre. Cuando el DNI cambia, borramos el estado de vinculación y
proponemos de nuevo con el documento corregido —el anterior era de otra persona y
no dice nada de esta—. Del lado de ustedes eso llega como una propuesta nueva
sobre el mismo `external_id`. Si eso choca con algo, díganlo.

---

## Lo que queda abierto

- **La anulación de un descuento aplicado.** Sin fecha de su lado. Nosotros
  seguimos revirtiendo local y dejando el `transaction_id` en el log.
- **El token de salto a NexoTienda**, cuando lo especifiquen.
- **El push de la propuesta**, que es de la app y sale con la próxima versión.
  Anotamos el límite que pusieron —ClubPay no reclama deudas— y nos parece bien:
  es lo mismo que dice el acuerdo de nuestro lado.

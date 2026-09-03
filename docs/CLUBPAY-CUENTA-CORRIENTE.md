# Cuenta corriente del cliente en la app de ClubPay

Contrato acordado entre NexoPOS y ClubPay. La discusión que llegó hasta acá está
en `CLUBPAY-CUENTA-CORRIENTE-RESPUESTA.md`; esto es lo que quedó.

El objetivo: que el cliente de un almacén vea en su teléfono lo que hoy está en
un cuaderno —cuánto lleva, qué pagó— y pueda saldarlo con Mercado Pago, directo
a la cuenta del comercio. El comprador final no instala otra app: su identidad y
su medio de pago ya viven en ClubPay.

## Lo que quedó afuera, y por qué importa

**No hay períodos ni resúmenes.** NexoPOS lleva saldo corriente: el almacenero
cobra cuando el cliente pasa, no el día 10. No existe `/account/statements`, no
viaja ningún `period` y el pago no se imputa a nada —es un importe libre contra
el saldo—. Si algún día hacen falta cierres, es una funcionalidad nueva del POS
con su propia pantalla en el mostrador, no un campo que se agrega acá.

**No hay límite de fiado ni pausa de crédito.** No existen en NexoPOS, así que la
app no los muestra. Si se construyen, el criterio ya está acordado: se muestra
«Disponible: $18.000», nunca «Tu límite es $20.000». Es el mismo número, pero un
límite asignado es una calificación, y en un pueblo donde uno se entera de que
tiene 20 y su primo 80 eso trae un problema que no hace falta.

**ClubPay no cobra ni reclama.** La app notifica hechos; a quién se le cobra y
cuándo lo decide el comercio. No manda recordatorios de deuda ni avisos de mora.

## Autenticación

Todo va con la **clave del comercio** (`X-API-Key`), la misma que ya se usa para
los descuentos. No con una clave de plataforma: estas son operaciones de un
comercio sobre sus propios clientes, así que si la clave se filtra el alcance del
daño es ese comercio y no el ecosistema entero.

## Vinculación

```
POST /pos/customers
{ "dni": "26098535", "external_id": "CLI-42" }

→ { "encontrado": true, "status": "propuesta", "persona": "Germán Yovan" }
```

`status` es uno de `sin_cuenta | propuesta | aceptada | rechazada`.

Nace como propuesta y no como vínculo hecho porque en el mostrador se tipean DNI
mal, y un dígito de más hace que el match caiga en otra persona que abre la app y
ve la deuda de un desconocido. Hasta que confirma, ClubPay no le muestra nada.

Que el DNI no esté en ClubPay **no es un error**: la mayoría de los clientes de
un almacén no tienen la app y la cuenta corriente anda igual.

Es idempotente y no pisa una vinculación aceptada. El POS lo llama al dar de alta
un cliente con DNI, y de nuevo desde la ficha cuando el almacenero quiere saber
en qué quedó —que es la única forma de enterarse, porque ClubPay no avisa cuando
la persona acepta.

## Movimientos

```
POST /pos/account/movements
{
  "external_id":  "CLI-42",
  "movement_id":  "nexopos-mov-8891",
  "kind":         "compra" | "pago" | "ajuste" | "devolucion",
  "amount_cents": 1240000,
  "occurred_at":  "2026-09-03T18:22:00Z",
  "description":  "Ticket #1"
}
```

**El signo va en `amount_cents`**: positivo aumenta la deuda, negativo la baja.
No en el `kind`, porque un ajuste que sube y uno que baja son el mismo hecho —una
corrección— y separarlos serían dos tipos que significan lo mismo.

Idempotente por `movement_id`, que deriva del id del movimiento en NexoPOS.

**Solo se empujan movimientos de clientes que aceptaron la vinculación.** Hasta
que la persona confirma, lo único que ClubPay tiene de ella es el DNI con el que
se le propuso. La consecuencia, aceptada: ve su cuenta desde que acepta en
adelante, no hacia atrás.

Pueden llegar **fuera de orden**: se ordenan por `occurred_at`, nunca por orden
de llegada. Y la pantalla dice desde cuándo son los datos, porque el retraso no
es hipotético —ver abajo.

## Pago desde la app

Lo procesa ClubPay contra la cuenta de Mercado Pago del comercio. La plata va
directo de la persona al comercio; no pasa por ninguna cuenta de Nexo ni de
ClubPay. Después nos avisa:

```
POST https://nexopos.app/api/clubpay/webhook/pago
X-API-Key: <clave del comercio>

{
  "external_id":        "CLI-42",
  "amount_cents":       2000000,
  "paid_at":            "2026-09-05T14:03:00Z",
  "clubpay_payment_id": "pay_..."
}

→ { "ok": true, "duplicado": false, "balance": 5000 }
```

**Importe libre**: el fiado de pueblo funciona con flexibilidad, y si solo
aceptáramos el pago total la app sería peor que el cuaderno. No hay
`statement_id` porque no hay resúmenes.

**Idempotente por `clubpay_payment_id`**, garantizado por un índice único y no
por una consulta previa: dos reintentos simultáneos no pueden descontar dos
veces. Un pago repetido devuelve `duplicado: true` y el saldo sin tocar.

**Sobre la autenticación del webhook, que quedó abierta de su lado**: lo
resolvimos con la misma clave del comercio en `X-API-Key`. Es un secreto que las
dos partes ya comparten, así que no agrega exposición nueva, y mantiene la
propiedad que buscábamos —el alcance del daño es un comercio—. Además el cliente
tiene que pertenecer a ese comercio: la clave de uno no toca la cuenta de otro.
**Confírmennos que les sirve.**

Sin Mercado Pago conectado no se rompe nada: la persona ve su cuenta igual y
donde iría el botón de pagar dice «arreglá con el comercio».

## Cómo se entrega, del lado de NexoPOS

El aviso a ClubPay **no puede hacer fallar una venta** —un problema de red no
puede dejar a un cajero sin poder cobrar— pero **tampoco puede perderse**, o la
app le muestra al cliente un saldo que no es.

Las dos cosas son ciertas a la vez por una cola: la fila se escribe en la misma
transacción que el movimiento, así que si la venta quedó guardada el aviso
existe, y la llamada por red pasa después, afuera, donde puede fallar sin
arrastrar nada.

Reintentos a 1 min, 5, 15, 1 h y después cada 6 h. A los 12 intentos —casi dos
días— se abandona y queda registrado: si en dos días no entró, no es un corte de
red y seguir golpeando no lo arregla.

Un pago que llegó por el webhook **no se le devuelve a ClubPay**: lo originaron
ellos.

## En el arqueo del comercio

Un pago hecho desde la app a las once de la noche no es efectivo en el cajón.
Entra con forma de pago `clubpay`: aparece en el cierre del día como cobro de
cuenta corriente, para que el comercio lo vea, pero **no suma al efectivo
esperado**. Si entra con la caja cerrada queda sin sesión, y el saldo del cliente
se actualiza igual.

## Estado

Implementado y probado de punta a punta contra un simulador. Los endpoints de
ClubPay todavía no están arriba; cuando los publiquen se apunta
`CLUBPAY_API_URL` y sale por la red real, sin más cambios.

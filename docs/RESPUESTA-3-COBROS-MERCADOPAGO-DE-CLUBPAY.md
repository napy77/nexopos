# Respuesta a «CR-0002 · Ajustes 1 y 2 hechos»

**Para el equipo de NexoPOS.** De ClubPay, 11 de octubre de 2026.

Los dos ajustes están bien, y lo de cancelar los otros links cuando un pedido se
paga también.

## Un arreglo nuestro que los afectaba

Nuestro `POST /pos/payments/{id}/cancel` solo aceptaba cobros `pending`. A un
`rejected` o un `expired` le contestaba **409 «Ese cobro ya no está
pendiente»**. Con su ajuste 1 («si cancelar falla, no se cobra de otra forma»),
el cajero quedaba trabado justo después de un rechazo.

Desde el despliegue de hoy:

| Estado del cobro | `/cancel` contesta |
|---|---|
| `pending`, `rejected`, `expired` | **200**, el cobro en `cancelled` |
| `cancelled` | 200, igual que antes |
| `paid`, `refunded` | 409 con el cobro, igual que antes |

Si en su simulador `/cancel` de un `rejected` o `expired` devolvía 409, cámbienlo
a esto.

## Otro cambio chico, del 10/10

Cancelar un cobro de mostrador ya no da de baja el QR de la caja si hay un cobro
de mostrador más nuevo del mismo comercio: con una sola caja, ese QR es el del
cobro nuevo. El viejo vence solo a los 5 minutos; si igual lo pagan, el pago
gana y ustedes lo devuelven, como ya hacen.

## Prueba real

Sin cambios: German prepara el comercio y coordina el horario.

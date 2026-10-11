# Cobrar con Mercado Pago en la tienda

**Para el equipo de NexoTienda.** De NexoPOS, 11 de octubre de 2026.

## En una línea

La tienda puede cobrar con Mercado Pago **sin que ustedes integren Mercado
Pago**. Le piden a NexoPOS un link de pago, mandan al comprador ahí, y NexoPOS
les dice cuándo se acreditó. Credenciales, tokens y avisos de Mercado Pago no
pasan por ustedes.

De dónde sale, por si alguien pregunta: el comercio conecta su Mercado Pago una
sola vez, en ClubPay, y NexoPOS cobra a través de ese vínculo. **Para ustedes es
transparente**: no hablan con ClubPay ni necesitan saber que está en el medio.

**Nuestro lado está en producción en `nexopos.app`.** Lo que sigue es lo que
tienen que construir ustedes.

---

## 1. ¿Esta tienda cobra con Mercado Pago?

El `Store` (`GET /v1/stores/:slug`) trae un campo nuevo:

```ts
acceptsMercadoPago: boolean
```

Muestren "Pagar con Mercado Pago" en el checkout **sólo con `true`**.

**No usen `acceptsOnlinePayment` para esto.** Ese campo es de antes y da `true`
también con contra entrega o transferencia: no dice si se puede cobrar online.
Queda como está para no romperles nada.

`acceptsMercadoPago` es `true` sólo si el comercio conectó Mercado Pago, lo
autorizó para NexoPOS y NexoTienda, y lo prendió para su tienda. Si cualquiera
de las tres cosas se apaga, pasa a `false` solo.

## 2. Crear el pedido

Como hoy, con el valor que ya existe:

```
POST /v1/orders
{ …, "paymentMethod": "online" }
```

`online` significa **Mercado Pago**. Si la tienda no lo acepta, el pedido se
rechaza con **409** y un mensaje para el comprador:

> Este comercio no está cobrando con Mercado Pago por ahora. Elegí otra forma de pago.

El pedido nace con `paymentStatus: "pendiente"`.

## 3. Pedir el link de pago

```
POST /v1/orders/:code/checkout
Authorization: Bearer <clave de pedidos>

{ "returnUrl": "https://jure.nexotienda.app/pedido/P-8K2M4QXA" }
```

Respuesta **201**:

```json
{
  "checkoutUrl": "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=…",
  "expiresAt": "2026-10-11T15:05:00Z"
}
```

- Redirijan al comprador a `checkoutUrl`. Mercado Pago lo devuelve a
  `returnUrl` cuando termina, pague o no. Tiene que ser una URL completa.
- **El importe no viaja**: lo pone NexoPOS del total del pedido. Si viajara, se
  podría pagar menos de lo que se compró.
- **Se puede pedir de nuevo** (rechazó la tarjeta, venció a los 30 minutos).
  Cada pedido nuevo **da de baja el link anterior**: hay un solo link vivo por
  pedido. No guarden links viejos para reusarlos.

| Respuesta | Significa |
|---|---|
| 201 | El link nuevo |
| 409 «Este pedido ya está pagado.» | Ya se pagó, a veces con un link anterior que el comprador tenía abierto. Muestren el pedido. |
| 409 otros | El pedido no es `online`, está cancelado, o el comercio dejó de cobrar con Mercado Pago. Muestren el mensaje. |
| 502 | No pudimos dar de baja el link anterior. Que el comprador reintente en un momento. |

## 4. Cuando el comprador vuelve

**Lo que trae la URL de vuelta no es prueba de pago.** Mercado Pago agrega
parámetros (`status=approved` y otros) que cualquiera puede escribir a mano. No
los usen para decidir nada.

Consulten el pedido:

```
GET /v1/orders/:code   →  paymentStatus, paymentError
```

| `paymentStatus` | Qué mostrar |
|---|---|
| `pagado` | «¡Listo! Recibimos tu pago.» |
| `pendiente` | «Estamos confirmando tu pago…» y vuelvan a consultar cada 2–3 s durante un minuto: Mercado Pago a veces tarda unos segundos. |
| `rechazado` | `paymentError` tal cual, y un botón «Intentar de nuevo» que vuelve al punto 3. |
| `reembolsado` | «Te devolvimos el pago.» |

`paymentError` es nuevo en el `Order`: el motivo del rechazo, en castellano y
escrito para el comprador. Muéstrenlo tal cual.

## 5. Avisos

Al webhook de pedidos se suman tres eventos:

| `event` | Cuándo |
|---|---|
| `order.pagado` | Mercado Pago acreditó el pago |
| `order.pago_rechazado` | Mercado Pago lo rechazó. Trae `paymentError` |
| `order.reembolsado` | Se devolvió el pago sin cancelar el pedido: el comercio reembolsó la venta después de entregarla |

Cuando el comercio **cancela** un pedido pagado, la devolución sale en el mismo
momento y llega **un solo aviso**, `order.cancelado`, con
`paymentStatus: "reembolsado"` adentro.

Mismas reglas de siempre: viaja el `Order` entero, `event_id` para descartar
repetidos, y pueden llegar fuera de orden (confíen en el `paymentStatus` que
viene adentro).

## 6. Un cambio en lo que ya existe

**`POST /v1/orders/:code/payment` contesta 409 para pedidos `online`.** Ese
endpoint deja que quien llama diga «esto se pagó». Con Mercado Pago quien
confirma es Mercado Pago: si la tienda pudiera marcarlo, un error de su lado, o
alguien con su clave, dejaría pedidos pagados que nadie pagó. Si lo estaban
llamando, avísennos.

## 7. Cosas que resolvemos nosotros

Para que no las tengan que programar:

- **Si el comprador paga dos links del mismo pedido**, el pedido queda pagado
  una vez y el segundo pago se devuelve solo.
- **Si paga un pedido ya cancelado**, se devuelve solo.
- **Si el comercio cancela o reembolsa**, la plata vuelve por Mercado Pago al
  mismo que pagó.

---

## Cómo probarlo

Hoy ningún comercio real tiene Mercado Pago prendido: antes de abrirlo, ClubPay
hace una prueba con plata real. Mientras tanto se prueba con el **simulador**:

- Corre en un NexoPOS **sin `CLUBPAY_API_URL` y con `MERCADOPAGO_SIMULADOR=on`**.
  En `nexopos.app` no está, porque ahí se habla con ClubPay de verdad.
- El `checkoutUrl` lleva a una página nuestra con «Pagar» y «Rechazar la
  tarjeta», que después vuelve a su `returnUrl`. Así se prueban los dos caminos
  y el reintento.

Pueden levantar un NexoPOS local con esas dos variables, o pedirnos uno de
prueba.

## Qué tienen que hacer ustedes

1. Mostrar Mercado Pago en el checkout cuando `acceptsMercadoPago` sea `true`.
2. Crear el pedido con `paymentMethod: "online"` y pedir `/checkout`.
3. Redirigir, y al volver consultar `GET /v1/orders/:code`, nunca la URL.
4. Manejar los estados nuevos (`rechazado` con `paymentError`, `reembolsado`) y
   los tres eventos nuevos.
5. Dejar de llamar a `/payment` para pedidos `online`, si lo hacían.

Cuando lo tengan, avísennos y lo probamos juntos contra el simulador. La primera
venta real de tienda la hacemos con ClubPay, con plata de verdad.

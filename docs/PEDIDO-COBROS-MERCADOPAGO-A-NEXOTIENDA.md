# Cobro con Mercado Pago en la tienda

**Para el equipo de NexoTienda.** De NexoPOS, octubre de 2026.

## En una línea

La tienda va a poder cobrar con Mercado Pago **sin que ustedes integren Mercado
Pago**. Le piden a NexoPOS un link de pago, mandan al comprador ahí y NexoPOS
les avisa cuando se acreditó. Credenciales, tokens y avisos de Mercado Pago no
pasan por ustedes.

Por si alguien pregunta de dónde sale: el comercio conecta su Mercado Pago una
sola vez, en ClubPay, y NexoPOS cobra a través de ese vínculo. **Para ustedes es
transparente**: no hablan con ClubPay ni necesitan saber que está en el medio.

---

## 1. Saber si la tienda puede cobrar con Mercado Pago

El `Store` (`GET /v1/stores/:id`) suma un campo:

```ts
acceptsMercadoPago: boolean
```

Mostrar "Pagar con Mercado Pago" en el checkout **sólo con `true`**.

**No usen `acceptsOnlinePayment` para esto.** Ese campo existe desde antes y hoy
da `true` también con contra entrega o transferencia; no dice si se puede cobrar
online. Queda como está para no romper nada.

`acceptsMercadoPago` es `true` cuando se dan las tres cosas: el comercio tiene
Mercado Pago conectado, autorizó cobrar desde NexoPOS/NexoTienda, y lo prendió
para la tienda en su Configuración. Si cualquiera de las tres se apaga, pasa a
`false` sin que ustedes hagan nada.

## 2. Crear el pedido

Igual que hoy, con el valor que ya existe:

```
POST /v1/orders
{ …, "paymentMethod": "online" }
```

`online` pasa a significar **Mercado Pago**. Si la tienda no lo acepta
(`acceptsMercadoPago: false`) el pedido se rechaza con 409 y un mensaje para el
comprador. Hasta hoy un pedido `online` entraba aunque nadie pudiera cobrarlo y
quedaba en `pendiente` para siempre; eso se termina.

El pedido nace con `paymentStatus: "pendiente"`.

## 3. Pedir el link de pago

```
POST /v1/orders/:code/checkout
{ "returnUrl": "https://jure.nexotienda.app/pedido/P-8K2M4QXA" }
```

```json
{
  "checkoutUrl": "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=…",
  "expiresAt": "2026-10-09T15:05:00Z"
}
```

- Redirijan al comprador a `checkoutUrl`.
- Mercado Pago lo devuelve a `returnUrl` cuando termina, pague o no.
- **El importe lo pone NexoPOS**, del total del pedido. No viaja en este pedido
  a propósito: si viajara, se podría pagar menos de lo que se compró.
- Es **reintentable**: si el pago se rechazó o el link venció (30 minutos),
  vuelven a llamar y sale uno nuevo. Si el pedido ya está pagado, contesta 409.
- Separado de `POST /v1/orders` para eso mismo: crear el pedido y cobrarlo son
  dos cosas, y el comprador puede necesitar intentar pagar más de una vez.

## 4. Cuando el comprador vuelve

**Lo que trae la URL de vuelta no es prueba de pago.** Mercado Pago agrega
parámetros (`status=approved`, etc.) que cualquiera puede escribir a mano. No
los usen para decidir nada.

Lo que hagan es mirar el pedido:

```
GET /v1/orders/:code   →  paymentStatus
```

| `paymentStatus` | Mostrar |
|---|---|
| `pagado` | "¡Listo! Pago recibido." |
| `pendiente` | "Estamos confirmando tu pago…" y volver a consultar cada 2–3 s durante un minuto. Mercado Pago a veces tarda unos segundos en avisar. |
| `rechazado` | El motivo (`paymentError`) y el botón "Intentar de nuevo" → punto 3. |
| `reembolsado` | "Te devolvimos el pago." |

`reembolsado` es nuevo: aparece cuando el comercio cancela un pedido ya pagado
(la devolución sale sola, por Mercado Pago, al mismo que pagó).

`paymentError` es nuevo en el `Order`: el motivo del rechazo en castellano,
escrito para el comprador. Muéstrenlo tal cual.

## 5. Avisos

Al webhook de pedidos que ya reciben se suman:

| `event` | Cuándo |
|---|---|
| `order.pagado` | Mercado Pago acreditó el pago |
| `order.pago_rechazado` | Mercado Pago lo rechazó. Trae `paymentError` |
| `order.reembolsado` | Se devolvió el pago |

Mismas reglas de siempre: viaja el `Order` entero, `event_id` para descartar
repetidos, pueden llegar fuera de orden (confíen en el `paymentStatus` que
viene adentro).

## 6. Un cambio en lo que ya existe

**`POST /v1/orders/:code/payment` no sirve para pedidos con Mercado Pago.**
Ese endpoint deja que quien llama diga "esto se pagó". Con Mercado Pago, quien
confirma es Mercado Pago, no la tienda; si ustedes pudieran marcarlo, un error
de su lado —o alguien que use su clave— dejaría pedidos pagados que nadie pagó.
Para pedidos `online` va a contestar 409. Si lo están llamando hoy, avísennos.

---

## Qué tienen que hacer ustedes

1. Mostrar Mercado Pago en el checkout cuando `acceptsMercadoPago` sea `true`.
2. Crear el pedido con `paymentMethod: "online"` y pedir `/checkout`.
3. Redirigir, y al volver consultar `GET /v1/orders/:code` (nunca la URL).
4. Manejar los tres eventos nuevos y los dos estados nuevos (`rechazado` con
   motivo, `reembolsado`).

## Cuándo

NexoPOS construye su lado ahora, contra un simulador con el mismo contrato:
pueden integrarlo y probarlo de punta a punta antes de que haya Mercado Pago de
verdad del otro lado. Les avisamos cuándo está publicado en `nexopos.app`; con
el simulador, el link de pago lleva a una página nuestra que aprueba o rechaza
a elección, para que puedan probar los dos caminos.

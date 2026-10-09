# Respuesta: cobrar con Mercado Pago desde NexoPOS y NexoTienda

**Para el equipo de NexoPOS.** De ClubPay, 9 de octubre de 2026.
Responde a `docs/PEDIDO-COBROS-MERCADOPAGO-A-CLUBPAY.md` de su repositorio.

Está hecho como lo pidieron, con los mismos nombres de rutas y campos. Lo que
difiere o se agrega está marcado **Agregado** o **Distinto**: si su simulador
hace otra cosa en esos puntos, ajústenlo a esto.

## Las preguntas

**1. La comisión.** Va aparte de la de los clubes, como planteaban: es
cualquier cliente del almacén pagando, no una venta que trajo ClubPay. Se
configura en ClubPay (Configuración general › Comisiones de comercios) con la
misma forma que las otras: porcentaje + fijo, con mínimo y máximo. **Hoy está en
cero.** Sea cual sea, viene en `fee_cents` en cada respuesta y en cada aviso, y
es exactamente el `marketplace_fee` que Mercado Pago retiene en la operación:
el arqueo cuadra con lo que el comercio ve en su cuenta. La comisión de un cobro
queda fija al crearlo: si después cambia la regla, el cobro ya creado no cambia.

**2. El interruptor.** De acuerdo, y está hecho: «Cobrar también desde NexoPOS y
NexoTienda» en ClubPay › Cobros, apagado por defecto. Apagado, `POST
/pos/payments` y las devoluciones contestan 403 con el mensaje que propusieron.
Consultar un cobro que ya existe sigue andando aunque lo apaguen después.

**3. El permiso OAuth.** No lo podemos confirmar sin una prueba real: desde el
entorno donde se programó esto no hay salida a Mercado Pago, así que se probó
contra un simulador. La primera venta de mostrador con un comercio real es la
que lo confirma. Si Mercado Pago rechaza crear la sucursal o la caja, el error
queda a la vista del comercio en ClubPay › Cobros y en la respuesta a ustedes.

**4. La fecha.** Los endpoints 0 a 5 están programados y probados contra base
de verdad el 09/10. Quedan en producción con el próximo despliegue de ClubPay;
les avisamos ese día. Antes de abrirlo a comercios hacemos una venta real de
mostrador y una de tienda, con plata real y su devolución.

## Lo que tienen que saber antes de integrar

### El QR del mostrador necesita la dirección del local (**Agregado**)

Para crear la sucursal, Mercado Pago pide una dirección con su ubicación en el
mapa. En ClubPay no la teníamos estructurada, así que el comercio la carga una
vez en ClubPay › Cobros (calle, número, localidad, provincia y la ubicación, que
se pega desde Google Maps). Con el primer cobro de mostrador creamos la sucursal
`CLUBPAY<id>` y la caja `CLUBPAY<id>CAJA1` en su cuenta. La tienda no la
necesita.

Sin la dirección, un cobro `mostrador` contesta **409**: «Para cobrar con QR en
el mostrador falta cargar la dirección del local en ClubPay › Cobros.» Para que
no tengan que descubrirlo cobrando, `/status` trae un campo más:

```json
{ "mercadopago": "connected", "enabled_for_pos": true, "mostrador_listo": true }
```

`mostrador_listo: false` → muestren Mercado Pago solo en la tienda, o el aviso
de que falta la dirección.

### Crear (**Distinto**: la respuesta es el cobro entero)

`POST /pos/payments` contesta el cobro entero, igual que el GET: los cinco campos
que pidieron más `external_reference`, `channel`, `amount_cents`, `fee_cents`,
`refunded_cents`, `paid_at`, `mp_payment_id` y `error`.

- **201** si lo creó, **200** si ya existía (el reintento por corte de red).
- El mismo `external_reference` con **otro importe u otro canal** → **409**
  con el cobro que ya existe. No pisamos uno con otro.
- `description` va al título que ve el cliente en Mercado Pago (hasta 200).
- `return_url` tiene que ser una URL completa. Con ella, Mercado Pago vuelve ahí
  al aprobar, al quedar pendiente y al fallar.
- Vencen a los 5 minutos (mostrador) y 30 (tienda).

### Los estados (**Distinto** en tres casos)

Como en su tabla, con tres precisiones que vienen de no perder pagos:

1. **`rejected` no es final.** Con el mismo QR o el mismo link el cliente puede
   probar otra tarjeta; si después se aprueba, pasa a `paid`. Si ofrecen otro
   medio, cancelen el cobro primero.
2. **Un `cancelled` o un `expired` puede pasar a `paid`.** Al cancelar damos de
   baja el QR y vencemos el link, pero si el cliente ya estaba pagando y Mercado
   Pago lo aprueba igual, el pago gana y les llega el aviso `paid`. Ese caso lo
   tienen que poder recibir: cerrar la venta o devolverlo. Es raro, pero es
   plata del cliente.
3. **`refunded` es devuelto total o parcial**, como dijeron: miren
   `refunded_cents`.

`paid` es solamente acreditado por Mercado Pago; `in_process` sigue `pending`.
Consultamos a Mercado Pago como mucho cada 4 segundos por cobro, así que
consulten cada 2 sin problema: entre medio contestamos lo último que sabemos.

### Cancelar

Como pidieron: antes de cancelar le preguntamos a Mercado Pago, y si se pagó
contestamos **409 con el cobro en `paid`**. Cancelar uno ya cancelado devuelve
200 con el cobro.

### Devolver

Como pidieron: `amount_cents` opcional (sin él, el resto que falta devolver),
idempotente por `external_reference`, siempre al que pagó.

- Más de lo que falta devolver → **409** «Se pueden devolver hasta $X».
- Un cobro que no está pagado → **409** «Solo se puede devolver un cobro pagado».
- Responde el cobro actualizado.

### El aviso

`POST https://nexopos.app/api/clubpay/webhook/cobro`, con la `X-API-Key` del
comercio y el cobro entero (lo mismo que el GET).

- Cada vez que cambian `status` o `refunded_cents`. **El `pending` del alta no
  se avisa**: ya lo tienen en la respuesta del POST.
- Si no contestan 2xx, reintentamos cada minuto durante 7 días (hasta 50
  veces). Siempre mandamos el estado de ese momento, no el que falló.
- **Dos avisos pueden llegar desordenados.** Quédense con el que tenga el estado
  más avanzado, o consulten el GET.

### Errores

En `error` **y** en `message` va el mismo texto, en castellano. Con los tres
mensajes que sugirieron, más el de la dirección y los de las devoluciones.
Cuando un error es sobre un cobro que existe (los 409), viene el cobro entero
al lado del mensaje.

| Caso | Código |
|---|---|
| Datos mal formados | 400 |
| Clave `pos_…` inválida | 401 |
| Interruptor apagado | 403 |
| Cobro de otro comercio o inexistente | 404 |
| Sin Mercado Pago, token vencido, falta la dirección, conflicto de referencia, cancelar pagado, devolución imposible | 409 |
| Mercado Pago no contestó o rechazó la operación | 502 |

Un token revocado lo confirmamos contra Mercado Pago y desde ahí `/status` dice
`expired` hasta que el comercio reconecta.

## Lo de un solo QR

Anotado para después, como proponen. Cuando lo de arriba esté andando en la
calle lo hablamos.

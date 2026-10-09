# CR-0002 · Cobros con Mercado Pago: NexoPOS integrado

**Para el equipo de ClubPay.** De NexoPOS, 9 de octubre de 2026.
Responde a `respuesta-pedido-cobros-mercadopago.md`.

## Estado

Nuestro lado está construido, para mostrador y tienda, y probado de punta a
punta contra un simulador que sigue su respuesta en los puntos **Distinto** y
**Agregado**. Listo para la prueba real.

## Cómo tomamos cada punto de su respuesta

| Lo que dijeron | Lo que hace NexoPOS |
|---|---|
| `/status` trae `mostrador_listo` | Sin dirección, Mercado Pago aparece **apagado** en el mostrador con su mensaje («falta cargar la dirección del local en ClubPay › Cobros»). La tienda sigue disponible. |
| `POST` devuelve el cobro entero, 201 / 200, 409 si cambia importe o canal | La referencia se mantiene mientras el ticket no cambie: un doble toque devuelve el mismo cobro. Si el ticket cambió, es una referencia nueva. |
| `rejected` no es final | El QR sigue en pantalla con el motivo; el cliente puede probar otro medio. En la tienda, el pedido vuelve a `pendiente` si pide otro link. |
| `cancelled` / `expired` pueden pasar a `paid` | Si lo cancelamos nosotros y se paga igual, y no quedó en ninguna venta, **lo devolvemos solos**. En la tienda, un pago de un pedido cancelado o ya pagado por otro link también se devuelve. |
| Cancelar uno pagado → 409 con el cobro en `paid` | El mostrador no cierra: emite la venta con ese pago. |
| Los avisos llegan desordenados | Del aviso sólo usamos `payment_id` y **releemos el GET**. Si el GET falla, usamos el aviso pero nunca retrocedemos un `paid`. |
| Devolver, idempotente por referencia | Referencias fijas por venta, por pedido y por cobro: un reintento no devuelve dos veces. |
| `fee_cents` | Se guarda en cada cobro y en la forma de pago de la venta, para el arqueo. |

Respondemos 2xx a avisos de cobros que no son nuestros, para que no los
reintenten siete días.

## La prueba real

De acuerdo con hacerla antes de abrirlo. Lo que necesitamos de ustedes:

1. Avisarnos cuando el despliegue con los endpoints esté en producción.
2. Un comercio de prueba con Mercado Pago conectado, el interruptor prendido y
   la dirección cargada. La primera venta de mostrador es la que crea la
   sucursal y la caja.

Hacemos juntos, con plata real y un importe chico:

- una venta de mostrador → pago con QR → reembolso del ticket;
- un pedido de tienda → pago con link → cancelación del pedido (devolución);
- un QR cancelado y pagado igual, para ver la devolución automática.

## La comisión

Sigue en cero. La define German con ustedes.

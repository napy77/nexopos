# CR-0003 — Respuesta de NexoPOS a NexoTienda: «lo que falta»

> De NexoPOS a NexoTienda (vía nexo-ecosystem), 13 de octubre de 2026.
> Responde a `docs/a-nexopos/cr-0003-lo-que-falta.md`.

## En una línea

Hicimos sus puntos **2 (la mitad) y 3**, que no dependían de nadie. Están en GitHub y **sin deployar todavía**; les
avisamos cuando estén en producción. El **1** y el resto del **2** (reglas, `orderRules`, rechazos) esperan que German
decida cómo se precargan los topes. El **4** (`review`) va después. El **5** (`creditEnabled`) ya está en producción.

## Hecho

### Punto 3 — el canje de cuentas nacidas en la tienda

`POST /v1/cuentas/canjear` ya no falla cuando ClubPay manda la cuenta sin número. En el primer canje se crea la ficha
**sin libreta**, se le asigna su `CLI-<n>` en ClubPay y se contesta como siempre:
`{ accountId: "CLI-<n>", storeId, displayName, linkedAt }`. Las siguientes veces devuelve la misma ficha.

El `GET /v1/cuentas/:accountId` de esa persona da `creditEnabled: false` hasta que el comerciante le abra la libreta
desde la ficha.

### Punto 2, primera mitad — cuenta y contacto juntos

`accountId` y `contact` **ya se aceptan juntos, con cualquier forma de pago**, sin depender de que las reglas estén
prendidas. Les pedimos **no leer `orderRules.enabled` como señal de eso**: `enabled` sólo quiere decir «este comercio
pide identificarse», y lo vamos a querer prender y apagar sin pensar en el resto.

- `contact` (nombre y teléfono) sigue siendo obligatorio salvo a la libreta, como ustedes ya lo mandan.
- La cuenta tiene que ser de ese comercio con cualquier forma de pago: si no, 404.

## Una pregunta

Su documento dice que mandan el `accountId` «con efectivo o transferencia». En `POST /v1/orders` **no existe una forma
de pago transferencia**: son `efectivo_entrega`, `online` (Mercado Pago) y `cuenta_corriente`, y una distinta da 400.
¿Qué mandan hoy cuando el comprador elige transferencia? El circuito de comprobante de transferencia que acordamos
sigue sin empezar.

## Lo que sigue

1. Las reglas: la configuración por comercio, `orderRules` en `/v1/stores/:slug` y `/v1/hosts/:sub` con la forma que
   confirmaron, y los rechazos con su `code` y los datos extra. Escribimos el `error` para el comprador.
2. `review` en el pedido.

Para las pruebas juntos, como proponen, usamos un comercio de prueba. **El pedido de prueba `P-FC3B51C5` quedó en
Supermercado Delfín, que es un comercio real**: le sonó el aviso de pedido nuevo. Lo estamos avisando para que lo
cancele.

---

## Agregado, 13 de octubre: ya está en producción

Leímos `respuesta-cr-0003-transferencia-y-cuenta.md`. Lo de transferencia queda claro, gracias.

**El canje nuevo y cuenta + contacto juntos están en producción** (`33c587e`, desplegado el 13/10 a las 03:32 UTC).
Pueden **sacar el reintento sin `accountId`** que dejaron de transición. De acá en adelante, un 400 sin `code` a un
pedido con los dos sería un error de verdad y conviene que lo vean, no que lo esconda el reintento.

Sigue lo mismo: las reglas (esperan la decisión de German sobre los topes) y después `review`.

---

## Agregado, 13 de octubre: las reglas y `review` (sus puntos 1, 2 y 4)

Hecho y probado en local, **sin deployar todavía**; les avisamos cuando esté en producción.

**`orderRules`** en `GET /v1/stores/:slug` y en `GET /v1/hosts/:sub`, con la forma que confirmaron. Apagado va
`{ "enabled": false }`. Arranca apagado en todos los comercios: lo prende cada comerciante en Configuración → Tienda.
Los valores de ejemplo que aprobó German:

| Nivel | Paga al retirar | Paga al recibir | Hasta | Productos distintos |
|---|---|---|---|---|
| 0 | no | no | — | — |
| 1 | sí | sí, con 1 retiro previo | $40.000 | 15 |
| 2 | sí | sí | $80.000 | 30 |
| 3 | sí | sí | $160.000 | sin tope |

**Rechazos** con los `code` y los datos de su tabla. Un detalle: `nivel_insuficiente` puede venir **sin
`requiredLevel`** cuando ningún nivel permite pagar en mano en esa franja (el comerciante lo apagó para todos).

**Los `error` están escritos para el comprador** y se pueden mostrar tal cual. Ofrecen Mercado Pago como salida
**sólo si ese comercio lo cobra**; si no, no lo mencionan.

**`review: { reason }`** en `GET /v1/orders/:code` y en la respuesta del alta, **mientras el pedido está en
`recibido`**. Cuando el comerciante lo acepta deja de venir: ya lo miró.

Dos cosas que conviene que sepan:

- **Quien el comerciante dio de alta en el mostrador** (por ejemplo, con la libreta) cuenta como nivel 3 y no pasa por
  la revisión ni por el requisito de retiros: lo conoce en persona.
- **El bloqueo vale con cualquier forma de pago y con las reglas prendidas o apagadas**: es una decisión del
  comerciante sobre esa persona. El `code` es `cuenta_bloqueada`.

Para probarlo juntos: cuando ClubPay tenga la web de alta, prendemos las reglas en un comercio de prueba y les avisamos.

---

## Agregado, 13 de octubre: las reglas ya están en producción

`orderRules`, los rechazos con `code` y `review` están en producción (`ffa77ff`, desplegado el 13/10 a las 12:48
UTC). Con esto está todo lo que pidieron en `cr-0003-lo-que-falta.md`.

Hoy **todos los comercios tienen las reglas apagadas** (`{ "enabled": false }`), así que la tienda se sigue viendo
como siempre. Para probar juntos usamos un comercio de prueba, cuando ClubPay tenga la web de alta: les avisamos.

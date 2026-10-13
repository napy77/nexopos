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

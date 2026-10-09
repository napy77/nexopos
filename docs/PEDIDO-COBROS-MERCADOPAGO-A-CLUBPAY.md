# Cobrar con Mercado Pago usando la cuenta que el comercio ya conectó en ClubPay

**Para el equipo de ClubPay.** De NexoPOS, octubre de 2026.

## La idea

El comercio ya conectó su Mercado Pago en ClubPay, por OAuth, desde la pantalla
**Cobros**. Y ya tiene una clave `pos_…` que vincula ClubPay con NexoPOS.

Queremos usar ese mismo vínculo para cobrar con Mercado Pago **en el mostrador
de NexoPOS y en la tienda de NexoTienda**, sin que el comercio tenga que
conectar Mercado Pago dos veces más. Un solo "Conectar Mercado Pago", en
ClubPay, y anda en los tres lados.

Lo que no cambia y nos importa que siga así:

- **La plata va directo del cliente a la cuenta del comercio.** ClubPay no la
  recibe ni la retiene, igual que hoy.
- **Las credenciales de Mercado Pago no salen de ClubPay.** NexoPOS nunca las ve;
  le pide el cobro a ClubPay y ClubPay lo crea con el token del comercio.
- **NexoTienda no habla con ClubPay.** Le pide el cobro a NexoPOS, que es quien
  tiene la clave del comercio. Para ustedes, todo llega desde NexoPOS.

```
Mostrador:  NexoPOS ──POST /pos/payments──▶ ClubPay ──▶ Mercado Pago (QR)
Tienda:     NexoTienda ─▶ NexoPOS ──POST /pos/payments──▶ ClubPay ──▶ Mercado Pago (checkout)
Aviso:      Mercado Pago ─▶ ClubPay ──webhook──▶ NexoPOS ──webhook──▶ NexoTienda
```

---

## Antes de los endpoints: dos decisiones que no son técnicas

Las dejamos primero porque condicionan todo lo demás. Las cerramos con German.

### 1. La comisión

La pantalla de Cobros dice que ClubPay *retiene su comisión en la misma
operación*. Para los cobros desde la app tiene sentido. Pero un cobro del
mostrador de NexoPOS **no es una venta que trajo ClubPay**: es cualquier cliente
del almacén pagando su compra. Si lleva la misma comisión, el comercio paga a
ClubPay por todas sus ventas con Mercado Pago, sean o no de socios.

**¿Qué comisión aplica a los cobros que vienen de NexoPOS y NexoTienda?**
Sea cual sea, la necesitamos en la respuesta (`fee_cents`) para que el arqueo
de caja cuadre con lo que el comercio ve en Mercado Pago.

### 2. Lo que autorizó el comercio

Hoy la pantalla dice *"para que tus clientes te paguen desde la app"*. Cobrar
en el mostrador y en la tienda es otra cosa, y el comercio tiene que poder
decidirlo. Proponemos un interruptor en la misma pantalla de Cobros:

> **Cobrar también desde NexoPOS y NexoTienda**
> Tu punto de venta y tu tienda online van a poder generar cobros con tu
> Mercado Pago. La plata va directo a tu cuenta, igual que en la app.

Apagado por defecto. Con el interruptor apagado, `POST /pos/payments` contesta
403 con un mensaje que el comerciante entienda (ver más abajo).

Esto además resuelve el riesgo de la clave: hoy la `pos_…` sólo sirve para
descuentos; con el interruptor, sólo cobra si el comercio lo prendió.

---

## 0. Saber si el comercio puede cobrar

```
GET /pos/payments/status
X-API-Key: pos_...
```

```json
{
  "mercadopago": "connected",
  "enabled_for_pos": true
}
```

- `mercadopago`: `connected` | `disconnected` | `expired` (el token venció o el
  comercio lo revocó desde Mercado Pago y no se pudo renovar).
- `enabled_for_pos`: el interruptor de arriba.

NexoPOS lo consulta para mostrar u ocultar "Mercado Pago" en el mostrador y para
decirle a NexoTienda si la tienda puede ofrecerlo. Lo cacheamos unos minutos;
no se llama en cada venta.

## 1. Crear un cobro

```
POST /pos/payments
X-API-Key: pos_...
Content-Type: application/json

{
  "amount_cents": 9200000,
  "external_reference": "nexopos-7-venta-a81f3c",
  "channel": "mostrador",
  "description": "Jure Hnos · Ticket 0001-00004521",
  "return_url": null
}
```

- **`external_reference`** lo genera NexoPOS, es único por operación y hace
  **idempotente** el pedido, igual que en `/pos/charges`: si llega dos veces,
  devuelven el que ya existe. Sin esto, un corte de red justo después de crear
  el cobro termina en dos QR por la misma compra.
- **`channel`** decide qué devuelven:
  - `mostrador` → un **QR dinámico de Mercado Pago** por el importe exacto.
    Lo escanea el cliente con la app de Mercado Pago (o cualquier billetera
    compatible con el QR interoperable).
  - `tienda` → un **link de checkout** (Checkout Pro). Con `return_url`, que es
    a donde Mercado Pago devuelve al comprador cuando termina.
- **`amount_cents`** es el importe final. Si hubo descuento de socio, ya viene
  descontado: NexoPOS cobra el neto que ustedes mismos calcularon en el
  `/pos/charges`.

**Respuesta 201:**

```json
{
  "payment_id": "pay_01JA2K…",
  "status": "pending",
  "qr_data": "00020101021243650016COM.MERCADOLIBRE…",
  "checkout_url": null,
  "expires_at": "2026-10-09T14:35:00Z"
}
```

- `qr_data` sólo con `mostrador`: el texto EMVCo que NexoPOS dibuja como QR.
- `checkout_url` sólo con `tienda`.
- `expires_at`: sugerimos **5 minutos** en el mostrador (el cliente está
  enfrente) y **30 minutos** en la tienda.

Para el QR presencial Mercado Pago pide una sucursal y una caja en la cuenta del
comercio. **Créenlas ustedes con el token del comercio la primera vez**; que el
almacenero tenga que entrar a Mercado Pago a configurar cajas es justo la
vuelta que esto viene a ahorrar.

## 2. Consultar un cobro

```
GET /pos/payments/{payment_id}
X-API-Key: pos_...
```

```json
{
  "payment_id": "pay_01JA2K…",
  "external_reference": "nexopos-7-venta-a81f3c",
  "status": "paid",
  "amount_cents": 9200000,
  "fee_cents": 0,
  "refunded_cents": 0,
  "paid_at": "2026-10-09T14:31:12Z",
  "mp_payment_id": "91827364501",
  "error": null
}
```

| `status` | Significa | Qué hace NexoPOS |
|---|---|---|
| `pending` | Todavía no pagó | Sigue mostrando el QR / espera |
| `paid` | Mercado Pago lo acreditó | Cierra la venta o marca el pedido pagado |
| `rejected` | Mercado Pago lo rechazó | Muestra `error` y ofrece otro medio |
| `expired` | Venció sin pagar | Ofrece generar otro |
| `cancelled` | Lo canceló NexoPOS | — |
| `refunded` | Devuelto, total o parcial | Mira `refunded_cents` |

**`paid` es solamente "acreditado por Mercado Pago"**, no "el cliente volvió
del checkout". Un pago en proceso (`in_process` de Mercado Pago) sigue siendo
`pending` para nosotros.

`error`, igual que en los descuentos, en castellano para leérselo al cliente:
«Tu tarjeta rechazó el pago», «El QR venció, pedile al cajero uno nuevo».

En el mostrador NexoPOS consulta cada ~2 segundos mientras muestra el QR, como
ya hace con `/pos/charges`.

## 3. Cancelar

```
POST /pos/payments/{payment_id}/cancel
```

Sólo un cobro `pending`: el cajero cerró la pantalla, o cambió el importe y va
a generar otro. Si mientras tanto se pagó, contesten 409 con el cobro en `paid`:
**no podemos perder un pago porque el cajero apretó cancelar un segundo tarde.**

## 4. Devolver

```
POST /pos/payments/{payment_id}/refunds
X-API-Key: pos_...

{
  "amount_cents": 1500000,
  "external_reference": "nexopos-7-reembolso-19"
}
```

- `amount_cents` opcional: sin él, devolución total.
- Idempotente por `external_reference`, como todo lo demás.
- **La devolución vuelve siempre al que pagó**, por Mercado Pago. Nunca a otra
  cuenta. Es lo que hace que la clave `pos_…` pueda tener este permiso sin
  volverse peligrosa: lo peor que puede hacer alguien que la robe es devolverle
  la plata a un cliente, no llevársela.

Respuesta: el cobro actualizado, como en el GET.

**Esto es lo que más necesitamos.** Hoy, sin endpoint de anulación, un
reembolso del mostrador con descuento de socio ya se arregla a mano. Con plata
de por medio no puede quedar así: el comerciante devolvería la mercadería y la
plata se la tendría que devolver entrando a Mercado Pago, uno por uno.

## 5. Avisarle a NexoPOS

```
POST https://nexopos.app/api/clubpay/webhook/cobro
X-API-Key: pos_...        (la clave del comercio, como en /webhook/pago)
Content-Type: application/json

{ …el cobro entero, igual que GET /pos/payments/{id}… }
```

- Cada vez que cambia el `status` o `refunded_cents`.
- **El cobro entero**, no sólo lo que cambió: un aviso que llega tarde trae el
  estado con el que salió.
- Reintenten mientras no contestemos 2xx. Del lado nuestro es idempotente por
  `payment_id` + `status`: un repetido no cierra dos veces la misma venta.

Lo usamos sobre todo para la tienda, donde no hay nadie mirando una pantalla
con polling. En el mostrador consultamos igual, así que si el aviso se demora
el cajero no espera.

## 6. Errores

Igual que en `/pos/charges`: el texto en `error` o `message`, en castellano,
para mostrarlo tal cual. Los que más nos importan:

| Caso | Código | Mensaje sugerido |
|---|---|---|
| Mercado Pago sin conectar | 409 | «Este comercio no tiene Mercado Pago conectado en ClubPay.» |
| Interruptor apagado | 403 | «Activá "Cobrar desde NexoPOS" en ClubPay › Cobros.» |
| Token vencido o revocado | 409 | «Hay que volver a conectar Mercado Pago en ClubPay.» |

---

## Después: un solo QR para el descuento y el pago

Con lo de arriba, un socio en el mostrador escanea dos veces: primero el QR de
ClubPay (descuento) y después el de Mercado Pago (por el neto). Funciona y no
les pide nada más.

Lo ideal es uno solo: `POST /pos/charges` con `"collect": true`, y cuando el
socio confirma el descuento en la app, la misma app le cobra el neto con
Mercado Pago —que es lo que ya hace con la libreta—. El charge pasaría por
`applied` → `paid`. **No lo pedimos ahora**; lo dejamos anotado para cuando lo
de arriba esté andando.

## Preguntas

1. La comisión de los cobros que vienen de NexoPOS/NexoTienda.
2. Si les parece bien el interruptor en Cobros como forma de autorización.
3. Si el permiso OAuth que tienen hoy alcanza para crear sucursal, caja y QR
   presencial, además del checkout. Creemos que sí, pero lo confirma su
   aplicación de Mercado Pago, no nosotros.
4. Fecha estimada de los endpoints 0 a 5.

## Mientras tanto

NexoPOS construye su lado contra un **simulador** con este mismo contrato, como
hicimos con `/pos/charges`: idempotente igual que la API real, para que probar
acá diga algo sobre lo que va a pasar afuera. Cuando ustedes publiquen, si algo
difiere, manda lo de ustedes y nos adaptamos.

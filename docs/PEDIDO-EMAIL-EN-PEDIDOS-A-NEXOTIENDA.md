# Pedido a NexoTienda: el correo de quien compra

**De:** NexoPOS · **Para:** NexoTienda · **Fecha:** 23/11/2026
**Sobre:** lo mismo que hicimos con el teléfono
(`RESPUESTA-TELEFONO-CON-SESION-A-NEXOTIENDA.md`), ahora con el correo.
Pedido de German.

## Para qué

Más adelante el comercio va a poder mandar por correo el ticket y los avisos
del pedido («lo aceptamos», «está listo», «salió», «se canceló»). Para eso
necesitamos el correo de quien compra, y hoy no lo tenemos: el pedido trae
nombre y teléfono, nada más. **Todavía no mandamos ningún correo**; esto es
para empezar a juntarlo.

## Qué ya está de nuestro lado

Sale con el próximo deploy de NexoPOS. Es todo opcional: si no mandan nada,
anda como hoy.

### 1. `email` en `GET /v1/cuentas/:accountId?storeId=`

Igual que `phone`:

```jsonc
{
  "accountId": "CLI-4231",
  "displayName": "Germán Yovan",
  "phone": "3537 41-0000",
  "email": "german@ejemplo.com",   // nuevo, o null
  ...
}
```

- Es el correo de la ficha del cliente en ese comercio, en minúsculas.
- Va **siempre**, con el correo o con `null`. Nunca `""`.
- Sin verificar: es para precargar el campo, no una prueba de nada.

### 2. `contact.email` en `POST /v1/orders`

```jsonc
"contact": {
  "name": "Germán Yovan",
  "phone": "3537 41-0000",
  "email": "german@ejemplo.com"   // nuevo, opcional
}
```

- **Opcional.** Un pedido sin correo entra igual que hoy.
- **Uno mal escrito no frena el pedido**: si no tiene forma de correo
  (`algo@algo.algo`), lo descartamos y el pedido entra sin correo. Validen
  ustedes la forma en el carrito para avisarle a la persona; nosotros no
  vamos a rechazar un pedido por esto.
- Queda guardado **en el pedido**, también cuando es anónimo (sin
  `accountId`), que es la mayoría. Es a ese correo al que va a ir el aviso.
- Con `accountId`, además **completa la ficha si no tiene correo**, igual que
  el teléfono. Desde el segundo pedido viene precargado en `email`. Si la
  ficha ya tiene uno y el del pedido es otro, no lo pisamos: decide el
  comercio.

### 3. ClubPay

Le pedimos a ClubPay que mande el correo de la cuenta en el canje, junto con
el celular (`PEDIDO-TELEFONO-EN-CANJE-A-CLUBPAY.md`). Cuando lo mande, quien
entra por primera vez ya tiene el correo precargado en su primer pedido. No
cambia nada para ustedes: sigue saliendo de `email` en la cuenta.

## Qué les pedimos

1. **Un campo «Correo electrónico» en el carrito**, opcional, al lado del
   teléfono. Precargado con `email` cuando la cuenta lo trae, y editable.
2. **Mandarlo en `contact.email`** con el pedido, con sesión o sin ella.
3. Que el campo diga para qué es, algo como «Para mandarte el ticket y avisarte
   cómo va tu pedido». Si la persona no entiende para qué se lo piden, no lo
   pone.

Opcional y sin coordinar: pueden desplegarlo antes o después que nosotros. Si
lo mandan antes de nuestro deploy, el campo se ignora y el pedido entra igual.

## Qué necesitamos de vuelta

- Si lo van a pedir en el carrito, y si va a ser opcional para el comprador
  (nuestra propuesta) u obligatorio.
- Si el campo se llama `email` de su lado o de otra forma (lo leemos como
  quieran).

## Lo que probamos

En local: ficha sin correo que se completa con el primer pedido (pasado a
minúsculas); segundo pedido con otro correo que no la pisa; ficha que ya tenía
correo; un correo mal escrito que no frena el pedido y no se guarda; un pedido
anónimo con correo que queda en el pedido y no crea ni toca fichas; un pedido
sin `email`, como mandan hoy; y el canje con el simulador de ClubPay
mandando correo.

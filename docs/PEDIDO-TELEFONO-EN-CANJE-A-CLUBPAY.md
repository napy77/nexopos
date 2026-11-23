# Pedido a ClubPay: el celular y el correo en el canje de la tienda

**De:** NexoPOS · **Para:** ClubPay · **Fecha:** 23/11/2026
**Prioridad:** baja. Es una comodidad; nada se rompe sin esto.

## Qué pedimos

Dos campos opcionales más en la respuesta de `POST /pos/tienda/sessions` (el
canje del token de entrada a la tienda):

```jsonc
{
  "account_id": "…",
  "external_id": "CLI-4231",   // o null
  "persona": "Germán Yovan",
  "verification_level": 2,
  "email_verified": true,
  "phone": "3537 41-0000",     // nuevo: el celular que la persona cargó, o null
  "email": "german@ejemplo.com" // nuevo: el correo de la cuenta, o null
}
```

- Si la persona no cargó celular, `null` o que no venga. No un texto vacío.
- El correo es el de la cuenta de ClubPay. Si lo tienen verificado, mejor,
  pero no es condición: lo tomamos como no verificado.
- Tal como lo cargó. No hace falta que esté verificado: lo usamos sabiendo que
  no lo está.

## Para qué

Quien entra a NexoTienda con ClubPay y paga al retirar tiene que escribir su
teléfono en cada pedido, porque el comercio necesita poder avisarle. NexoTienda
nos pidió precargarlo (`PARA-NEXOPOS_de-NEXOTIENDA_telefono-con-sesion.md`).

Lo sacamos primero de la ficha del cliente en el comercio, y la ficha se
completa con el primer pedido. Con el celular de ClubPay, quien entra por
primera vez ya lo tiene precargado en su primer pedido.

Con el correo, además, el comercio va a poder mandar el ticket y los avisos del
pedido por mail (todavía no lo hacemos).

## Qué hacemos con ellos

- **Sólo completan una ficha que no tiene teléfono o correo.** Nunca pisa uno que el
  comercio ya cargó.
- Se guarda en la ficha de ese comercio y nada más. No lo mandamos a nadie.
- La tienda lo precarga y la persona lo puede cambiar en el carrito.

## De nuestro lado ya está

El canje ya lee `phone` y `email` cuando vienen. Pueden desplegarlo cuando quieran, sin
coordinar. Si prefieren otros nombres (`celular`, `phone_number`, `correo`), avisen y lo
leemos así.

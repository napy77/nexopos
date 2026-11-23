# Pedido a ClubPay: el celular en el canje de la tienda

**De:** NexoPOS · **Para:** ClubPay · **Fecha:** 23/11/2026
**Prioridad:** baja. Es una comodidad; nada se rompe sin esto.

## Qué pedimos

Un campo opcional más en la respuesta de `POST /pos/tienda/sessions` (el
canje del token de entrada a la tienda):

```jsonc
{
  "account_id": "…",
  "external_id": "CLI-4231",   // o null
  "persona": "Germán Yovan",
  "verification_level": 2,
  "email_verified": true,
  "phone": "3537 41-0000"      // nuevo: el celular que la persona cargó, o null
}
```

- Si la persona no cargó celular, `null` o que no venga. No un texto vacío.
- Tal como lo cargó. No hace falta que esté verificado: lo usamos sabiendo que
  no lo está.

## Para qué

Quien entra a NexoTienda con ClubPay y paga al retirar tiene que escribir su
teléfono en cada pedido, porque el comercio necesita poder avisarle. NexoTienda
nos pidió precargarlo (`PARA-NEXOPOS_de-NEXOTIENDA_telefono-con-sesion.md`).

Lo sacamos primero de la ficha del cliente en el comercio, y la ficha se
completa con el primer pedido. Con el celular de ClubPay, quien entra por
primera vez ya lo tiene precargado en su primer pedido.

## Qué hacemos con él

- **Sólo completa una ficha que no tiene teléfono.** Nunca pisa uno que el
  comercio ya cargó.
- Se guarda en la ficha de ese comercio y nada más. No lo mandamos a nadie.
- La tienda lo precarga y la persona lo puede cambiar en el carrito.

## De nuestro lado ya está

El canje ya lee `phone` cuando viene. Pueden desplegarlo cuando quieran, sin
coordinar. Si prefieren otro nombre (`celular`, `phone_number`), avisen y lo
leemos así.

# Respuesta a NexoTienda: el teléfono de quien ya se identificó

**De:** NexoPOS · **Para:** NexoTienda · **Fecha:** 23/11/2026
**Sobre:** `PARA-NEXOPOS_de-NEXOTIENDA_telefono-con-sesion.md`

Hecho como lo pidieron. **Le sumamos el correo con la misma lógica**: ver
`PEDIDO-EMAIL-EN-PEDIDOS-A-NEXOTIENDA.md`. Sale con el próximo deploy de NexoPOS; como ustedes ya
leen el campo, no hay que coordinar nada.

## El campo

Se llama **`phone`**, como propusieron, en `GET /v1/cuentas/:accountId?storeId=`:

```jsonc
{
  "accountId": "CLI-4231",
  "displayName": "Germán Yovan",
  "phone": "3537 41-0000",   // o null
  ...
}
```

- Va **siempre**, con el teléfono o con `null`. Nunca `""`: una ficha con el
  teléfono en blanco también da `null`.
- Va tal como está en la ficha, sin normalizar (espacios, guiones). Es para
  precargar el campo, no para comparar.
- Sólo en `GET /v1/cuentas/:accountId`. El canje (`POST /v1/cuentas/canjear`)
  no lo trae: ustedes leen la cuenta cada vez que se abre el carrito, y así hay
  un solo lugar de donde sale.

## De dónde sale: de la ficha, y la ficha se completa sola

1. **El teléfono de la ficha del cliente en ese comercio.**
2. **Si la ficha no tiene, la completa el primer pedido** que llega con
   `accountId` y `contact.phone`. Desde el segundo pedido ya está precargado.
   Si la ficha ya tiene uno y el del pedido es otro, **no se pisa**: cuál vale
   lo decide el comercio en la ficha. Un pedido sin `accountId` no toca
   ninguna ficha.
3. **El celular de ClubPay:** se lo pedimos a ClubPay hoy
   (`PEDIDO-TELEFONO-EN-CANJE-A-CLUBPAY.md`), para que lo sume a lo que nos
   devuelve en el canje. De nuestro lado ya está listo: cuando lo mande, el
   canje completa con él la ficha vacía, con la misma regla de no pisar. No
   cambia nada para ustedes: sigue saliendo de `phone`.
4. **Sin ninguno, `null`** y la tienda lo pide, como hoy.

O sea: **de los dos**, pero siempre leído de la ficha. Lo de ClubPay entra a la
ficha una vez, en el canje, y no se consulta a ClubPay en cada lectura.

## Lo que probamos

En local, con la tienda simulada por `curl`:

- Ficha con teléfono: lo trae.
- Ficha sin teléfono: `null`. Primer pedido con `accountId` y
  `3537 41-0000`: la cuenta pasa a traer `3537 41-0000`. Segundo pedido con
  otro número: sigue `3537 41-0000`.
- Ficha con el teléfono en blanco: `null`, y el pedido la completa.
- Ficha con teléfono y pedido con otro número: no cambia.
- Pedido sin `accountId`: no toca ninguna ficha.
- Canje de alguien que entra por primera vez, con el simulador de ClubPay
  mandando un celular: la ficha nueva nace con ese teléfono.

**No probado:** con ClubPay de verdad, porque todavía no manda el celular.

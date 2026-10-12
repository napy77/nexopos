# Cobros con Mercado Pago — NexoTienda integrado de su lado

> **Para el equipo de NexoPOS.** De NexoTienda, 11 de octubre de 2026. Este archivo se
> manda tal cual.
>
> Respuesta a `PARA-NEXOTIENDA_de-NEXOPOS_cobros-mercadopago.md` (CR-0002).

## Confirmaciones que pedía el CR

- **`mercadopago.ts` queda fuera.** No se termina ni se construye: se borró
  `lib/payments` entero —el adapter de Mercado Pago y el sandbox— junto con
  `MP_ACCESS_TOKEN`. Ningún camino de la tienda habla con Mercado Pago.
- **Ya no llamamos a `POST /v1/orders/:code/payment`. Para ningún método.** Ni
  `online`, ni transferencia, ni efectivo: el port de NexoTienda no tiene ningún método
  para marcar algo como pagado. Quien confirma es quien lo ve —Mercado Pago, o el
  comerciante en NexoPOS mirando su banco o recibiendo la plata—.
- **Tampoco llamamos a `POST /v1/stores/:id/accounts/:acc/payments`.** La libreta se
  paga en ClubPay. Si ese endpoint no tiene otro consumidor, se puede retirar.

## Lo que encontramos, y conviene que lo miren

**Sí lo estábamos llamando, y peor de lo que el 409 sugiere.** Nuestro selector de
cobro elegía Mercado Pago solo si había `MP_ACCESS_TOKEN`; en producción no había, así
que corría **el sandbox**. "Pagar ahora" llevaba a una pantalla nuestra con un botón
"Aprobar" que llamaba a `/payment` y dejaba el pedido pagado sin plata.

Su 409 cerró eso para los pedidos. **No lo cerraba para la libreta**: el botón de pagar
la cuenta corriente iba por el mismo sandbox a `registerAccountPayment`, que anotaba un
pago en el libro. Ya no existe.

**Les pedimos buscar**: pedidos con `paymentId` que empiece con `pay_sbx_`, y pagos de
cuenta corriente con ese mismo prefijo. Si aparece alguno es un pago que no entró.

## Lo que construimos

- `online` en el checkout **solo con `acceptsMercadoPago: true`**. Antes salía de
  `acceptsOnlinePayment`, y desde su 409 eso dejaba al comprador con un error.
- `POST /v1/orders` con `online` → `POST /v1/orders/:code/checkout` → redirección.
- `returnUrl` completa y pública: `https://<slug>.nexotienda.app/pedido/<code>`.
- Al volver **no miramos la URL**: consultamos `GET /v1/orders/:code`.
- `pendiente` → "Estamos confirmando tu pago…" y consulta cada 2,5 s el primer minuto;
  después se ofrece pagar de nuevo.
- `rechazado` → `paymentError` tal cual + "Intentar de nuevo" (pide otro `/checkout`).
- `reembolsado` → "Te devolvimos el pago."
- 409 «ya está pagado» → se muestra el pedido, no un error.

De paso apareció un bug latente nuestro: con `paymentStatus: "reembolsado"` la pantalla
del pedido **se rompía entera** (buscaba la etiqueta de un estado que no conocía).
Corregido.

Probado contra nuestros datos de prueba en los tres caminos. **Falta el simulador de
ustedes.**

## Lo que necesitamos

1. **Una instancia de prueba con el simulador** —mejor que levantarla local—: URL, las
   tres claves, y un comercio con `acceptsMercadoPago: true`.
2. **Un campo estable para «ya está pagado».** Hoy lo reconocemos buscando "ya está
   pagado" en el texto del 409, y el texto es para el comprador: si lo reescriben, se
   nos rompe sin aviso. Algo como `{ "error": "…", "code": "ya_pagado" }` alcanza.
3. **El campo del mensaje en los 409.** Leemos `error`, `message` o `mensaje`, en ese
   orden. Confirmen cuál mandan.
4. **Webhooks: NexoTienda no tiene receptor.** El CR-0002 dibuja el aviso NexoPOS →
   NexoTienda, pero para la pantalla del comprador alcanza con consultar el pedido, que
   es lo que su documento recomienda. Confirmen que **no están intentando entregarnos
   avisos** que se pierden. Si en algún momento hace falta recibirlos, es otra pieza y
   la conversamos.

## Para más adelante

Germán describió el caso de la transferencia: el comprador paga, **sube el
comprobante**, y el comerciante lo verifica en su banco y marca el pedido. Hoy la tienda
muestra el alias pero no tiene dónde subir el comprobante. Si de su lado existe —o
existe un lugar en el pedido para adjuntarlo— avísennos: la tienda junta la evidencia,
el comerciante da el veredicto.

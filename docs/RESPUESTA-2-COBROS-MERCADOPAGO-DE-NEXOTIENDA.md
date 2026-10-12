# Cobros con Mercado Pago — probado contra su simulador

> **Para el equipo de NexoPOS.** De NexoTienda, 11 de octubre de 2026. Este archivo se
> manda tal cual.
>
> Responde a `PARA-NEXOTIENDA_de-NEXOPOS_respuesta-cobros-mercadopago.md` (CR-0002).

Gracias por buscar los `pay_sbx_`. Que el endpoint de libreta nunca haya existido
cierra la duda que más nos preocupaba.

## Tomado

- **`code`**: decidimos por `code` y ya no buscamos nada en el texto. `ya_pagado`
  muestra el pedido, `link_anterior_vivo` pide reintentar, y el resto muestra el
  `error` tal cual.
- **`mp_no_disponible` al crear el pedido** ahora es un error **que el comprador
  arregla ahí mismo** —elegir otro medio— y no el "No pudimos mandar tu pedido" con el
  botón de contacto, que era para fallas sin arreglo.
- **Solo `error`**: sacamos `message` y `mensaje`.
- **Webhooks**: entendido, no hacemos nada. Consultamos el pedido.

## Probado contra su simulador, local

Levantamos un NexoPOS con su base propia, sin `CLUBPAY_API_URL` y con
`MERCADOPAGO_SIMULADOR=on`, siguiendo sus pasos. Un detalle por si le sirve a otro
equipo: **su `backend/.env` existe y `dotenv` lo carga**, así que cualquier variable que
no se pise viene de ahí. Lo aislamos con `DOTENV_CONFIG_PATH` apuntando a un archivo
propio; sin eso, una variable olvidada podría haber apuntado a algo real.

Todo de punta a punta, con NexoTienda contra ese NexoPOS:

| Caso | Resultado |
|---|---|
| Pedido `online` → `/checkout` → simulador | Redirige con nuestra `returnUrl` intacta |
| «Rechazar la tarjeta» | Vuelve y muestra su `paymentError` tal cual |
| «Intentar de nuevo» | Pide otro `/checkout`; el link es **nuevo** (`pay_demo_871b…` → `pay_demo_c77d…`) |
| «Pagar» | «¡Listo! Recibimos tu pago.» |
| `/checkout` de un pedido pagado | 409 `{"error":"…","code":"ya_pagado"}`, como dijeron |
| El comercio apaga Mercado Pago con el checkout abierto | `mp_no_disponible` → «Elegí otra forma de pago», corregible |

No encontramos nada que no cierre de su lado. Al terminar se borró la base de prueba y
su repo quedó sin cambios.

## Lo que sigue

1. **La primera venta real**, con ClubPay y plata de verdad, cuando Germán confirme el
   comercio. De nuestro lado no falta nada para eso.
2. **El comprobante de transferencia**: de acuerdo con el borrador
   (`POST /v1/orders/:code/comprobante`, el pedido en `pendiente` hasta que el comercio
   lo marque). Cuando Germán lo priorice les mandamos cómo lo queremos mostrar.

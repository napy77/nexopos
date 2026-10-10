# CR-0002 · Ajustes 1 y 2 hechos

**Para el equipo de ClubPay.** De NexoPOS, 10 de octubre de 2026.
Responde a `respuesta-cr-0002-cobros-mercadopago.md` (copia en
`RESPUESTA-2-COBROS-MERCADOPAGO-DE-CLUBPAY.md`).

## 1. Cancelar antes de ofrecer otro medio — hecho

- Con `rejected` el QR sigue en pantalla, pero el texto ya no invita a cobrar
  de otra forma: dice que el cliente puede reintentar con otra tarjeta en su
  app y que **para cobrar de otra forma hay que cancelar el QR primero**.
- El mostrador guarda el último cobro vivo. Cobrar con **cualquier otro medio**
  hace `POST /cancel` antes. Si contesta `paid`, la venta se cierra **con ese
  pago y como Mercado Pago**, aunque el cajero haya tocado Efectivo. Si
  cancelar falla, no se cobra de otra forma y el cajero ve por qué.
- Un QR vencido también se cancela al cerrarlo o al generar otro: un
  `expired` puede terminar pagado, y así queda marcado para devolverse solo.

## 2. Un solo link vivo por pedido — hecho, y un poco más

- Al pedir otro link, el anterior se cancela **antes** de crear el nuevo. Si
  cancelar falla, no se crea el nuevo. Si al cancelar resulta pagado, el pedido
  queda pagado con ése y no hay link nuevo.
- **Agregado:** cuando un pedido se paga, se cancelan los otros links que sigan
  vivos. Lo encontramos probando: un link viejo pagado tarde dejaba vivo al más
  nuevo. Si alguno se paga igual, se devuelve solo.

## 3. Terminales — sin cambios, como piden

Queda para la prueba real, con el caso de dos QR de mostrador a la vez. Si se
confirma que se pisan, agregamos `terminal` al `POST`.

## Prueba real

German prepara el comercio de prueba y coordina el horario con ustedes.

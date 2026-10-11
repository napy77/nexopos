# CR-0002 · Recibido el cambio de /cancel

**Para el equipo de ClubPay.** De NexoPOS, 11 de octubre de 2026.

- **`/cancel` de `rejected` y `expired`:** simulador ajustado (`c2e6178`). Del
  lado real no quedábamos trabados: ante un 409 releemos el cobro, y si no
  está pagado seguimos y lo marcamos para devolverlo solo si después se paga.
  Pero el QR rechazado seguía vivo del lado de ustedes; con su cambio queda
  cancelado de verdad, que es lo que buscábamos.
- **Cancelar un cobro viejo con uno más nuevo en la caja:** no cambia nada
  nuestro. El viejo queda marcado como abandonado; si lo pagan antes de que
  venza, se devuelve solo.

Prueba real: sin cambios, German coordina.

# Respuesta a CR-0002 · Cobros con Mercado Pago

**Para el equipo de NexoPOS.** De ClubPay, 9 de octubre de 2026.
Responde a su CR-0002 (copia en `docs/nexopos-cr-0002-cobros-mercadopago.md`).

## Está en producción

Desde hoy, 09/10: `https://api.clubpay.com.ar/pos/payments…` y el aviso a
`https://nexopos.app/api/clubpay/webhook/cobro`, ya configurado en nuestro
servidor.

## Lo que tomaron, bien

Releer el GET a partir del aviso, no retroceder nunca un `paid`, emitir la venta
cuando cancelar devuelve 409, referencias fijas para las devoluciones y
devolver solos lo que se pagó sin venta: todo eso es exactamente lo que hacía
falta.

## Tres cosas a ajustar

**1. Antes de ofrecer otro medio, cancelen el cobro.** Con `rejected` dejan el
QR en pantalla y el cliente «puede probar otro medio». Si paga en efectivo y el
QR sigue vivo, un segundo intento con la billetera se aprueba y el cliente pagó
dos veces. Su devolución automática lo cubre solo si el cobro estaba cancelado
por ustedes. Al elegir otro medio: `POST /cancel` primero. Si contesta 409 con
`paid`, la venta se cierra con ese pago y no con el efectivo.

**2. En la tienda, al pedir otro link, cancelen el anterior.** Así hay un solo
link vivo por pedido. Ya tienen la devolución si se pagan dos; esto la vuelve
excepcional.

**3. El mostrador tiene una sola caja de Mercado Pago por comercio** (`CLUBPAY<id>CAJA1`).
No sabemos todavía si Mercado Pago permite dos órdenes de QR vivas en la misma
caja. Si no lo permite, un comercio con dos terminales de NexoPOS cobrando a la
vez tendría un QR que pisa al otro, y cancelar uno podría dar de baja el del
otro. **Lo agregamos a la prueba real.** Si se confirma, la solución es una
caja por terminal: ustedes nos mandarían un campo opcional `terminal` en el
`POST`, y nosotros creamos una caja por cada uno. No lo hagan todavía; esperamos
la prueba.

## La prueba real

De acuerdo con lo que proponen, con estos cambios:

- El caso «un QR cancelado y pagado igual» es difícil de provocar en el
  mostrador: al cancelar damos de baja la orden en Mercado Pago, así que el QR
  deja de servir. Se puede intentar escaneando antes de cancelar y aprobando en
  el teléfono justo después. Si no sale, lo probamos con el link de la tienda.
- Agregamos: **dos QR de mostrador a la vez** en el mismo comercio (punto 3).

El comercio de prueba lo prepara German: Mercado Pago conectado, interruptor
prendido y dirección cargada. Les avisa cuál es y coordinan el horario.

## La comisión

Sigue en cero.

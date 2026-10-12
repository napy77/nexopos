# Cobros con Mercado Pago — respuesta a NexoTienda

**Para el equipo de NexoTienda.** De NexoPOS, 11 de octubre de 2026.
Responde a `PARA-NEXOPOS_de-NEXOTIENDA_cobros-mercadopago.md` (CR-0002).

Gracias por lo del sandbox: era peor de lo que nuestro 409 dejaba ver, y
sacarlo entero era lo correcto.

## Lo que buscaron

- **Pedidos con `pay_sbx_`:** aparecieron tres, de septiembre (dos de
  Supermercado Delfín y uno de Jure Hnos). Ninguno se entregó y German confirmó
  que eran pruebas. No hay plata que falte.
- **Pagos de libreta con `pay_sbx_`:** ninguno, y no podía haber.
  `POST /v1/stores/:id/accounts/:acc/payments` **nunca existió en NexoPOS**:
  esas llamadas terminaban en un 404 o se quedaban en su sandbox. No hay nada
  que retirar de nuestro lado.

## Sus pedidos

### 2. Un campo estable para «ya está pagado» — hecho

En producción desde hoy. Los errores traen `code` al lado del mensaje:

```json
{ "error": "Este pedido ya está pagado.", "code": "ya_pagado" }
```

| `code` | Cuándo |
|---|---|
| `ya_pagado` | `/checkout` de un pedido pagado |
| `mp_no_disponible` | el comercio no cobra con Mercado Pago (también en `POST /v1/orders`) |
| `no_es_mercadopago` | `/checkout` de un pedido que no es `online` |
| `pedido_cancelado` | `/checkout` de un pedido cancelado |
| `link_anterior_vivo` | **502**: no pudimos dar de baja el link anterior; que el comprador reintente |
| `pago_lo_confirma_mercadopago` | `/payment` sobre un pedido `online` |

Decidan por `code`; el texto es para el comprador y lo podemos mejorar. Un
error sin `code` es uno sobre el que no tienen que decidir nada: se muestra.

### 3. El campo del mensaje — `error`

Siempre `error`. No mandamos `message` ni `mensaje`; pueden sacar esos dos.

### 4. Webhooks — no les estamos mandando nada

Confirmado en producción: la URL de NexoTienda no está configurada, y **no salió
ningún aviso**. Los eventos quedan guardados de nuestro lado y no se pierden ni
los intentamos entregar.

Para la pantalla del comprador alcanza con consultar el pedido, como hacen.
Si algún día quieren recibirlos, lo conversamos; antes de prenderlos
descartamos los viejos, para que no les lleguen de golpe.

### 1. Una instancia de prueba con el simulador

La estamos evaluando con German: sería un NexoPOS aparte, con su propia base,
nunca la de producción. Les avisamos.

Mientras tanto, se puede levantar local en unos minutos. Con el repo de
NexoPOS (si no tienen acceso, pídanselo a German):

```
# backend/.env
DATABASE_URL=postgres://…/nexopos_prueba
NEXOB2B_API_URL=                  # vacío: login demo
CLUBPAY_API_URL=                  # vacío
MERCADOPAGO_SIMULADOR=on
NEXOPOS_PUBLIC_URL=http://localhost:4000
NEXOTIENDA_KEY_CATALOGO=…         # las que quieran, y las mismas de su lado
NEXOTIENDA_KEY_PEDIDOS=…
NEXOTIENDA_KEY_CUENTAS=…
```

Las migraciones corren solas al arrancar. Después, en el POS
(`demo@comercio.com` / `demo`): cargar un par de productos desde Catálogo y,
en Configuración › Tienda online, poner el slug, publicarla y prender
**Mercado Pago**. Con eso el `Store` trae `acceptsMercadoPago: true`.

El `checkoutUrl` lleva a una página del simulador con «Pagar» y «Rechazar la
tarjeta», que vuelve a su `returnUrl`. Para probar el reintento: rechazar,
pedir otro `/checkout`, pagar.

## Para más adelante: el comprobante de transferencia

De nuestro lado no existe todavía: el pedido no tiene dónde guardar un
comprobante, y el comercio no tiene cómo marcar «transferencia verificada».
Está anotado como pendiente.

La idea en la que estamos de acuerdo: **la tienda junta la evidencia, el
comerciante da el veredicto.** Cuando German lo priorice les mandamos el
contrato; un borrador sería `POST /v1/orders/:code/comprobante` con la imagen,
y el pedido con `paymentStatus: "pendiente"` hasta que el comercio lo marque
pagado desde NexoPOS. Si ya tienen pensado cómo lo quieren mostrar, mándennos
lo que tengan.

## Lo que sigue

1. Prueben contra el simulador y avísennos lo que no les cierre.
2. La primera venta real de tienda la hacemos con ClubPay, con plata de verdad,
   cuando German confirme el comercio de prueba. Los sumamos ese día.

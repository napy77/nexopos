# Respuesta a Nexo-odoo: pedidos de NexoTienda en la API para ERP

**De:** NexoPOS · **Para:** Nexo-odoo · **Fecha:** 23/11/2026
**Sobre:** `PARA-NEXOPOS_de-NEXO-ODOO_pedidos-de-tienda-para-erp.md`

Está hecho de nuestro lado y probado en local. **Todavía no está en
nexopos.app:** sale con el próximo deploy, que hace German. Hasta entonces
`/api/erp/v1/pedidos` contesta 404.

Lo que piden, en una línea: **sí a los puntos 1, 2 y 3, tal como los
propusieron; el 4 (webhook) queda propuesto, no hecho.** Abajo, los nombres
que cambiamos y por qué, y las dos respuestas.

## Autenticación

La misma clave `npos_…`, el mismo middleware (`requiereClaveErp`), el comercio
sale de la clave. No vence, no hay login. **No hay permisos por clave**: una
clave abre productos, precios, stock, ventas y pedidos. Si más adelante hace
falta una clave sin pedidos, la agregamos con un 403 que diga qué falta; hoy
no la pidió nadie y no la inventamos.

## 1. `GET /api/erp/v1/pedidos?actualizados_desde=<ISO>`

Como lo propusieron: los del comercio de la clave, en cualquier estado,
`updated_at` posterior a la fecha, ordenados por `updated_at`, de a **200**.
Sin `actualizados_desde`: los que están en curso (`recibido`, `aceptado`,
`listo`, `en_camino`).

```json
{
  "pedidos": [{
    "code": "P-0962559F",
    "status": "recibido",
    "creado": "2026-11-23T20:41:00.123Z",
    "actualizado": "2026-11-23T20:41:00.123456Z",
    "retiro": { "tipo": "retiro", "franja": "Hoy 18 a 20 h", "direccion": null },
    "pago": { "medio": "efectivo_entrega", "estado": "no_aplica", "id": null },
    "contacto": { "nombre": "German Yovan", "telefono": "3515630140" },
    "cuenta_id": null,
    "notas": null,
    "listo_para": null,
    "motivo_cancelacion": null,
    "cancelado_por": null,
    "revision": null,
    "venta": null,
    "lineas": [{
      "producto_id": "5404",
      "ean": "7790580109882",
      "sku": null,
      "nombre": "Tableta Chocolate Extra Fino Aguila x 150 Grs — unidad",
      "unidad": "unidad",
      "cantidad": 1,
      "precio_centavos": 500000
    }],
    "subtotal_centavos": 500000,
    "cargo_centavos": 0,
    "total_centavos": 500000
  }],
  "hasta": "2026-11-23T20:39:00.123456Z",
  "hay_mas": false
}
```

Diferencias con su propuesta:

- **`cantidad` es número**, no texto (`1`, `1.5`). Es como viene en `/ventas`.
- **`producto_id` es texto**, igual que el `id` de `GET /productos`, que es
  con lo que vinculan. (En `/ventas` sigue siendo número: no lo cambiamos
  porque ya lo están leyendo.)
- **Campos de más:** `sku`, `notas` (lo que escribió el comprador),
  `cancelado_por` (`comercio`, `comprador` o `vencimiento`) y
  `venta: { id, ticket }`, la nota de venta que salió al entregarlo, la misma
  que después aparece en `/ventas`.
- **`pago.estado`** puede ser `no_aplica` (efectivo o libreta), `pendiente`,
  `pagado`, `rechazado` o `reembolsado`.
- **`contacto`** viene también cuando el pedido es a la libreta: ahí sale de
  la ficha del cliente, y `cuenta_id` trae `CLI-<n>`.
- **`revision`** es `{ "motivo": "<código>" }` y viene sólo mientras está
  `recibido`. Los códigos son de CR-0003:
  - `cuenta_nueva_monto_alto`: «Es el primer pedido de esta persona y es
    grande. Llamala antes de armarlo.»
  - `identidad_no_disponible`: «No pudimos comprobar su cuenta de ClubPay al
    recibirlo. Confirmá con la persona antes de armarlo.»

  Son los textos que muestra nuestra pantalla; úsenlos si les sirven.

### El cursor: dos cosas que conviene saber

1. **`actualizado` y `hasta` van con microsegundos.** Es la precisión de la
   base. Recortado a milisegundos, `>` volvía a traer el último pedido en cada
   consulta. Mándennos el `hasta` tal cual.
2. **`hasta` queda dos minutos atrás a propósito**, así que un pedido puede
   venir repetido en la vuelta siguiente. Actualicen por `code`, no lo
   agreguen de nuevo. El porqué: `updated_at` es la hora en que empezó el
   cambio, no la de cuando se guardó, y cancelar un pedido pagado con Mercado
   Pago espera la respuesta de ClubPay antes de guardar. Sin el margen, una
   consulta en el medio corría el cursor por encima de ese cambio y no lo
   veían nunca. Con página llena (`hay_mas: true`) el `hasta` es el último de
   la página, para que avance; y nunca vuelve antes de lo que mandaron.

Con `hay_mas: false`, la próxima consulta en un minuto. Es lo que pensaban.

También hay **`GET /api/erp/v1/pedidos/:code`**: uno solo, con la misma forma.

## 2. Mover el pedido

| Ruta | Cuerpo |
|---|---|
| `POST /api/erp/v1/pedidos/:code/aceptar` | `{ "listo_para": "30 minutos" }` — obligatorio |
| `POST /api/erp/v1/pedidos/:code/listo` | — |
| `POST /api/erp/v1/pedidos/:code/en-camino` | — (sólo reparto) |
| `POST /api/erp/v1/pedidos/:code/entregado` | — |
| `POST /api/erp/v1/pedidos/:code/cancelar` | `{ "motivo": "…" }` — obligatorio, hasta 400 caracteres |

- **Por `code`**, sin distinguir mayúsculas. Un `code` de otro comercio es
  404 `pedido_inexistente`.
- **Corre la misma lógica que la pantalla, no una copia.** Hicimos lo que
  proponían: los handlers de `pedidos.ts` pasaron a funciones que reciben el
  comercio (`aceptarPedido`, `avanzarPedido`, `cancelarPedido`), y las llaman
  la pantalla y la API para ERP. Descuento al aceptar con cupo o stock y el
  movimiento `PEDIDO-<code>`, devolución al cancelar, reembolso de Mercado
  Pago, aviso a NexoTienda y nota de venta al entregar.
- **Responde el pedido completo**, con la forma del punto 1.
- **Repetir no rompe nada.** Si ya está en ese estado: 200 con el pedido, sin
  descontar ni avisar de nuevo. Si el paso no corresponde: 409 con el estado
  actual:

  ```json
  { "error": "Este pedido ya está entregado.", "code": "paso_invalido", "status": "entregado" }
  ```

  `en-camino` de un pedido para retirar es 409 `es_retiro`. `aceptar` sin
  `listo_para` es 400 `falta_listo_para`. Decidan por `code` y `status`; el
  texto de `error` es para mostrar y lo podemos mejorar.
- Ojo con un detalle de idempotencia: un `cancelar` repetido contesta 200 y
  **conserva el primer motivo**, no el nuevo.

Los pasos posibles son los de la pantalla:

```
recibido → aceptado → listo → en_camino (sólo reparto) → entregado
cancelado: desde cualquiera antes de entregado
```

No se puede saltar `listo`: `aceptado → entregado` es 409.

### Algo que encontramos en el camino

Nuestro «aceptar» leía el estado **antes** de abrir la transacción. Dos
«aceptar» casi juntos (un doble clic en la pantalla, o un reintento suyo que se
cruza con el primero) podían descontar el stock dos veces. Ahora el pedido se
lee bloqueado dentro de la transacción. Lo probamos con diez «aceptar»
simultáneos desde la API: un solo descuento, un solo movimiento, un solo aviso
a la tienda, diez 200.

## 3. `pedido_code` en `GET /ventas`

Hecho. `null` para el mostrador, el código del pedido en la nota de venta de un
pedido entregado. **El reembolso de esa nota también trae el `pedido_code`**
del pedido que revierte, para que no lo confundan con una devolución del
mostrador.

Un aviso que no pidieron: en `/ventas` el `hasta` sigue con milisegundos, así
que la última venta de una página vuelve a venir al principio de la
siguiente. Guárdenlas por `id`. No lo cambiamos ahora para no moverles el
comportamiento a algo que ya están leyendo.

## 4. Webhook al ERP: queda propuesto, no hecho

Ustedes mismos dicen que consultar cada minuto alcanza, y estamos de acuerdo.
Un webhook por comercio pide que el comerciante cargue una URL y un secreto,
y de nuestro lado una cola con reintentos por comercio, para ahorrar menos de
un minuto. Si en el uso real el minuto molesta (un comercio con mucho
movimiento, o la caja de Odoo que necesita sonar al instante), lo hacemos con
el mismo `encolarEvento` que usamos para NexoTienda y el mismo cuerpo que
`GET /pedidos/:code`. Avísennos.

## Sus preguntas

### 1. ¿Un pedido con `revision` aceptado desde el ERP pasa por la confirmación extra?

**Nosotros no la exigimos, y en la pantalla tampoco.** Allá es un aviso
amarillo y un «¿Lo aceptás igual?» del navegador antes de llamar a `aceptar`;
el servidor acepta igual. Desde el ERP es lo mismo: **lo que proponen es
exactamente lo que hace la pantalla** —mostrar el motivo y pedir confirmación
antes de llamar a `aceptar`—. No hay un campo de confirmación en el cuerpo.

`revision` desaparece cuando el pedido deja de estar `recibido`: después de
aceptarlo ya lo miraron.

### 2. El EAN 12263774003 en tres productos de Jure

Cómo se modela, que es lo que define la respuesta:

- **En NexoPOS cada presentación es un producto aparte, con su stock
  propio.** La fila de `products` es una por presentación (botella, caja), y
  `stock_items` lleva la cantidad de cada una para cada comercio. No hay
  conversión entre presentaciones: **una caja recibida suma +1 a «CAJA» y no
  toca «BOTELLA».** Ni la recepción de compras ni `PUT /stock` multiplican
  por un factor. El factor existe en la ficha de NexoB2B, pero no se usa para
  mover stock.
- Así que, para Odoo: si Odoo lleva la caja como 6 botellas, mándennos el
  stock **de la botella** (`id` 5403 o el que corresponda) con +6, y dejen la
  «CAJA» como está. Si mandan +1 a «CAJA», en NexoPOS van a tener una caja y
  ninguna botella más, y el mostrador y la tienda venden botellas.
- **Por EAN no van a poder escribir ninguno de los tres.** Un EAN que aparece
  en dos productos del mismo comercio vuelve en `no_encontrados`: no
  adivinamos cuál era. Para este vino usen el `id`.

**¿Las dos «BOTELLA» son un duplicado?** Muy probablemente sí, pero no lo
pudimos confirmar: no miramos la base de producción. Dos «BOTELLA» con el
mismo EAN suelen ser una que vino del catálogo maestro de NexoB2B y otra que
entró antes por una recepción de compra (el listing del mayorista) o por la
importación del catálogo propio. German lo puede ver en el servidor con:

```sql
SELECT p.id, p.name, p.origen, p.nexob2b_id, p.commerce_id, p.factor,
       s.quantity, s.sale_price, s.cost, s.published_in_store, s.updated_at,
       (SELECT COUNT(*) FROM sale_items i JOIN sales v ON v.id = i.sale_id
         WHERE i.product_id = p.id AND v.commerce_id = s.commerce_id) AS ventas
  FROM products p JOIN stock_items s ON s.product_id = p.id
  JOIN commerces c ON c.id = s.commerce_id
 WHERE p.ean = '12263774003' AND c.name ILIKE '%jure%';
```

Si una de las dos no tiene ventas ni stock, se despublica y se deja de
mandar; **no la fusionamos solos**, por lo mismo que con los clientes
duplicados: sumar dos stocks mal deja mercadería que no está. Si resulta que
las dos tienen movimiento, lo resolvemos con German antes de tocar nada.

## Cómo lo probamos

Contra una base local nueva (PostgreSQL del 5432), con dos comercios de prueba
y pedidos creados por `POST /v1/orders` como los manda NexoTienda. Nunca contra
Jure ni otro comercio real.

- Listado sin parámetro y con `actualizados_desde`; el pedido del otro
  comercio no aparece; el cursor no vuelve atrás.
- Aceptar (stock 10 → 8 y 9, dos movimientos `PEDIDO-<code>`), aceptar de
  nuevo (200, sin descontar), `en-camino` de un retiro (409), `entregado`
  salteando `listo` (409), listo, entregado (nota de venta, `venta` en el
  pedido), entregado de nuevo (200), cancelar un entregado (409 con
  `status: entregado`).
- Reparto: aceptar, cancelar (el stock vuelve), cancelar de nuevo (200),
  aceptar un cancelado (409).
- Un aviso `order.*` a NexoTienda por cada cambio real, ninguno en las
  repeticiones.
- `/ventas`: la nota del pedido con `pedido_code`, su reembolso también, la
  venta del mostrador con `null`.
- Clave de otro comercio sobre un pedido ajeno: 404. Sin clave y con clave
  inválida: 401. Fecha inválida: 400.
- La pantalla de pedidos (`/api/pedidos/:id/…`) sigue igual: mismas
  respuestas, 409 al repetir.

**Lo que no pudimos probar en local:** cancelar desde la API un pedido pagado
con Mercado Pago. Corre la misma función que la pantalla, pero en local no hay
ClubPay que devuelva el cobro, y la devolución tampoco está validada todavía con
plata real desde la pantalla. Y la
prueba de punta a punta con Jure que proponen, que queda para después del
deploy.

La documentación pública está en `/docs/api#pedidos` (sale con el mismo
deploy) y el contrato en `docs/API_CONTRACTS.md`, sección 9.

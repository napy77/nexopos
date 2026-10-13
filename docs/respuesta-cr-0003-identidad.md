# CR-0003 — Respuesta de NexoPOS: identidad y verificación en los pedidos de la tienda

> De NexoPOS a nexo-ecosystem (y por su intermedio a ClubPay y NexoTienda), 12 de octubre de 2026.
> Responde a `PARA-NEXOPOS_de-NEXO-ECOSYSTEM_identidad-cr-0003-completo.md`.
> **Estado: propuesta.** No hay código todavía; lo que sigue está escrito contra el código actual de NexoPOS
> (commit `57a64bd`) y dice dónde cambia cada cosa.

## En una línea

Sí a casi todo. NexoPOS es el lugar correcto para los topes y las reglas, con un interruptor por comercio
que arranca **apagado**. Pero hay **dos agujeros en el contrato propuesto** que hay que cerrar antes de
construir (puntos 1 y 2), y una aclaración sobre «pendiente de confirmar» que simplifica todo (punto 5).

---

## 1. El agujero más grave: una cuenta nacida en la tienda tendría fiado sin límite

Hoy, en NexoPOS, **toda cuenta es una libreta**. `customers` nació como «cliente con cuenta corriente» y
el límite de crédito es opcional: `credit_limit` en NULL quiere decir **sin límite**, porque así funciona el
cuaderno del almacén. `POST /v1/orders` con `paymentMethod: "cuenta_corriente"` sólo mira que la cuenta
exista, no esté pausada y tenga disponible.

Si las personas que se identifican en la tienda entran como `customers` sin más, **cualquiera que verifique
un email puede comprar fiado sin tope** en cualquier comercio que tenga prendido el fiado online. Es peor que
el caso de «Lando Landa».

**Cómo lo cerramos de nuestro lado** (no depende de nadie):

- Columna nueva `customers.libreta_activa BOOLEAN NOT NULL`. Las cuentas que ya existen quedan en `true`
  (todas las abrió un comerciante en el mostrador, a sabiendas); las que nacen en la tienda, en `false`.
- `POST /v1/orders` con `cuenta_corriente` rechaza con `code: "libreta_no_activa"` si la cuenta no la tiene.
- `GET /v1/cuentas/:accountId` suma `creditEnabled: boolean`. **NexoTienda tiene que dejar de suponer que
  una sesión abierta es una libreta**: desde este CR, una sesión es una persona identificada, y la libreta es
  un permiso aparte que da el comercio.
- La libreta se activa con un botón explícito en la ficha del cliente («Habilitar libreta»), que además llama
  a `POST /pos/accounts/:account_id/libreta` de ClubPay. Asignar el número de cliente no la activa (lo pide
  el CR y coincidimos).

## 2. El canje de hoy se rompe con las cuentas nacidas en la tienda

`POST /v1/cuentas/canjear` (`modules/v1-cuentas.ts`) toma el `external_id` que devuelve ClubPay, le saca el
`CLI-` y busca ese cliente. Una relación nacida en la tienda llega con `external_id: null` y hoy terminaría
en un **502 «ClubPay devolvió una referencia que no entendemos»**.

**Propuesta:** el número de cliente lo asigna NexoPOS **en el primer canje**, no en un paso posterior:

1. ClubPay contesta el canje con `external_id: null` y `account_id`.
2. NexoPOS busca un cliente con ese `clubpay_account_id` en ese comercio (por si ya entró antes y falló el
   paso 4). Si no hay, lo crea: nombre = `persona`, `libreta_activa = false`, origen `tienda`.
3. Índice único `(commerce_id, clubpay_account_id)`: dos canjes simultáneos de la misma persona no crean
   dos clientes.
4. NexoPOS llama a `PUT /pos/accounts/:account_id { external_id: "CLI-<n>" }`. Si falla, la sesión se abre
   igual (el cliente ya existe acá) y se reintenta en el próximo canje.

Así NexoTienda sigue recibiendo el mismo `accountId: "CLI-<n>"` de siempre y **nunca ve el `account_id` de
ClubPay**, que era una decisión ya tomada (ver el comentario de `refDeCliente`).

**Pregunta para ClubPay, la más importante de esta respuesta:** si una persona **ya tiene relación** con el
comercio porque el comerciante la vinculó por DNI desde el mostrador (`POST /pos/customers`), y después se
identifica en la tienda, ¿la pantalla «Vas a identificarte ante <comercio>» **reusa esa relación** (mismo
`account_id`, mismo `external_id`)? Tiene que ser así: una relación por persona y comercio. Si se crea una
segunda, esa persona queda partida en dos clientes acá —uno con la libreta, otro sin—, y el detector de
duplicados no la encuentra porque la nacida en la tienda no tiene teléfono ni DNI.

Y una segunda: las relaciones vinculadas por DNI que ya existen (`status: vinculada`), ¿cuentan como libreta
activada del lado de ClubPay? Tienen que contar, o el día que deployen el `POST …/libreta` los movimientos de
los clientes actuales empiezan a rebotar.

## 3. Sobre el contrato de ClubPay

| Punto | Respuesta |
|---|---|
| `verification_level` y `email_verified` en el canje | Sirve. Lo guardamos como referencia, pero **no decidimos con eso** (ver abajo). |
| `GET /pos/accounts/:account_id` | Sirve tal cual. Es lo que usamos para decidir. 404 si no es del comercio: correcto. |
| `PUT /pos/accounts/:account_id { external_id }` | Sirve. Pedimos que sea **idempotente**: mismo valor → 200, no 409. Y que un valor **distinto** al ya asignado dé 409, para no reasignar un número de cliente en silencio. |
| `POST /pos/accounts/:account_id/libreta` | Sirve. Pedimos también el inverso (`DELETE`), porque el comerciante va a querer cerrar una libreta sin desvincular a la persona. |
| `PUT /pos/storefront` | Sirve, con una observación sobre quién arbitra (punto 8). |

**El nivel lo pregunta NexoPOS, no lo cree de NexoTienda.** El CR propone que NexoTienda mande el nivel en el
pedido. Lo vamos a aceptar si viene, pero la decisión sale de `GET /pos/accounts/:account_id` en el momento de
crear el pedido: el nivel es lo que protege al comercio, y la clave de la tienda la tiene un servidor que no
es el nuestro. Si ClubPay no contesta, el pedido **no se rechaza**: entra marcado para revisión (punto 5),
porque perder la venta por un problema de red es peor que hacer mirar el pedido al comerciante.

## 4. `POST /v1/orders`: qué cambia

- **Se acepta `accountId` con cualquier forma de pago**, no sólo con cuenta corriente. Hoy `accountId` y
  `contact` son excluyentes; pasan a poder ir juntos, porque ClubPay en nivel 1 no nos da teléfono y el
  comercio lo necesita para avisar. `contact.phone` sigue siendo obligatorio en todo pedido que no sea a la
  libreta.
- El nivel no viaja en nuestro contrato (lo averiguamos nosotros). Si NexoTienda lo manda como
  `verificationLevel`, se ignora sin error.
- Con el interruptor apagado, **nada cambia**: los pedidos anónimos siguen entrando como hoy.

Una aclaración de nombres: en NexoPOS «pagar al retirar» y «pagar al recibir» son **la misma forma de pago**,
`efectivo_entrega`; lo que cambia es la franja (`slotKind: retiro | reparto`). Las reglas de abajo usan esa
combinación.

### Los rechazos, con `code` estable (mismo patrón que CR-0002)

Todos son **409** con `{ error, code }` y, cuando aplica, los datos para que la tienda arme su propio texto:

| `code` | Cuándo | Datos extra |
|---|---|---|
| `requiere_cuenta` | Pago al retirar/recibir sin `accountId`, con las reglas prendidas | `requiredLevel` |
| `nivel_insuficiente` | La cuenta no llega al nivel que ese comercio pide para esa forma de pago | `requiredLevel`, `currentLevel` |
| `excede_tope_monto` | El total supera el tope del nivel | `maxTotalCents` |
| `excede_tope_productos` | La cantidad de renglones supera el tope del nivel | `maxItems` |
| `reparto_requiere_historial` | Reparto con pago al recibir sin retiros previos entregados en ese comercio | `requiredPickups` |
| `cuenta_bloqueada` | El comerciante bloqueó esa cuenta en su tienda | — |
| `libreta_no_activa` | Cuenta corriente con una cuenta sin libreta habilitada | — |

El mensaje de `cuenta_bloqueada` va a ser neutro a propósito («Este comercio no está tomando pedidos online
de esta cuenta; comunicate con el comercio»): no le contamos al comprador que lo bloquearon.

Mercado Pago no pasa por ninguna de estas reglas: está pago antes de que el comercio arme nada.

## 5. «Pendiente de confirmar»: ya existe, falta decir por qué

Hoy **ningún pedido se arma sin que el comerciante lo acepte**: todos nacen en `recibido` y el stock se
descuenta recién en `aceptado`. Un estado nuevo `pendiente_confirmar` antes de `recibido` sería una segunda
aceptación del mismo pedido, y además cambiaría el enum de estados que NexoTienda ya consume y los webhooks.

**Propuesta:** el pedido nace en `recibido` como siempre, con un campo nuevo `review` que NexoTienda puede
mostrar («El comercio va a confirmar tu pedido antes de prepararlo»):

```json
"review": { "reason": "cuenta_nueva_monto_alto" }
```

Motivos: `cuenta_nueva_monto_alto` (sin retiros previos y total sobre el umbral del comercio) y
`identidad_no_disponible` (ClubPay no contestó). En la pantalla de pedidos del comerciante, esos pedidos se
destacan con el motivo y «Aceptar» pide una confirmación extra. Si NexoTienda o ustedes necesitan que sea un
estado de verdad y no una marca, lo hacemos, pero preferimos no tocar el enum.

## 6. La configuración por comercio

En **Configuración → Tienda**, una sección «Pedidos con pago al retirar o recibir»:

- Interruptor «Pedir cuenta verificada» (`commerces.identity_rules_enabled`, default `false`).
- Por nivel: tope de monto, tope de renglones y si habilita pago al retirar / al recibir.
- Umbral de «revisar antes de aceptar» para cuentas nuevas, y cuántos retiros previos hacen falta para el
  pago al recibir (default 1).

Tabla `commerce_order_limits (commerce_id, verification_level, max_total, max_items, pickup_cash, delivery_cash)`,
una fila por nivel. Columnas planas, sin JSON, para que siga siendo mapeable a Odoo.

### Los valores de ejemplo

No los podemos proponer todavía con números: la base local tiene datos de demo y los tickets reales están en
producción. Proponemos **la regla** y los números salen de correr la consulta de abajo en el servidor:

| Nivel | Pago al retirar | Pago al recibir | Tope de monto | Tope de renglones |
|---|---|---|---|---|
| 0 | no | no | — | — |
| 1 | sí | sí, con 1 retiro previo | ticket p90 del comercio | renglones p90 |
| 2 | sí | sí | 2 × p90 | 2 × p90 |
| 3 | sí | sí | 4 × p90 | sin tope |

Umbral de revisión para cuentas nuevas: el **ticket p50**. El p90 deja pasar 9 de cada 10 compras normales
sin fricción y frena las del estilo «50 productos a nombre de alguien»; el monto se redondea hacia arriba a
múltiplos de $5.000.

Mejor todavía: que el **valor precargado se calcule al prender el interruptor, con los tickets de ese mismo
comercio** (últimos 90 días). Un súper y un kiosco no tienen el mismo ticket, y un número único para todo el
ecosistema queda corto para uno y largo para el otro. Si el comercio tiene menos de 100 tickets, se usa un
valor fijo que German define con la consulta.

Consulta para German (sólo lectura, probada en local):

```sql
WITH t AS (
  SELECT s.commerce_id, s.total,
         (SELECT count(*) FROM sale_items i WHERE i.sale_id = s.id) AS renglones
    FROM sales s
   WHERE s.refund_of IS NULL AND s.total > 0
     AND s.created_at > now() - interval '90 days'
)
SELECT c.name, count(*) AS tickets,
       round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY t.total)::numeric) AS monto_p50,
       round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY t.total)::numeric) AS monto_p90,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY t.total)::numeric) AS monto_p99,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY t.renglones) AS renglones_p50,
       percentile_cont(0.9)  WITHIN GROUP (ORDER BY t.renglones) AS renglones_p90,
       max(t.renglones) AS renglones_max
  FROM t JOIN commerces c ON c.id = t.commerce_id
 GROUP BY c.name ORDER BY tickets DESC;
```

**PENDIENTE DE VALIDAR:** los números concretos, con el resultado de esa consulta. German los aprueba.

## 7. `GET /v1/stores/:slug`

Mismo patrón que `acceptsMercadoPago`: la tienda no recalcula reglas, lee qué ofrecer.

```json
"orderRules": {
  "enabled": true,
  "levels": [
    { "level": 0, "pickupCash": false, "deliveryCash": false },
    { "level": 1, "pickupCash": true,  "deliveryCash": true, "maxTotalCents": 4500000, "maxItems": 25 }
  ],
  "deliveryCashRequiresPickups": 1
}
```

Con `enabled: false` va `{ "enabled": false }` y la tienda se comporta como hoy. Igual **el rechazo con
`code` manda**: lo que diga la vidriera puede estar cinco minutos viejo.

## 8. El slug hacia ClubPay

- Lo mandamos con `PUT /pos/storefront` cuando el comerciante elige o cambia el slug
  (`PUT /api/settings/tienda-slug`) y cuando publica o despublica la tienda (los dos campos `null`).
- Va por cola dentro de la misma transacción que el cambio, como el resto de los avisos salientes (regla 4
  de `CLAUDE.md`), con reintentos. Si ClubPay está caído, la tienda se publica igual.
- **Observación sobre quién arbitra.** El registro único de slugs ya vive en NexoPOS (tabla `slugs`,
  migración 028): es lo que impide que un comercio tome el slug de un pueblo o de otro comercio. Para ClubPay,
  por lo tanto, un 409 nunca debería pasar; si pasa, es que tiene un dato viejo, y lo dejamos en el log en vez
  de reintentar. Y «si llegan los dos, gana el último» es peligroso: un aviso atrasado de NexoB2B pisaría el
  slug nuevo. Proponemos que, cuando esto esté desplegado, **ClubPay tome el slug de comercio sólo de
  NexoPOS** y NexoB2B deje de mandarlo.

## 9. Bloqueo de una cuenta

`customers.tienda_bloqueada BOOLEAN` + motivo interno, en la ficha del cliente. Sólo afecta a ese comercio,
no hay lista global y no se le avisa a ClubPay. Bloquea pedidos nuevos; los que están en curso los resuelve
el comerciante a mano.

## 10. Respuestas a las preguntas del CR

**¿Sirve el contrato de ClubPay?** Sí, con los ajustes del punto 3 (idempotencia del `PUT`, el inverso de
`/libreta`) y la confirmación del punto 2 (una relación por persona y comercio).

**¿NexoPOS es el lugar de los topes? ¿Interruptor?** Sí a las dos. Interruptor por comercio, apagado por
defecto.

**¿Cómo asocian hoy el `account_id` con su cliente?** El comerciante da de alta al cliente en el mostrador y
lo vincula por DNI (`POST /pos/customers`); guardamos el `account_id` en `customers.clubpay_account_id` y le
pasamos a ClubPay nuestro `CLI-<n>` como `external_id`. Para las cuentas nacidas en la tienda, ver punto 2.
**Cómo evitamos libreta sin activar:** punto 1 — `libreta_activa`, que hoy no existe y es lo primero que hay
que hacer.

**¿El aviso al comerciante ya está?** **A medias, y no alcanza para esto.** Con NexoPOS abierto, la pantalla
mira cada 20 segundos, suena y muestra el contador en el menú. Con NexoPOS cerrado no hay ningún aviso: ni
mail, ni WhatsApp, ni push. Para pedidos que esperan revisión es imprescindible, como dice el CR. Lo
proponemos como **CR aparte**, porque es su propio problema (por qué canal, quién paga los mensajes, a qué
hora se deja de avisar) y no conviene que frene esto.

**Migraciones, nombres y orden de deploy:**

Una sola migración, `043_identidad_tienda.sql`:

- `customers`: `libreta_activa`, `origen` (`mostrador | tienda`), `tienda_bloqueada`, `bloqueo_motivo`,
  índice único `(commerce_id, clubpay_account_id)`.
- `commerces`: `identity_rules_enabled`, `review_threshold`, `delivery_cash_min_pickups`.
- `commerce_order_limits` (punto 6).
- `orders`: `verification_level` (el que tenía la cuenta al pedir, para poder explicar después por qué
  entró) y `review_reason`.

Orden:

1. **NexoPOS** deploya la migración, `libreta_activa` (punto 1) y el interruptor apagado. No cambia nada
   visible; cierra el agujero antes de que exista la primera cuenta nacida en la tienda.
2. **ClubPay** deploya su paso 1 y la consulta.
3. **NexoPOS** deploya el canje nuevo, las reglas, la configuración y el slug, probados contra el ClubPay real
   con un comercio de prueba.
4. **NexoTienda** deploya la redirección a ClubPay, `creditEnabled`, `orderRules` y los `code`.
5. Recién ahí se prende el interruptor, comercio por comercio.

Lo que puede empezar ya, sin esperar a nadie: el paso 1, la configuración y las reglas (con modo demo para
el nivel, como el resto de la integración con ClubPay).

---

## Agregado del 12 de octubre: después de leer a ClubPay y primer paso hecho

Leímos `cr-0003-nivel-para-nexopos.md` y las dos respuestas de ClubPay. El nivel, la consulta y el `PUT` del
número de cliente ya están en producción y **los vamos a usar tal cual**: el `PUT` contesta 200 si se repite el
mismo número y 409 si se intenta cambiarlo, que es lo que pedíamos en el punto 3. Comparamos el nivel con `>=`.

### Lo que sigue sin respuesta (para ClubPay)

1. **¿Se reusa la relación si la persona ya está vinculada por DNI?** Su respuesta dice «al aceptar, se crea la
   relación persona ↔ comercio», pero no qué pasa si esa relación ya existe. Es la pregunta más importante del
   punto 2: si se crea otra, la persona queda partida en dos clientes y sólo una tiene la libreta.
2. **El inverso de `POST /pos/accounts/:account_id/libreta`.** NexoPOS ya deja cerrar una libreta sin
   desvincular a la persona (ver abajo); ClubPay necesita enterarse.
3. **Quién manda el slug.** Siguen con «si llegan los dos, gana el último». Proponemos que, cuando NexoPOS empiece
   a mandarlo, ClubPay tome el slug de comercio sólo de NexoPOS (punto 8). Y como el bloqueante de su web de alta
   es que hay un solo comercio con `storefront_slug`, adelantamos ese envío: es lo próximo que construimos.

### Lo que ya está hecho en NexoPOS (sin deployar)

El punto 1 de esta respuesta, que no dependía de nadie:

- **Migración `043_libreta_activa.sql`** (en lugar de la `043_identidad_tienda` que anunciamos: la partimos en
  pasos). `customers.libreta_activa` nace en `false`, y lo que ya existía quedó en `true`; también suma
  `customers.origen` y `commerces.identity_rules_enabled` (apagado y todavía sin uso). El índice único
  `(commerce_id, clubpay_account_id)` queda para el paso del canje, después de revisar que en producción no haya
  repetidos: una migración que falla deja el servidor sin arrancar.
- El alta en el mostrador sigue abriendo la libreta, como siempre.
- **Sin libreta no se fía**: ni en el mostrador ni desde la tienda.
- La ficha del cliente tiene «Abrir libreta / Cerrar libreta». Cerrarla no borra la deuda ni frena los pagos.

**Para NexoTienda**, todo agregado:

- `GET /v1/cuentas/:accountId` suma `creditEnabled`. Con `false`, no ofrecer cargar a la cuenta.
- `POST /v1/orders` suma dos `code`: `libreta_no_activa` (409) y `falta_cuenta` (400, `cuenta_corriente` sin
  `accountId`). El segundo era un agujero viejo: se podía pedir a la cuenta con sólo nombre y teléfono, y al
  entregarlo salía una venta «a cuenta» que no le anotaba la deuda a nadie.

Y uno que no se ve pero importa para lo que viene: **al entregar un pedido, la deuda se anota sólo si se pagó a
la cuenta**. Antes alcanzaba con que el pedido tuviera cliente; con CR-0003, un pedido pagado en efectivo también
va a traer quién lo hizo, y se le habría cobrado dos veces.

---

## Segundo agregado, 13 de octubre: leída la respuesta de ClubPay, slug y libreta hechos

Leímos `respuesta-cr-0003-nexopos.md`. Quedan cerradas las tres preguntas: una relación por persona y comercio
(es un `UNIQUE` de su base), la libreta como espejo con `POST`/`DELETE`, y el slug sólo desde NexoPOS.

**Hecho en NexoPOS (sin deployar):**

- **Slug:** se manda con `PUT /pos/storefront` cuando el comerciante elige o cambia la dirección y cuando publica
  o despublica. Despublicada va con su slug y `storefront_published: false`, no con los dos en `null`: el slug
  sigue siendo suyo. **Si el comercio todavía no eligió dirección, no se manda nada**, para no apagar con un
  `null` una tienda que ClubPay tenga cargada desde Nexo B2B. Al deployar, los comercios que ya tienen dirección y
  clave de ClubPay se mandan solos una vez.
- **Libreta:** «Abrir / Cerrar libreta» en la ficha llama a `POST`/`DELETE …/libreta`. Si la persona acepta la
  vinculación después de que el comerciante le cerró la libreta, se manda el cierre en ese momento: del lado de
  ClubPay habría nacido abierta. A los clientes sin vínculo aceptado no se les manda nada.
- Si ClubPay no contesta, se reintenta (1, 5, 15 y 60 minutos, después cada 6 horas, durante unos dos días) y se
  manda el estado del momento, no la secuencia de cambios. **Un 409 de slug se deja de reintentar** y queda
  anotado para avisarles, como pidieron. **El 404 se reintenta**, porque es lo que contesta ClubPay mientras no
  despliega estas rutas.

**Orden de deploy:** da igual cuál va primero. Si NexoPOS deploya antes, los avisos esperan reintentando y
salen solos cuando ClubPay despliega, siempre que sea dentro de los dos días; si no, hay que volver a marcarlos.

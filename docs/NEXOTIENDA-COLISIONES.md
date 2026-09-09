# NexoTienda · lo que choca con NexoPOS hoy

Respuesta al pedido de la Parte A/B antes de construir, como pide el prompt.
Verificado contra el código, no de memoria.

Resumen: **la mayor parte no choca, falta construirla**. Pero hay cuatro cosas
que no son "falta hacerlo" sino contradicciones, y una de ellas contradice un
acuerdo ya cerrado con ClubPay. Esas cuatro se deciden antes de escribir código.

---

## 1. Los períodos contradicen lo que ya acordamos con ClubPay

**Es la más cara y va primera.**

A5 define el corazón de la cuenta corriente como una pila de períodos cerrados:
el cierre congela un resumen, hay estado por período, el mes en curso nunca se
mezcla, y la imputación va del más viejo al más nuevo.

NexoPOS no tiene nada de eso. Tiene `customers.balance` —un número— y
`customer_transactions`, un libro append-only. No hay corte, ni vencimiento, ni
resumen, ni fecha de cierre.

Eso, solo, sería "falta construirlo". El problema es otro:

**Ya le dijimos a ClubPay que no hay períodos, y ellos rehicieron su diseño en
consecuencia.** Está escrito en `docs/CLUBPAY-CUENTA-CORRIENTE.md`, que es el
contrato vigente entre los dos equipos. Textual de su respuesta:

> «Aceptamos su recomendación y el argumento: el almacenero cobra cuando el
> cliente pasa, no el día 10. Construir cierres para que la app los muestre
> sería inventarle al comercio una contabilidad que no tiene.»

Y en base a eso **eliminaron** `/account/statements`, sacaron el campo `period`
de los movimientos, y dejaron el pago sin `statement_id` porque "directamente no
existe". La pantalla de la cuenta en la app de ClubPay ya está construida así:
saldo corriente y movimientos agrupados por mes de forma visual, no contable.

Los dos diseños no pueden ser ciertos a la vez. Hay que elegir:

- **Construir períodos.** Es lo que pide este prompt y el argumento de A5 es
  bueno: un resumen es un documento estable, pagable y disputable, y "una suma
  que se mueve todo el tiempo" no lo es. Pero implica volver a ClubPay a pedirles
  que repongan lo que sacaron por pedido nuestro, y rehacer su pantalla.
- **Quedarse en saldo corriente.** No hay que tocar a nadie, pero entonces
  `AccountPeriod`, `closingDay` y el pago contra un resumen no existen, y
  NexoTienda tiene que mostrar otra cosa.

**Mi recomendación es construir períodos**, por una razón que no está en ninguno
de los dos documentos: cuando yo argumenté que no hacían falta, la cuenta
corriente se cobraba **solo en el mostrador**, donde el almacenero tiene a la
persona delante y le cobra lo que quiere. NexoTienda cambia eso: aparece el pago
online, y un pago online necesita algo concreto contra qué pagar. "Pagá lo que
quieras contra tu saldo" funciona en el mostrador y es confuso en una pantalla.

Pero es una decisión de producto y la tenés que tomar vos, no yo. Lo que no se
puede es construir períodos sin avisarle a ClubPay: su app quedaría mostrando un
modelo que el POS dejó de tener.

---

## 2. `personId` crea un cruce que hoy no existe — a propósito

`GET /v1/people/{personId}` devuelve `accounts[]`: las cuentas de esa persona en
**varios comercios**.

Hoy en NexoPOS no existe ninguna entidad "persona". Hay una fila de `customers`
por comercio, y la misma persona con cuenta en dos almacenes son dos filas sin
nada que las una. Eso no es una limitación que quedó: es lo que le contestamos a
ClubPay cuando preguntaron por P3, textual de nuestro documento:

> «de nuestro lado la separación no es una restricción de permisos que podamos
> equivocarnos en aplicar: los datos directamente no están juntos.»

Construir `person_id` crea exactamente ese cruce. **No viola P3** —la API es
servidor a servidor con ClubPay, y P3 prohíbe que lo vea un *comercio*— pero
convierte una imposibilidad estructural en una cuestión de permisos bien puestos.
Y los permisos se equivocan.

Si se construye, la condición es que el cruce viva detrás de una frontera
explícita: la API que consume el POS del comercio **nunca** puede llegar a
`/v1/people/{id}`, ni siquiera por accidente de routing. Hoy todo NexoPOS
autentica con un JWT por comercio; esto sería el primer endpoint que no.

---

## 3. La API key de plataforma es justo lo que ClubPay rechazó hace tres semanas

La Parte B autentica con `Authorization: Bearer <API_KEY>` servidor a servidor,
una clave que puede leer cualquier tienda y cualquier persona.

Nosotros les planteamos esa misma concentración de riesgo a ClubPay para los
endpoints de cuenta corriente, y su respuesta fue no usar una clave de
plataforma. Textual:

> «una clave de plataforma restringida a estos tres endpoints **sigue pudiendo
> escribir en la cuenta de todos los comercios**. El alcance del daño seguiría
> siendo el ecosistema entero.»

Movieron los endpoints a la clave de cada comercio. Ahora estaríamos
construyendo la imagen espejo del lado nuestro, con el argumento contrario.

No digo que esté mal: acá hay endpoints que **son** de plataforma y no de un
comercio —resolver un subdominio, buscar en el pueblo, listar los comercios de un
pueblo— y esos no tienen otra credencial posible. Lo que no cierra es que la
cuenta corriente de una persona con un comercio viaje con la misma llave que el
buscador del pueblo. Propongo separarlas: clave de plataforma para lo del pueblo,
clave del comercio para todo lo que toque su cuenta o su stock.

---

## 4. Push y pull para el mismo dato

Hace tres semanas construimos la integración de cuenta corriente con ClubPay como
**push**: cuando pasa algo, NexoPOS se lo empuja (`/pos/account/movements`), con
una cola, reintentos y recuperación. Está andando.

La Parte B define lo mismo como **pull**: ClubPay llama a
`GET /v1/people/{personId}/accounts/{storeId}` y se trae el estado.

Si quedan los dos sin decidir cuál manda, la app de ClubPay tiene dos fuentes
para la misma pantalla y van a discrepar.

Leyendo la lista de webhooks de la Parte B —que incluye "compra a cuenta
registrada en el mostrador"— me parece que la intención es coherente y conviene
escribirla: **pull para el estado, push para los avisos.** El pull siempre está
fresco y no acumula deriva; el push es lo que permite avisarle a la persona en el
momento. Con eso, lo que ya construimos no se tira: pasa a ser el canal de
webhooks.

---

## Lo que falta construir, sin contradicción

| | Estado hoy |
|---|---|
| **A1** política `stock`/`declared` | No existe; todo producto tiene stock. **Pero `products.origen` ya distingue `nexob2b`/`propio`**, así que el default por origen sale gratis. |
| **A1** cupo del día y reposición automática | No existe. El worker periódico ya está como patrón (`clubpay-outbox`). |
| **A2** receta como calculadora de costo | No existe. `stock_items.cost` guarda el último costo de compra, que es el insumo del cálculo. |
| **A3** flag de insumo | No existe. |
| **A4** señal por cadencia | No existe, **pero es computable hoy**: `purchase_orders` tiene el historial. Es lo más barato de toda la lista. |
| **A5** límite, pausa, cierre configurable, disputa | Nada existe. Se lo dijimos a ClubPay en su momento. |
| **A6** pedidos de clientes | No existe. Ojo: `purchase_orders` es la compra del comercio al mayorista, otra cosa. |
| **A7** Mercado Pago del comercio | No existe. |
| **Store** | `commerces` tiene nombre, email, CUIT, ciudad y provincia. Faltan slug, townSlug, dirección, teléfono, WhatsApp, logo, horarios, `verified`, `storefrontPublished`, slots, envío gratis, `acceptsOnlinePayment`, `allowsCredit`. |
| **Parte B** | No hay ninguna API `/v1`. Hoy todo cuelga de `/api` con JWT por comercio. |

---

## Tres trampas que conviene pinchar ahora

**El DNI viaja más de una vez, y no por descuido.** A5 dice que el DNI se usa una
vez para proponer y de ahí en más se trabaja con `person_id`. Hoy no podemos:
ClubPay **no avisa cuando alguien acepta la vinculación**, así que la única forma
de enterarse es volver a preguntar, y preguntar es mandar el DNI de nuevo. Lo
hacemos cada diez minutos. Para cumplir A5 hace falta que ClubPay nos dé o un
webhook de "aceptó" o una consulta por `external_id`. Es el mismo pedido que ya
resuelve el problema de que la propuesta quede semanas sin que la persona se
entere.

**"El comerciante recibe el aviso de que se vinculó" no se puede hoy**, por lo
mismo. Y es la mitad de la defensa contra un match equivocado de DNI: A5 dice que
hacen falta dos manos, y hoy tenemos una.

**Las fechas sin hora van a morder.** El prompt lo marca —"`2026-08-10` tiene que
significar el 10 de agosto en Argentina, no el 9"— y con períodos es donde más
duele: el día de cierre y la etiqueta del resumen son fechas sin hora, y todo lo
que hoy guardamos es `TIMESTAMPTZ`. Si el cierre se calcula en UTC, el resumen del
día 10 arranca a las 21 del 9. Se resuelve guardando el día de cierre como número
y calculando los límites del período en `America/Argentina/Cordoba`, explícito, no
por el timezone del servidor.

---

## Lo que necesito que decidas

1. **Períodos: ¿se construyen?** Si sí, hay que reabrir el tema con ClubPay. Es la
   única que bloquea toda la cuenta corriente.
2. **`person_id`: ¿lo emite NexoPOS o Nexo B2B?** El prompt dice "emitido por
   Nexo" sin decir cuál. Si lo emite B2B, NexoPOS lo guarda y listo; si lo emite
   NexoPOS, hay que definir cómo se reconcilian dos comercios que dieron de alta a
   la misma persona.
3. **Credenciales de la API: ¿una de plataforma o dos?** Ver el punto 3.
4. **Push o pull con ClubPay**, o los dos con roles separados.

De la lista de "lo que hay que acordar" del prompt, las que puedo contestar yo:
**la migración de stock existente (punto 4) no necesita decisión** —el default por
origen resuelve todo, porque `products.origen` ya está cargado— y **el vencimiento
del pedido (punto 1)** conviene que sea configurable con un default corto, pero
eso lo puedo proponer cuando construya A6.

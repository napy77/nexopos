# Cuenta corriente en la app · respuesta de NexoPOS

Respuesta a la propuesta de contrato de ClubPay. Va cómo funciona hoy la cuenta
corriente en NexoPOS, punto por punto, y qué hay que cambiar de cada lado para
que esto ande.

Adelanto lo que más cambia la forma de lo que propusieron: **NexoPOS no cierra
períodos**. Lleva un saldo corriente. El bloque de «resúmenes» de la propuesta,
hoy, no tiene de dónde salir.

## Las respuestas

### 1. ¿NexoPOS cierra períodos?

**No.** Hay un saldo corriente sin corte.

El modelo son dos tablas: `customers.balance` (un número, positivo si el cliente
debe) y `customer_transactions`, un libro append-only donde cada fila es un
hecho con importe con signo —positivo aumenta la deuda, negativo la baja— y el
saldo es la suma. No hay tabla de resúmenes, ni fecha de corte, ni vencimiento,
ni concepto de «mes cerrado». Nunca se pidió: el almacenero cobra cuando el
cliente pasa, no el día 10.

Esto le pega a dos cosas de la propuesta:

- El endpoint `/account/statements` no tendría qué recibir. No podemos empujar
  un resumen que no existe.
- El campo `period` en los movimientos tampoco tiene sentido hoy. Lo podemos
  mandar derivado de la fecha (`"2026-09"`), pero sería un mes calendario
  inventado por nosotros, no un período con significado contable. Si lo van a
  usar para agrupar en pantalla está bien; si lo van a usar para decir «este
  resumen está cerrado», no.

**Lo que proponemos**: arrancar solo con movimientos y saldo corriente. Es lo que
el comercio realmente tiene y alcanza para el objetivo que plantearon —que el
cliente vea lo que hoy está en el cuaderno—. La app muestra los movimientos y un
saldo, sin la división resumen/mes en curso, que en este modelo no existe.

Si más adelante quieren el cierre mensual, es construible de nuestro lado
(cerrar período = congelar un corte del libro y darle un id), pero es una
funcionalidad nueva de NexoPOS con su propia UI en el mostrador, no un campo que
podamos agregar al push. Decidan ustedes si vale la pena antes de la primera
versión; nuestra recomendación es que no.

Ojo con la regla 2 de su documento —«un resumen cerrado y el mes en curso nunca
se suman en un solo número»—. Con saldo corriente hay un solo número y es
correcto que lo haya: no se está mezclando nada, porque no hay dos cosas
distintas que mezclar. La regla sigue valiendo el día que existan períodos.

### 2. ¿Cómo identifica al cliente de cuenta corriente?

Con `customers.id`, un entero autoincremental. Es **estable** (nunca se
reasigna) y sirve como `external_id`. Se lo mandamos formateado, `"CLI-42"`.

Sobre la unicidad, que es donde está la trampa: el id es único en toda nuestra
base, así que `"CLI-42"` no es ambiguo. Pero **la ficha de cliente es por
comercio**: la misma persona con cuenta en dos almacenes son dos filas con dos
ids distintos, cada una con su saldo. No hay ninguna entidad «persona» que las
una de nuestro lado.

Esto juega a favor de su regla 3 —ningún comercio ve la deuda de esa persona con
otro— porque de nuestro lado la separación no es una restricción de permisos que
podamos equivocarnos en aplicar: los datos directamente no están juntos. La
unificación de las dos cuentas en una sola vista pasa solo del lado de ustedes,
por DNI, que es donde tiene que pasar.

Lo que no pueden asumir: que `external_id` identifica a una persona. Identifica
una cuenta en un comercio.

**Un detalle de `nexo_b2b_id`**: nuestro `commerces.nexob2b_id` es texto y puede
estar vacío. Un comercio que se dio de alta en NexoPOS sin vincularse a NexoB2B
todavía no tiene id de marketplace. Para esos, hoy, no podríamos ni siquiera
armar la URL de sus endpoints. Necesitamos saber qué quieren que hagamos: lo más
sano nos parece que ese comercio simplemente no participe de la integración
hasta que se vincule, y que lo digamos así en la config del POS.

### 3. ¿Admite pagos parciales hoy?

**Sí, y es lo único que admite.** Un pago es un importe libre contra el saldo del
cliente: entra cualquier número positivo, no está atado a ningún ticket ni a
ningún resumen. El almacenero anota «me dio $5.000» y listo.

Sobre la imputación: **no hay**, y no porque falte, sino porque sin períodos ni
comprobantes con vencimiento no hay a qué imputar. El pago baja el saldo global.
Ni el operador elige ni se aplica al más viejo primero: no hay «más viejo».

Así que el requisito que marcaron como imprescindible ya está cubierto por
construcción. El que no vamos a poder cumplir del otro lado es el
`statement_id` en el webhook de pago: no vamos a tener resúmenes contra los
cuales imputarlo. **Necesitamos que el webhook pueda venir sin `statement_id`,
como un pago a cuenta.**

### 4. ¿El fiado tiene límite por cliente?

**No existe hoy.** No hay columna de límite ni validación al vender en cuenta: se
puede fiar sin tope. El freno es el almacenero, que sabe a quién le fía.

Así que no hay nada que mostrar. Y aprovecho para decir que la advertencia que
hicieron sobre cómo mostrarlo —«Disponible: $18.000» y nunca «Tu límite es
$20.000»— nos parece bien pensada y la vamos a tener en cuenta si algún día
construimos la funcionalidad. Es exactamente el tipo de cosa que en un pueblo
hace daño y no se ve venir desde el código.

### 5. ¿Se puede pausar el fiado de un cliente?

**No existe tampoco.** No hay estado de cliente: no hay activo/pausado/bloqueado.
El almacenero, si no quiere fiarle más a alguien, no le fía; no se lo dice al
sistema.

Como con el límite: si se construye, lo comunicamos como plantearon. Coincidimos
con el fondo del argumento —que la persona pueda seguir comprando pagando de otra
forma, y que haya un humano del otro lado en vez de un botón apagado— y no nos
parece un detalle de redacción.

### 6. ¿Qué pasa si el cliente desconoce una compra?

**No hay un estado «en revisión».** El tipo de movimiento está cerrado a tres
valores: `sale_credit`, `payment` y `adjustment`. Lo que sí hay es cómo
resolverlo una vez que las dos personas hablaron: el `adjustment`, que es un
movimiento con importe libre y una nota de texto, y el reembolso, que anula el
ticket y genera el movimiento inverso. Además queda todo en un log de auditoría.

O sea: podemos registrar el desenlace, no la disputa abierta. Si quieren mostrar
«en revisión» en la app, por ahora es un estado que vive **solo de su lado**, y
nosotros les vamos a seguir mandando el saldo sin enterarnos. Nos parece
aceptable para empezar —coincide con que ClubPay no arbitra—, pero implica que
la app puede mostrar «en revisión» sobre un movimiento que para el comercio no
tiene nada raro. Que la redacción no sugiera que el comercio ya se enteró.

### 7. ¿Con qué frecuencia pueden empujar?

**En el momento.** NexoPOS es un solo backend con salida a internet —no corre en
la PC del comercio—, así que el push sale apenas se confirma la venta.

Con una condición que nos importa: **el aviso a ClubPay no puede hacer fallar la
venta**. Se manda después de que la venta ya está cerrada en nuestra base, y si
ClubPay no contesta se reintenta en segundo plano. Un problema de red del lado de
ustedes no puede dejar a un cajero sin poder cobrar. Esto significa que en una
caída larga la app va a estar desactualizada y que los movimientos pueden llegar
fuera de orden.

Por eso les pedimos dos cosas:

- Que **ordenen por `occurred_at`, no por orden de llegada**.
- Que la pantalla diga desde cuándo son los datos, como ya plantearon en su regla
  4. En nuestro caso no es un adorno: va a pasar.

## Lo que cambia de la propuesta

Además de lo de períodos, tres cosas concretas:

**El `kind` de los movimientos les falta un caso.** Proponen `compra` y `pago`.
Nos falta el ajuste —la corrección manual, que es justo el desenlace de la
pregunta 6— y el reembolso. Proponemos `compra | pago | ajuste | devolucion`, y
que el signo lo lleve el importe, no el tipo: así un ajuste que sube y uno que
baja son el mismo `kind`. Si prefieren que `amount_cents` sea siempre positivo y
el signo salga del `kind`, díganlo, pero entonces necesitamos dos tipos de
ajuste.

**El webhook de pago nos descuadra la caja si no lo pensamos.** Del lado nuestro
un pago de cuenta corriente se anota con la forma de pago y con la sesión de caja
abierta, porque el arqueo del día usa eso para calcular cuánta plata tiene que
haber en el cajón. Un pago hecho desde la app a las once de la noche no es
efectivo en el cajón y puede no tener ninguna caja abierta.

Lo vamos a registrar con forma de pago propia, `clubpay`, que aparece en el
arqueo como cobro del día pero no suma al efectivo esperado. Si entra con la caja
cerrada, queda sin sesión y el comercio lo ve en el saldo del cliente igual.
No necesitamos nada de ustedes para esto; lo decimos para que sepan por qué el
importe va a aparecer separado en el cierre del comercio.

**La clave de plataforma nos preocupa un poco.** Hoy cada comercio guarda su
propia clave de ClubPay, y el alcance del daño si se filtra una es ese comercio.
Lo que proponen es una clave única que puede escribir en la cuenta de cualquier
comercio del ecosistema. Vamos a poder guardarla como corresponde —vive en el
servidor, nunca sale al navegador, no entra en el repositorio— pero es una
concentración de riesgo que antes no existía. Si de su lado es fácil emitir una
clave de plataforma **solo con permiso sobre estos tres endpoints**, la
preferimos a una clave que además pueda leer socios o registrar transacciones.

## Lo que hay que construir

Del lado nuestro, para la versión que respondimos acá (sin resúmenes):

- Empujar los tres tipos de movimiento —compra en cuenta, pago en mostrador y
  ajuste/devolución— con reintento y sin bloquear la venta.
- Recibir el webhook de pago, que registra el pago y baja el saldo, tolerando
  reintentos: el mismo `clubpay_payment_id` no puede descontar dos veces.
- La forma de pago `clubpay` en el arqueo.
- En la ficha del cliente, el estado de vinculación, para que el almacenero sepa
  si esa persona ve su cuenta en la app o no.

La vinculación por DNI que ya tienen construida no la tocamos: la llamamos desde
el alta de cliente cuando hay DNI cargado.

No arrancamos hasta que respondan lo de períodos y lo de `nexo_b2b_id` vacío, que
son las dos que cambian el diseño.

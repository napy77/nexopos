# Lo que NexoPOS necesita de ClubPay

Cuatro cosas. **La primera es una marcha atrás nuestra** y la ponemos primera
por eso: les hicimos sacar algo y ahora se lo pedimos de vuelta.

Las otras tres son huecos que aparecieron poniendo la integración en la calle.

---

## 1. Los períodos vuelven. Perdón.

En su momento les dijimos que NexoPOS no cierra períodos y que arrancaran con
saldo corriente. Aceptaron el argumento y en consecuencia **eliminaron
`/account/statements`, sacaron el campo `period` de los movimientos y dejaron el
pago sin `statement_id`**. Su pantalla está construida así.

**Construimos períodos.** Ya está andando: cierre y vencimiento configurables por
comercio, pila de resúmenes por cliente, imputación del más viejo al más nuevo.

Lo que cambió no es que nos arrepentimos: es que cambió el problema. Cuando
dijimos que no hacían falta, **la cuenta corriente se cobraba solo en el
mostrador**, donde el almacenero tiene a la persona delante y le cobra lo que
quiere. Ahí un saldo corriente alcanza y sobra.

Ahora entra NexoTienda y con ella el pago online. **Un pago online necesita algo
concreto contra qué pagar.** "Pagá lo que quieras contra tu saldo" funciona
cuando hay un humano del otro lado del mostrador y es confuso en una pantalla. Y
un resumen es lo que hace que la deuda sea disputable: un documento que no se
mueve se puede discutir, una suma que cambia sola no.

Su regla 2 —«un resumen cerrado y el mes en curso nunca se suman en un solo
número»— vuelve a aplicar, y la respetamos: son dos objetos distintos y nunca
viajan sumados.

### Lo que hace falta reponer

**El movimiento vuelve a llevar `period`**, y ahora sí es un período de verdad y
no un mes derivado de la fecha:

```json
{
  "external_id":  "CLI-42",
  "movement_id":  "nexopos-mov-8891",
  "kind":         "compra",
  "amount_cents": 1240000,
  "occurred_at":  "2026-09-03T18:22:00Z",
  "description":  "Ticket #1",
  "period_id":    "nexopos-per-317"
}
```

**Vuelve el aviso de cierre**, con la forma que ustedes habían propuesto:

```
POST /pos/account/statements

{
  "external_id":  "CLI-42",
  "statement_id": "nexopos-per-317",
  "label":        "agosto 2026",
  "period_start": "2026-08-01",
  "period_end":   "2026-08-31",
  "total_cents":  4730000,
  "paid_cents":   0,
  "due_date":     "2026-09-10",
  "closed_at":    "2026-09-01T03:00:00Z"
}
```

Dos cosas de esto:

- **`label` lo mandamos nosotros y conviene mostrarlo tal cual.** Si el comercio
  cierra fin de mes decimos "agosto 2026"; si cierra el 10, el período no es
  ningún mes y decimos "11/08 al 10/09". Ponerle un nombre de mes a un período
  que no lo es sería mentir, y el que se come la confusión es el cliente.
- **`period_start` y `period_end` son fechas sin hora, y son de Argentina.** No
  las conviertan a UTC para guardar: el día 10 argentino arranca a las 21 del 9 y
  el resumen se corre un día entero. Nosotros ya nos comimos esa con las órdenes.

### Y el pago puede apuntar a un resumen

El webhook de pago acepta ahora un `statement_id` opcional:

```
POST https://nexopos.app/api/clubpay/webhook/pago
X-API-Key: <clave del comercio>

{
  "external_id":        "CLI-42",
  "amount_cents":       2000000,
  "paid_at":            "2026-09-05T14:03:00Z",
  "clubpay_payment_id": "pay_...",
  "statement_id":       "nexopos-per-317"
}
```

**Sigue siendo opcional y sigue admitiendo importe libre.** Sin él, imputamos del
resumen más viejo al más nuevo y lo que sobra queda a cuenta del período abierto
—la plata nunca queda colgada—. Con él, la persona paga el resumen que eligió en
la app.

Lo que **no** vamos a aceptar es que el pago lo impute el comprador entre varios
resúmenes a mano. Eso no existe en el cuaderno y genera discusiones; el único que
puede desviar la imputación es el comerciante, desde el mostrador.

---

## 2. Devuélvannos un `person_id`, pero solo cuando ya aceptó

Hoy `POST /pos/customers` contesta nombre, estado y mensaje. Ningún id. El motivo
que escribieron es bueno y no lo discutimos:

> «**No devuelve datos de la persona más que su nombre**: el comercio la tiene
> enfrente, y contestar más sería convertir esta ruta en un buscador de personas
> por DNI.»

Nuestra propuesta hace una distinción: **un identificador opaco no es un dato de
la persona.** No dice quién es, no sirve para buscarla y no significa nada fuera
del sistema.

Pero la regla de ustedes sigue valiendo donde importa, así que:

- Mientras el estado es `propuesta`, **no lo devuelvan.** Un DNI mal tipeado
  tiene que seguir sin revelar absolutamente nada.
- Cuando el estado es `vinculada`, sí: en ese punto la persona ya confirmó la
  relación con ese comercio.

```json
{
  "encontrado": true,
  "status": "vinculada",
  "persona": "Germán Yovan",
  "person_id": "prs_9f3a..."
}
```

**Para qué lo necesitamos**: hoy, para saber en qué quedó una vinculación,
volvemos a mandar el DNI. Cada diez minutos. El diseño acordado dice que el DNI se
usa una vez para proponer y de ahí en más se trabaja con un id opaco, y sin esto
no podemos cumplirlo. Además es lo que le permite a NexoTienda resolver quién es
la persona cuando entra desde la app, sin que el DNI viaje en ninguna URL.

---

## 3. Avísennos cuando alguien acepta

**Este es el que más duele.** Hoy ClubPay no avisa nada cuando una persona acepta
la vinculación: toca "aceptar" en su teléfono y de nuestro lado no pasa nada.

La consecuencia no era teórica. Como no mandamos movimientos de quien no aceptó
—que es la regla de ustedes y está bien—, una persona que había aceptado veía en
su app *"tu cuenta está vinculada"* y abajo, vacía. Compró fiado y no le apareció.

Lo tapamos preguntando cada diez minutos y recuperando lo que quedó afuera, pero
es un parche: gasta llamadas, manda el DNI de más y llega tarde.

Con cualquiera de estas dos alcanza:

```
POST <url que les damos>          ← preferimos esta
{ "external_id": "CLI-42", "person_id": "prs_...", "status": "vinculada" }
```

o una consulta de solo lectura por `external_id`, que no proponga nada y no
mande DNI.

Y hay una segunda razón, que es de diseño y no de plomería: el acuerdo dice que
**el comerciante recibe el aviso de que se vinculó**, y esa es la mitad de la
defensa contra un match equivocado de DNI —hacen falta dos manos—. Hoy tenemos
una sola.

---

## 4. Una cosa que no es nuestra pero la vemos desde acá

**No hay notificación push cuando un comercio propone la vinculación.** Miramos:
no hay envío de push en el backend. La propuesta se escribe en
`merchant_customers` y espera a que la persona abra la app por su cuenta.

En el mostrador eso se ve así: el almacenero le dice "te mandé la invitación", la
persona abre ClubPay en ese momento y no hay nada, porque estaba en otra pantalla.
O peor, no abre la app en dos semanas y la propuesta envejece sin que nadie sepa
que existe.

No es un pedido de integración —no necesitamos nada de esto para funcionar— pero
si la vinculación es la puerta de entrada a toda la cuenta corriente, conviene
que la puerta suene.

---

## Lo que sigue pendiente de antes

- **Confírmennos la autenticación del webhook de pago.** Quedó abierta de su lado
  y la resolvimos con la clave del comercio en `X-API-Key`: es un secreto que las
  dos partes ya comparten, no agrega exposición y mantiene que el alcance del
  daño sea un comercio. Además verificamos que el cliente pertenezca a ese
  comercio. **Está andando así**; solo falta que digan que les sirve.
- **No hay anulación de un descuento ya aplicado.** Un reembolso de venta con
  ClubPay revierte de nuestro lado y deja el `transaction_id` en el log. Sigue
  esperando un endpoint.

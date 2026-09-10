# NexoPOS → NexoTienda: qué construimos y qué cambia del contrato

Respuesta al prompt de la Parte A/B. Tres bloques: **lo que cambia de lo que
especificaron** (leer primero, toca `types.ts`), **lo que ya está andando**, y
**lo que necesitamos que decidan**.

---

# 1. Lo que cambia del contrato

## 1.1 `GET /v1/people/{personId}` no lo vamos a exponer

Es el cambio grande. El endpoint devuelve `accounts[]` —las cuentas de una
persona en varios comercios— y eso obliga a que NexoPOS tenga el mapa de en qué
comercios debe cada uno.

**No podemos emitir ese id y no deberíamos tener ese mapa.**

No podemos emitirlo porque NexoPOS no puede saber que el "Juan Pérez" del almacén
y el de la ferretería son la misma persona. Lo único que tiene es un DNI tipeado
en cada mostrador —el dato que el propio prompt dice que no puede ser la clave
del sistema, porque se tipea mal—. Si lo emitiéramos igual, dos comercios darían
dos ids para la misma persona y `accounts[]` tendría siempre un elemento.

No deberíamos tener el mapa porque hoy **que un comercio no vea la deuda de un
cliente con otro no es un permiso que podamos equivocar: los datos no están
juntos.** No hay columna para cruzarlos. Ese mapa los junta, adentro del sistema
donde se loguean los comerciantes. Sigue sin violar P3 —la API es servidor a
servidor— pero cambia una imposibilidad estructural por un chequeo de permisos.

Y hay una razón más simple: **el mapa ya existe, en ClubPay.** Su tabla
`merchant_customers` tiene `merchant_id, user_id, external_id`. Dado un usuario
ya sabe en qué comercios tiene cuenta. Construir el mismo mapa acá serían dos
copias de la misma verdad, que se van a separar.

P3 ya lo dice, textual: *«El total del pueblo lo calcula ClubPay para mostrárselo
al deudor y nada más.»* Si la vista agregada es de ClubPay, el mapa también.

**En su lugar:**

```
GET /v1/stores/{storeId}/accounts/{externalId}   →  MerchantAccount
                                                    404 si no tiene cuenta ahí
```

Y esto alcanza para todo, por algo que definimos con el equipo de producto: **la
cuenta corriente se abre siempre en el mostrador, en persona.** No existe que
alguien entre a la tienda de SuperSOL, cargue el changuito y elija "cuenta
corriente" sin tener acuerdo previo: **esa opción está grisada** hasta que vaya al
comercio. Si quiere comprar igual, paga con ClubPay, con billetera o al recibir
—lo que ese comercio acepte.

O sea que NexoTienda nunca necesita *"todas las cuentas de esta persona"*.
Necesita *"esta persona, esta tienda"*, que es un 404 o un objeto.

El `person_id` sigue existiendo, es **uno solo y compartido entre comercios**, y
lo emite ClubPay —el único sistema del ecosistema con una cuenta de consumidor—.
NexoPOS lo guarda en la ficha del cliente de cada comercio. Ya se lo pedimos a
ClubPay: hoy no lo devuelven.

## 1.2 `availableCents` puede no ser un número

`MerchantAccount.availableCents: number` asume que siempre hay límite. **Sin
límite es el default y va a ser el caso más común**, porque así funciona el
cuaderno: ponerle un tope a todo el mundo el día que se enciende esto sería
cambiarle las reglas a relaciones que ya existen.

```ts
availableCents: number | null   // null = sin límite
```

Ojo con resolverlo mostrando `0`: sería exactamente al revés de la verdad. Y ojo
con mostrar "sin límite" en la pantalla del comprador —es un dato de la relación,
no un premio—. Sugerencia: cuando es `null`, no mostrar la línea.

Lo que sí les pedimos que respeten, porque es la razón de que el campo se llame
así: **"Disponible: $18.000", nunca "Tu límite es $20.000".** Mismo número, dos
objetos sociales distintos.

## 1.3 Tres campos más en `MerchantAccount`

```ts
creditPaused: boolean        // ya estaba
onlineCreditEnabled: boolean // ya estaba, pero ojo: default FALSE
label / dueDate en periods   // ver abajo
```

**`onlineCreditEnabled` arranca apagado.** Es para el comerciante conservador que
quiere entrar sin abrir de una la compra fiada desde casa. La tienda tiene que
manejar el caso "tiene cuenta corriente, no puede usarla acá" — que no es lo
mismo que no tener cuenta ni que estar pausado, y merece un texto distinto.

**Los cuatro estados que dejan la opción grisada**, y conviene que cada uno tenga
su mensaje porque significan cosas distintas:

| Situación | Qué decir |
|---|---|
| No tiene cuenta en esa tienda (404) | "Para comprar en cuenta, hablá con el comercio" |
| El comercio no habilitó fiado online | "Este comercio toma la cuenta solo en el mostrador" |
| `creditPaused` | "Para seguir comprando en cuenta, hablá con {comercio}" + botón de contacto |
| Sin disponible | "Te queda $0 disponible" |

Sobre el pausado, y esto nos importa: **no esconder el botón, explicarlo, y con la
puerta al humano al lado.** Un botón apagado a las once de la noche, sin nadie del
otro lado, es una humillación. Y la persona **puede seguir comprando** pagando de
otra forma: se pausó el crédito, no el comercio.

## 1.4 `AccountPeriod`: qué mandamos y qué no

Se implementó tal cual, con dos precisiones:

- **`label` lo calculamos nosotros y conviene mostrarlo tal cual.** Si el comercio
  cierra fin de mes es "agosto 2026"; si cierra el 10, el período no es ningún mes
  y es "11/08 al 10/09". No lo reescriban a nombre de mes: sería mentir sobre qué
  abarca.
- **`entries[]` todavía no viaja dentro del período.** Los movimientos existen y
  están atados a su período; falta exponerlos anidados. Si lo necesitan para la
  primera versión, díganlo y lo agregamos; si alcanza con el total y el estado,
  lo dejamos para después.

`status` es `abierto | cerrado | pagado_parcial | pagado`, como pidieron. El
abierto **nunca** trae `dueDate` ni total congelado: es lo que todavía está
pasando.

## 1.5 Fechas

Las fechas sin hora se calculan en `America/Argentina/Cordoba`, escrito y no
heredado del servidor, y viajan como `YYYY-MM-DD`. **No las conviertan a `Date`
para formatear** sin fijar la zona: `new Date('2026-08-10')` en un navegador al
oeste da el 9 de agosto. Es la trampa que ustedes mismos marcaron en el prompt.

---

# 2. Lo que ya está andando

## Disponibilidad (A1) — completo

`Availability` está implementado tal cual el tipo, con los tres casos.

- El default lo da el origen —canónico → `stock`, propio → `declared`— y **el
  comerciante lo puede dar vuelta**, porque la panadera que envasa su dulce de
  leche en frascos tiene doce frascos reales.
- Los tres estados de `declared`: disponible sin contador, cupo del día, agotado.
- **El cupo se repone solo**, y se resuelve comparando fechas en vez de con una
  tarea a las 00:00: una tarea no corre si el servidor estaba caído, y entonces la
  tienda amanece en cero y parece cerrada.
- **Vender una pizza no descuenta queso.** Sale del inventario nada; si hay cupo,
  baja el contador.
- "Se acabó" es un POST **sin cuerpo**: un botón, nada que completar.

Sobre `unknown`: va a aparecer de verdad, en productos que el comercio todavía no
configuró. Muéstrenlo como acordamos —"consultá disponibilidad", y dejar pedir
igual—, nunca como cero.

## Cuenta corriente con períodos (A5) — el núcleo

- Cierre y vencimiento **configurables por comercio**. Un 31 en febrero se recorta
  al 28 sin desbordar el período.
- Pila por cliente: los cerrados del más viejo al más nuevo, el abierto aparte.
  **El mes en curso nunca se suma con los cerrados.**
- **Pago parcial**, imputado del más viejo al más nuevo, con override del
  comerciante. Lo que sobra queda a cuenta del período abierto: la plata no queda
  colgada. El comprador nunca elige la imputación.
- **Límite y pausa por cliente.** Probado: con la cuenta pausada la venta a cuenta
  se rechaza y **la misma venta en efectivo sale igual**.
- **El ritmo de pago**: "pagó 6 de 6 cierres, en promedio el día 9". Describe, no
  califica. Sin resúmenes cerrados devuelve `null`, no un cero que se confunde con
  estar al día.

Ejemplo real de la prueba, para que vean la forma:

```
[       cerrado] agosto 2026      total $120.000  pagado $0        vence 2026-09-10
[       abierto] septiembre 2026  total $ 45.000  pagado $0

  → paga $100.000 →

[pagado_parcial] agosto 2026      total $120.000  pagado $100.000  falta $20.000
[       abierto] septiembre 2026  total $ 45.000  pagado $0
```

## Insumos (A3)

El flag existe: lo que el comercio compra para usar y no para vender no aparece en
góndola ni en la tienda. **Fíltrenlo igual del lado de ustedes si les llega**, por
las dudas.

---

# 3. Lo que falta, en orden

| | |
|---|---|
| **A4** cadencia de reposición | No empezado. Es el más barato: el historial de compras ya está. |
| **A2** receta como calculadora de costo | No empezado. |
| **Campos de `Store`** | `commerces` tiene nombre, email, CUIT, ciudad, provincia. Faltan slug, townSlug, dirección, teléfono, WhatsApp, logo, horarios, `verified`, `storefrontPublished`, slots y envío gratis. **`storefrontPublished` ya existe.** |
| **A6** pedidos | No empezado. `purchase_orders` es la compra al mayorista, otra cosa. |
| **A7** Mercado Pago | No empezado. |
| **La API `/v1`** | No empezada. Bloqueada por la decisión de abajo. |

---

# 4. Lo que necesitamos que decidan

**1. Credenciales de la API, y es la que bloquea.**

La Parte B usa una `Bearer <API_KEY>` de plataforma que puede leer cualquier
tienda y cualquier persona. Les planteamos exactamente esa concentración de
riesgo a ClubPay hace unas semanas, para sus endpoints de cuenta corriente, y su
respuesta fue no usar una clave de plataforma:

> «una clave de plataforma restringida a estos tres endpoints **sigue pudiendo
> escribir en la cuenta de todos los comercios**. El alcance del daño seguiría
> siendo el ecosistema entero.»

La movieron a la clave de cada comercio. Estaríamos construyendo la imagen espejo
con el argumento contrario.

**Proponemos dos credenciales**, porque acá hay dos clases de endpoint:

- *De plataforma*: resolver un subdominio, listar los comercios de un pueblo,
  buscar en el pueblo. No tienen otra credencial posible.
- *Del comercio*: su catálogo, su stock, las cuentas de sus clientes, sus pedidos.
  Van con la clave de ese comercio.

Lo que no cierra es que la cuenta corriente de una persona viaje con la misma
llave que el buscador del pueblo.

**2. `entries[]` dentro de `AccountPeriod`: ¿lo necesitan para la v1?** (ver 1.4)

**3. Vencimiento del pedido**: cuántos minutos y si es configurable. Lo definimos
cuando construyamos A6, pero si tienen número, mejor.

**4. Canal de aviso al comercio.** Anotamos que WhatsApp puede ser la respuesta
buena y no un parche; la cuenta de WhatsApp Business API la tiene que hacer
alguien.

---

## Y una que ya contestamos nosotros

**Migración del stock existente**: no hace falta decisión. `products.origen` ya
distingue canónico de propio y está cargado, así que el default por origen
resuelve todo. Los cruzados los da vuelta el comerciante desde la ficha.

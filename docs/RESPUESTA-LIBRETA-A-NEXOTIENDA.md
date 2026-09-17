# La libreta: las cuatro preguntas

Antes que nada: **nos falta el documento**. El mensaje termina en "la lista
completa está al final" y llegaron sólo estas cuatro. Contestamos éstas y
esperamos el resto.

---

## 1. "Ve su cuenta en ClubPay": es un vínculo hecho y aceptado por la persona

Empiezo por ésta porque es la que les cambia el diseño.

No es una invitación ni un permiso del comerciante. **Es el estado final de una
propuesta que la persona aceptó desde su app.** El comerciante no puede
otorgarlo: propone, y decide el otro.

Los cuatro estados que existen hoy, tal cual los muestra la pantalla:

| Estado | Qué dice la pantalla | Qué significa |
|---|---|---|
| `propuesta` | "Vinculación propuesta" | Le llegó a su app y todavía no la aceptó. **No ve nada.** |
| `vinculada` / `aceptada` | "Ve su cuenta en ClubPay" | Aceptó. Cada compra y cada pago le aparecen. |
| `rechazada` | "No quiso vincular" | Dijo que no. La cuenta corriente sigue funcionando en el mostrador. |
| `sin_cuenta` | "Sin cuenta en ClubPay" | Ese DNI no está en ClubPay. **No es una falla** y por eso no va en rojo: la mayoría de los clientes de un almacén no tienen la app. |

Por qué nace como propuesta y no como vínculo hecho: en el mostrador se tipean
DNI mal, y un dígito de más hace que el match caiga en otra persona que abre la
app y ve la deuda de un desconocido.

**Para el diseño de ustedes, lo importante:** sólo `vinculada`/`aceptada` tiene
un `account_id`, y sin `account_id` no hay libreta que mostrar. Los otros tres
estados no son "todavía no cargó": son "no hay nada que mostrarle a esta
persona", y cada uno por un motivo distinto que conviene contar distinto.

## 2. El canje del token: es nuestro, y no existe todavía

Es endpoint **nuestro**. El reparto que acordamos con ClubPay:

```
la app pide el token      → ClubPay
NexoTienda lo canjea      → NexoPOS
NexoPOS contesta          → de qué account_id se trata
```

**Pero no existe de ningún lado todavía**, ni la emisión de ClubPay ni nuestro
canje. Lo dijimos en su momento y sigue igual.

Lo que nos falta definir con ClubPay es cómo verificamos un token que emitieron
ellos. La forma que vamos a proponer, para que sepan a qué apuntar:

```
ClubPay, al emitir:   POST /api/clubpay/handoff   (clave del comercio)
                      { account_id, token }  → lo guardamos hasheado, vence a los 2 min

NexoTienda, al canjear: POST /v1/accounts/session  (clave `cuentas`)
                      { token }  → { accountId, storeId }  y el token muere
```

Un solo uso y dos minutos, guardado hasheado. Es el mismo patrón que ClubPay ya
tiene en producción para el salto de NexoB2B a su panel.

**Lo que no cambia para ustedes:** no construyan la sesión asumiendo un id en la
query string. Un id permanente en un link es una credencial que no vence nunca
—queda en el historial, en los logs, en el `Referer` y en el WhatsApp donde
alguien reenvíe la URL— y después hay que deshacerlo.

Si quieren, construimos nuestras dos mitades ya y quedan esperando a ClubPay.

## 3. Deduplicación de clientes: **no hay, y es un problema**

La respuesta corta es que no. Fuimos a mirar y no hay índice único ni chequeo al
dar el alta: en el mismo comercio pueden existir dos "Juan Pérez" con el mismo
DNI, cada uno con su saldo.

Nunca dolió porque el almacenero busca por nombre y ve una sola línea. Con lo
que están construyendo sí duele, y la pregunta que lo destapa es la de ustedes:
**si esa persona entra a ver su libreta y hay dos, ¿cuál es la suya?**

No lo arreglamos por las nuestras todavía porque hay que decidir dos cosas que
no son técnicas:

- **Qué hacemos con los duplicados que ya existen.** Fusionar dos cuentas es
  sumar saldos y mover movimientos, y si la fusión está mal, alguien queda
  debiendo lo que no debe. Nos parece que eso lo tiene que confirmar el
  comerciante, cliente por cliente, no un script.
- **Si el DNI pasa a ser obligatorio.** Hoy no lo es, y la mayoría de las
  libretas no lo tienen: son "Doña Rosa" y nada más. Exigirlo rompe el alta de
  mostrador, que tiene que seguir siendo escribir un nombre y listo.

Lo que sí podemos hacer ya, y proponemos: **avisar en el alta** cuando ese DNI
ya está en otra ficha del mismo comercio, y ofrecer usar la que existe. Evita
que nazcan nuevos duplicados sin tocar los que hay.

Mientras tanto, para el canje: si un `account_id` resuelve a más de una ficha,
**no vamos a elegir una**. Preferimos contestarles que hay ambigüedad a mostrarle
a alguien la libreta equivocada. Díganos qué prefieren ver en ese caso.

## 4. El QR de vinculación al dar el alta: no hoy, y depende de ClubPay

Hoy la vinculación va por DNI y nada más: al guardar el cliente con documento,
se le propone sola, y la persona decide desde su app.

No hay QR en ese circuito. Sí tenemos la maquinaria —el cobro por QR del
mostrador ya genera uno— así que del lado nuestro es poco. Lo que falta es que
ClubPay acepte iniciar una vinculación desde un QR escaneado, que hoy no existe:
su endpoint recibe un DNI.

Nos parece buena idea y por un motivo que no es la comodidad: **con QR el DNI no
se tipea**, y el error de tipeo es exactamente lo que nos obligó a que esto
naciera como propuesta. Pero es un pedido a ClubPay, no algo que podamos
resolver entre ustedes y nosotros.

Si les sirve, lo escribimos y se lo mandamos.

---

## Lo que necesitamos

El resto de la lista. Y que nos digan si quieren que construyamos las dos
mitades del canje ahora o esperamos a que ClubPay especifique la suya.

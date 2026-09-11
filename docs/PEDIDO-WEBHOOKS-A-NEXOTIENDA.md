# Los webhooks de pedidos: necesitamos una URL y un secreto

Es lo último que queda del documento de pedidos. Está **construido y andando
contra un receptor de prueba**; lo único que falta para encenderlo es que nos
den dos datos.

---

## Lo que necesitamos

```
NEXOTIENDA_WEBHOOK_URL     https://… (una sola, para todos los eventos)
NEXOTIENDA_WEBHOOK_SECRET  el que nos den; viaja en Authorization: Bearer
```

Una URL sola y no una por evento: el nombre del evento va en el cuerpo y
ustedes rutean. Si después quieren separarlas, es cambiar una variable.

El secreto lo emiten ustedes y lo mandamos en cada llamada. Es el mismo esquema
que usamos con ClubPay en las dos direcciones y no inventa nada nuevo: si se
filtra, lo rotan y listo.

---

## Lo que les vamos a mandar

```
POST <su URL>
Authorization: Bearer <el secreto>
Content-Type: application/json

{
  "event": "order.aceptado",
  "event_id": "evt-8891",
  "occurred_at": "2026-09-11T14:03:00Z",
  "order": { …el Order completo, igual que GET /v1/orders/:code… }
}
```

**Va el `Order` entero y no solo lo que cambió.** Así no tienen que volver a
preguntarnos para pintar la pantalla, y un evento que llega tarde igual trae el
estado con el que salió. Es el mismo objeto que ya conocen, así que no hay una
forma nueva que mantener.

Los eventos:

| `event` | Cuándo |
|---|---|
| `order.aceptado` | El comercio aceptó. Trae `readyEstimate` |
| `order.listo` | |
| `order.en_camino` | Solo si el slot es de reparto |
| `order.entregado` | |
| `order.cancelado` | Trae `cancelReason` y `cancelledBy` |

No mandamos `order.recibido`: ese pedido lo crearon ustedes y ya lo tienen.

---

## Tres cosas que conviene acordar ahora

### El `event_id` es para que un reintento no cuente dos veces

Si se corta la red después de que ustedes lo recibieron, lo reintentamos. **Con
el mismo `event_id`.** Guárdenlo y descarten el repetido: sin eso, un pedido
podría mandar dos notificaciones al comprador por la misma cosa.

### Pueden llegar fuera de orden

Reintentamos con espera creciente, así que un `aceptado` que falló puede llegar
después de un `listo` que salió bien. **Ordenen por `occurred_at`, no por orden
de llegada** —o, más simple, confíen en el `status` del `order` que viene
adentro, que siempre es el del momento del evento—.

Es la misma cicatriz que ya nos dejó la cola de ClubPay.

### Contesten rápido y con 2xx

Cualquier cosa que no sea 2xx la tomamos como "no llegó" y la reintentamos: 1
min, 5, 15, 1 h y después cada 6 h, hasta doce intentos. Si van a hacer trabajo
pesado con el evento, contesten primero y trabajen después.

**Y que su servidor esté caído no puede frenar al comerciante**: el aviso se
escribe en la misma transacción que el cambio de estado, pero la llamada sale
después, afuera. Si no salen, se acumulan y salen todas juntas cuando vuelvan.

---

## Dos cosas más, que no son de webhooks pero les tocan

**Se están tragando nuestros mensajes de error.** Cuando el pedido de Jure no
entraba, nuestra respuesta decía exactamente qué faltaba —"Esa franja no es de
este comercio"— y el comprador vio "No pudimos mandar tu pedido". El botón de
hablar con el comercio está bien como salida, pero el motivo tendría que llegar
al log de ustedes por lo menos: nos costó una tarde de ida y vuelta para algo
que estaba escrito en la respuesta.

**Hay un `kind` nuevo en `GET /v1/hosts/{sub}` que no está en su `types.ts`:**

```ts
{ kind: 'moved'; slug: string }   // el actual del comercio
```

Es lo que devuelve cuando el subdominio es un slug que el comercio dejó atrás.
Acá los links viajan por WhatsApp —el estado del súper, el grupo del barrio— y
un comercio que cambia de dirección no puede dejar muertos todos los que ya
circularon. Redirijan al `slug` que viene.

---

## Para encender

Nos pasan la URL y el secreto, los ponemos en el `.env` y empiezan a salir. No
hace falta que desplieguen nada primero: si todavía no están listos para
recibirlos, los reintentos se acumulan y entran solos cuando levanten.

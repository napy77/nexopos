# Contratos entre sistemas

No es la referencia completa de la API. Es **lo que no se puede romper sin
romperle algo a otro equipo**.

Regla general: un campo que otro sistema lee es un contrato. Cambiarle el
nombre, el tipo o el significado exige avisar antes, y casi siempre exige
convivencia temporal de las dos formas.

---

## 1. Identificadores

| Campo | Forma | Quién lo emite | No se puede |
|---|---|---|---|
| `storeId` | `commerces.id` como **string** | NexoPOS | cambiar a número |
| `accountId` | `CLI-<customers.id>` | NexoPOS | **confundirlo con el `account_id` de ClubPay** |
| `productId` / `id` de producto | `products.id` como string | NexoPOS | — |
| `orders.code` | `P-XXXXXXXX` | NexoPOS | cambiar el formato: lo tiene el comprador |
| `external_id` hacia ClubPay | `CLI-<customers.id>` | NexoPOS | — |
| `presentacion_id` | `pp_…` | NexoB2B | — |
| `pmp_id` | `pmp_…` | NexoB2B | — |
| `nexob2b_id` de comercio | `com_…` | NexoB2B | — |

**El más fácil de equivocar:** `accountId` en `/v1` es **el nuestro**,
`CLI-4231`, no el `account_id` que devuelve ClubPay en el canje. `POST /v1/orders`
ya lo acepta con esa forma. Si el canje devolviera el de ClubPay, la sesión
abriría bien y el primer pedido a la libreta fallaría.

## 2. Importes

**Toda la frontera `/v1` va en centavos enteros.** Adentro es `NUMERIC` en
pesos; la conversión ocurre en esa frontera y en ningún otro lado.

| Campo | Significa |
|---|---|
| `priceCents` | lo que se cobra, **con el descuento de campaña ya aplicado** |
| `listPriceCents` | el precio de antes, **sólo cuando hay diferencia** |
| `balanceCents` | saldo de la libreta |
| `limitCents` / `availableCents` | **`null` = sin límite**, y es el caso más común |
| `totalCents` / `subtotalCents` / `feeCents` | del pedido |
| `expectedTotalCents` | lo que la tienda le mostró al comprador (entrante) |

**Nunca resolver `availableCents: null` mostrando 0.** Es exactamente al revés
de la verdad.

## 3. Precios y campañas

Contrato central: **el precio llega con el descuento ya aplicado**. Si la tienda
multiplicara el porcentaje, el changuito diría un número y la nota de venta
otro.

Eso obliga a que el descuento se aplique en **tres** consultas: la lista de
productos, la ficha de un producto y el cálculo del pedido. La expresión vive en
`backend/src/modules/campanas-precio.ts` y las tres la importan.

| Campo de `Campaign` | Significado actual |
|---|---|
| `name` | el título de la sección, tal cual se muestra |
| `startsAt` / `endsAt` | bordes del día en la zona del comercio |
| `discountPercent` | **el más alto de la tanda** — se lee como "hasta X%" |
| `productIds` | **en el orden que eligió el comerciante**, no alfabético |

Dos cambios de significado ya avisados y vigentes:
- `discountPercent` dejó de ser *el* descuento cuando pasó a ser por producto.
- `productIds` dejó de venir ordenado por id. **NexoTienda no debe reordenarlo**:
  la tienda muestra los primeros y el resto va a "Ver todos".

Reglas de resolución: con dos campañas sobre el mismo producto gana **el precio
más bajo**, no se acumulan; y una campaña **sólo puede bajar** el precio.

## 4. Disponibilidad

```ts
{ policy: "stock",    onHand: number }
{ policy: "declared", state: "available" | "out", quota?: { total, remaining } }
{ policy: "unknown" }
```

- `unknown` significa **no sabemos**, no "cero". La tienda muestra "consultá
  disponibilidad" y deja pedir igual.
- `showsOutOfStock: false` en el `Store` significa que los productos sin stock
  **no vienen en la lista**. El `productCount` del árbol cuenta lo mismo que la
  lista: una solapa nunca promete lo que la lista no trae.
- Un producto escondido **sigue llegando por su enlace directo**. Un link
  compartido por WhatsApp no tiene por qué romperse.

## 5. Pedidos

Estados (CHECK en la base): `recibido`, `aceptado`, `listo`, `en_camino`,
`entregado`, `cancelado`.

Pago: `efectivo_entrega`, `online`, `cuenta_corriente`.
Estado de pago: `no_aplica`, `pendiente`, `pagado`, `rechazado`.

Eventos del webhook hacia NexoTienda: `order.aceptado`, `order.listo`,
`order.en_camino`, `order.entregado`, `order.cancelado`. **Viaja el pedido
entero**, no sólo lo que cambió: así un aviso que llega tarde trae el estado con
el que salió.

**Los totales los calcula NexoPOS.** El precio y el nombre quedan congelados en
la línea del pedido.

## 6. La libreta

```
POST /v1/cuentas/canjear   { token, storeId }
  → { accountId, storeId, displayName, linkedAt }

GET  /v1/cuentas/:accountId?storeId=
  → { accountId, storeId, displayName, balanceCents, limitCents,
      availableCents, paused, onlineEnabled, closingDay, dueDay,
      currentPeriod: { from, to, dueDate }, linkedAt }
```

- **`storeId` es obligatorio en el canje.** Sin él no sabemos con qué clave de
  ClubPay preguntar.
- **`linkedAt` es la única revocación que existe.** Se mueve cuando el vínculo
  cambia de estado o de cuenta, y **no** en una consulta de rutina. NexoTienda
  guarda el valor al abrir la sesión y lo compara contra el actual: si cambió,
  la sesión murió.
- **`paused` y `onlineEnabled` son cosas distintas.** "No podés cargar" no es lo
  mismo que "este comercio no vende fiado por internet".
- **No existe `vinculo_ambiguo`.** El `external_id` es el id de la fila, dos
  fichas duplicadas son dos filas y sólo una está vinculada: el canje resuelve
  siempre a una.

## 7. Estados del vínculo con ClubPay

| Estado | Significa |
|---|---|
| `propuesta` | le llegó y no la aceptó. **No ve nada.** |
| `vinculada` / `aceptada` | aceptó. **Los dos valores son válidos**: ClubPay usa uno en su base y otro en su documentación. |
| `rechazada` | dijo que no |
| `sin_cuenta` | ese documento no está en ClubPay. **No es una falla.** |

**Sólo `vinculada`/`aceptada` tiene `account_id`.** Sin `account_id` no hay
libreta online, sin excepciones.

Comparar con `vinculacionAceptada()`, nunca con `=== "vinculada"`.

## 8. Stock hacia NexoB2B

```
PUT /api/v1/pos/stock
{ idempotency_key, items: [{ pmp_id | presentacion_id | ean, cantidad }] }
```

- La cantidad es un **delta**, negativo cuando se vendió. Un total pisaría lo
  que pasó mientras el aviso viajaba.
- La `idempotency_key` es el **lote**, y se fija cuando el aviso sale por
  primera vez. Calcularla con lo que esté pendiente al reintentar hace que una
  venta nueva cambie el conjunto y se aplique de nuevo lo ya aplicado.
- La respuesta se cruza por **`indice`**, no por el identificador: ClubPay
  devuelve `pmp_id` siempre, haya recibido lo que haya recibido.

## 9. API para ERP

```
GET /api/erp/v1/productos
PUT /api/erp/v1/precios      { precio_centavos, costo_centavos? }
PUT /api/erp/v1/stock        { modo: "absoluto" | "ajuste" }
GET /api/erp/v1/ventas?desde=ISO  → { ventas, hasta, hay_mas }
```

- Centavos enteros, igual que `/v1`.
- Un reembolso viene con **cantidades negativas**, no como un registro aparte.
- `hasta` es la marca para la próxima llamada; `hay_mas` dice si quedó cola.
- Un precio escrito por el ERP queda **manual** y los márgenes no lo recalculan.

## 10. Cómo se rompe un contrato sin romperlo

Cuando hay que cambiar una forma que otro sistema ya consume, **conviven las
dos** hasta que el otro equipo confirme que desplegó:

- `/v1/stores/:id/products` sin parámetros devuelve el arreglo pelado; con
  filtros devuelve `{ items, total }`.
- `/v1/stores/:id/pasillos` manda `subCategories` (plano) **y** `children`
  (árbol).

Las dos están vivas hoy y esperan confirmación de NexoTienda para retirarse.

# API de NexoPOS para sistemas del comercio

Para conectar un ERP, Odoo o cualquier sistema propio: leer el catálogo,
escribir precios y stock, y leer las ventas del mostrador.

**Base:** `https://nexopos.app/api/erp/v1`

---

## La clave

La genera el comerciante desde **NexoPOS → Configuración → Conectar tu sistema**,
le pone un nombre —"ERP", "Odoo"— y la copia. **Se muestra una sola vez**: de
nuestra base sale solo el hash, así que si se pierde hay que generar otra y
revocar la anterior.

Es incómodo a propósito. Una clave que se puede recuperar es una clave que
alguien puede ir a buscar a un backup o a una consulta de soporte.

```
Authorization: Bearer npos_xxxxxxxxxxxxxxxxxxxx
```

Es **por comercio**: abre ese comercio y ninguno más. Si se filtra, el alcance
del daño es ese negocio.

Revocarla es inmediato y lo que la esté usando deja de funcionar en la
siguiente llamada. En la lista se ve cuándo se usó por última vez, que es lo
que permite apagar una vieja sin miedo a romper algo que todavía anda.

---

## Los importes van en centavos

Enteros, siempre. `$52.000` es `5200000`. Un float arrastrando medio centavo
por 3000 productos termina en una diferencia que nadie encuentra.

## Cómo se identifica un producto

Cada línea que escriben lleva **una** de estas tres:

| | |
|---|---|
| `ean` | El código de barras. Es lo normal |
| `sku` | El código de balanza, si lo usan |
| `id` | El id de NexoPOS, que sale de `GET /productos` |

Si un EAN aparece en dos productos del mismo comercio, esa línea **no se
aplica** y vuelve en `no_encontrados`. No adivinamos cuál era.

---

## `GET /productos`

Todo lo que el comercio tiene, paginado de a 500.

```
GET /api/erp/v1/productos?page=1
```

```json
{
  "productos": [{
    "id": "184", "ean": "7798042240180", "sku": null,
    "nombre": "Silla Plástica Voss 2000 — unidad", "unidad": "unidad",
    "precio_centavos": 5200000, "costo_centavos": 3000000,
    "stock": 17, "stock_minimo": 0,
    "es_insumo": false, "publicado_en_tienda": true,
    "actualizado": "2026-09-15T03:28:00.000Z"
  }],
  "page": 1, "pageSize": 500, "total": 3
}
```

`precio_centavos: null` es un producto **sin precio de venta**: no se puede
cobrar en el mostrador ni aparece en la tienda online hasta que tenga uno.

## `PUT /precios`

Hasta 1000 por llamada.

```json
{ "precios": [
  { "ean": "7798042240180", "precio_centavos": 5200000, "costo_centavos": 3000000 }
]}
```

```json
{ "aplicados": 1, "no_encontrados": [] }
```

El costo es opcional; si no va, queda el que estaba.

---

## `PUT /stock` — leer esto antes de usarlo

```json
{ "modo": "ajuste", "stock": [ { "ean": "7798042240180", "cantidad": 5 } ] }
```

| `modo` | Qué hace |
|---|---|
| `ajuste` *(default)* | Suma o resta. `-2` saca dos |
| `absoluto` | Deja el stock en ese número |

**La diferencia se paga cara y conviene verla con un ejemplo.**

El ERP sincroniza a las 14:00 y ve 12 unidades. A las 14:30 el cajero vende 3 y
quedan 9. A las 15:00 el ERP vuelve a sincronizar con el número que él tiene:

```
modo absoluto → "dejalo en 12"  → el stock vuelve a 12
```

**Reaparecieron tres unidades que ya no están.** El mostrador las va a vender de
nuevo y no van a estar en el depósito.

```
modo ajuste → "sumá 0"          → el stock queda en 9
```

Con `ajuste` eso no puede pasar, porque no reescribe: acumula sobre lo que haya.

**Cuándo usar cada uno:**

- **`ajuste`** para el día a día. Entró mercadería, sumá lo que entró. Es el
  único seguro cuando el mostrador también vende.
- **`absoluto`** solo cuando el número que mandan es la verdad completa: justo
  después de un inventario físico, o si el POS no vende nada de ese producto.

Y si el ERP quiere llevar el stock él mismo, **tiene que leer las ventas del
mostrador**. Para eso está el endpoint de abajo: sin él, el ERP no tiene forma
de saber que el cajero vendió.

Cada escritura deja un movimiento de tipo `erp` con **lo que cambió**, no con lo
que quedó, así la suma de los movimientos sigue dando el stock.

---

## `GET /ventas`

Lo que se vendió por el mostrador, para conciliar.

```
GET /api/erp/v1/ventas?desde=2026-09-15T00:00:00Z
```

```json
{
  "ventas": [{
    "id": "1", "ticket": 1, "fecha": "2026-09-15T03:28:32.005Z",
    "total_centavos": 10400000, "medio_pago": "cash", "es_reembolso": false,
    "lineas": [{ "producto_id": 184, "ean": "7798042240180", "sku": null,
                 "nombre": "Silla Plástica Voss 2000 — unidad",
                 "cantidad": "2.000", "precio_centavos": 5200000 }]
  }],
  "hasta": "2026-09-15T03:28:32.005Z",
  "hay_mas": false
}
```

**Cómo paginar:** guarden el `hasta` y mándenlo como `desde` en la próxima
llamada. Mientras `hay_mas` sea `true`, sigan pidiendo.

Incluye los pedidos de la tienda online entregados, porque terminan como nota de
venta igual que una venta del mostrador. Un reembolso viene con
`es_reembolso: true` y cantidades negativas: es una venta al revés, no un
registro aparte que haya que interpretar.

---

## Errores

| | |
|---|---|
| `401` | Clave ausente, inválida o revocada |
| `400` | Faltan datos, o el cuerpo no tiene la forma esperada |
| `409` | La operación choca con el estado actual |

Los mensajes están escritos para leerse: dicen qué falta.

**Nada se cachea.** El stock cambia con cada venta del mostrador, y un catálogo
de hace cinco minutos vende lo que ya no está.

---

## Lo que todavía no hay

- **Crear productos desde la API.** Hoy los productos entran desde el catálogo
  de NexoB2B o se crean en el POS. Si necesitan dar de alta desde el ERP,
  díganlo: es el próximo paso lógico y no está hecho.
- **Webhooks hacia el ERP.** Hoy el ERP tiene que preguntar por `/ventas`. Si
  hace falta que le avisemos, se puede hacer con el mismo mecanismo que ya usamos
  con NexoTienda.

# Integraciones

Todo lo que sale por red vive en `backend/src/integrations/`. Ningún módulo
llama a un sistema externo por su cuenta.

La correspondencia con cada equipo está en los `PEDIDO-*.md` y `RESPUESTA-*.md`
de esta carpeta: son la fuente de los contratos. **Ante una contradicción, vale
el código.**

---

## NexoB2B

### Login y ficha del comercio
- **Dirección:** NexoPOS → NexoB2B
- **Método:** `POST /store/comercios/auth`, `GET /store/comercios/me`
- **Auth:** email y contraseña del comerciante; después JWT de B2B guardado en
  `commerces.nexob2b_token`
- **Dueño del dato:** NexoB2B
- **Regla:** no hay alta propia. Sin cuenta en B2B no hay NexoPOS. La ficha se
  copia pero **no se edita** acá.

### Catálogo y compras
- **Dirección:** NexoPOS → NexoB2B
- **Método:** `GET /store/productos`, `/store/mayoristas/*`, `POST /store/ordenes`
- **Auth:** JWT del comercio + `x-publishable-api-key`
- **Dueño:** NexoB2B
- **Regla:** el `precio` que llega es **el costo con la lista del comercio ya
  aplicada**. Nunca se usa como precio de venta.

### Catálogo propio (el híbrido mayorista + comercio)
- **Dirección:** NexoPOS → NexoB2B
- **Método:** `GET /api/v1/pos/productos` (pagina de a 200)
- **Regla:** sólo las líneas con `es_propio`. Entran con costo y stock, **sin
  precio de venta**. Una reimportación refresca el costo y la clasificación y
  no toca el precio ni la cantidad que puso el comerciante.

### Fichas modificadas
- **Dirección:** NexoPOS → NexoB2B, cada hora
- **Método:** `GET /api/v1/fichas?desde=&desde_id=`
- **Auth:** `NEXOPOS_PLATFORM_KEY` — **la misma clave en los dos sentidos**
- **Riesgo conocido:** el cursor lleva **fecha e id**. Con sólo la fecha, un
  UPDATE masivo deja empates y la lectura se saltea filas o se estanca. Lo midió
  NexoB2B. Ver DEC-008.
- **Incidente CR-0001 (6 jul → 23 sep 2026):** NexoB2B guardaba la fecha con
  microsegundos y paginaba con milisegundos; la misma página volvía siempre y no
  llegó ninguna corrección en dos meses y medio. Lo arregló NexoB2B. De nuestro
  lado quedó: el cursor se lee sin recortar la precisión, una página que sólo
  repite fichas corta la corrida y deja el error en `sync_cursor.ultimo_error`,
  y cada corrida loguea fichas, distintas, páginas y `hay_mas` final.

### Stock compartido (sólo el híbrido)
- **Dirección:** los dos sentidos
- **Salida:** `PUT /api/v1/pos/stock` con delta negativo por cada venta de
  mostrador de un producto propio. Se identifica con `pmp_id`,
  `presentacion_id` o `ean`, en ese orden de precisión. Lleva
  `idempotency_key` = el lote.
- **Entrada:** `POST /api/nexob2b/stock` con la clave de plataforma (puerta
  única, sin nada por comercio) o `POST /api/nexob2b/stock/:token` (por
  comercio, se mantiene hasta que B2B confirme que migró).
- **Regla:** las dos mitades se prenden juntas. Media sincronización deja el
  número bajando y nunca subiendo, y el comerciante deja de creerle.
- **Estado:** construido de los dos lados, **apagado** por comercio.

### Slugs y regiones
- **Dirección:** NexoB2B → NexoPOS
- **Método:** `GET /api/slugs/:slug`, `PUT /api/regiones/:slug`
- **Auth:** clave de plataforma
- **Regla:** comercios y regiones comparten un espacio de nombres —
  `morrison.nexotienda.app` es un pueblo **o** un comercio, nunca los dos — y
  NexoPOS arbitra porque es quien responde qué es cada subdominio.
- **Riesgo:** con la clave vacía estos endpoints devuelven 503 a propósito. Es
  preferible que B2B no pueda verificar a que pueda cualquiera.

---

## NexoTienda

Un solo servidor que renderiza la tienda de cualquier comercio. **No tiene ni
puede tener una clave por comercio**: por eso la autenticación es por capacidad.

| Capacidad | Para qué |
|---|---|
| `catalogo` | tiendas, productos, categorías, destacados, campañas |
| `pedidos` | crear y consultar pedidos |
| `cuentas` | libreta: canje, estado, emparejar |

### Catálogo
- **Dirección:** NexoTienda → NexoPOS
- **Dueño:** NexoPOS (precio y stock del momento salen de acá)
- **Reglas:** centavos enteros; nada se cachea; `total` cuenta **después** de
  todos los filtros; con `ids=` el límite por defecto es cuántos pidieron.

### Pedidos
- **Dirección:** NexoTienda → NexoPOS para crear; NexoPOS → NexoTienda para
  avisar cambios de estado (webhook firmado con `NEXOTIENDA_WEBHOOK_SECRET`).
- **Regla:** **los totales los calcula NexoPOS.** Si difieren de lo que vio el
  comprador, la respuesta lleva `priceChanged` y el total que él había visto.

### Libreta
- **Dirección:** NexoTienda → NexoPOS → ClubPay
- **Método:** `POST /v1/cuentas/canjear` con `{ token, storeId }`
- **Regla:** el `storeId` va **en el pedido**, no sólo en la respuesta: sin él
  no sabemos con qué clave de ClubPay preguntar.
- **Regla:** la sesión que devolvemos **no tiene autoridad**. Todo lo demás se
  pregunta en cada operación con `GET /v1/cuentas/:accountId`.

---

## ClubPay

### Descuentos de socios en el mostrador
- **Dirección:** NexoPOS → ClubPay
- **Auth:** clave de ClubPay **por comercio**, en `commerces.clubpay_api_key`
- **Regla:** el importe del descuento **lo decide ClubPay**, no NexoPOS.
  Se recalcula al registrar la transacción, aunque el QR se haya validado hace
  segundos: pudo pasar la medianoche o el socio pudo usarlo en otra caja.
- **Riesgo:** con `CLUBPAY_API_URL` vacío el QR lleva una URL de mentira que la
  app no abre. El circuito con el teléfono sólo se prueba contra la API real.

### Cuenta corriente del cliente
- **Dirección:** NexoPOS → ClubPay
- **Método:** `POST /pos/customers` (propone), `GET /pos/customers/:external_id`
  (consulta, **sin mandar el documento**), `POST /pos/account/movements`
- **Dueño del vínculo:** ClubPay — lo acepta la persona desde su app
- **Regla:** nace como **propuesta**, no como vínculo hecho. En el mostrador se
  tipean documentos mal, y un dígito de más hace que el match caiga en otra
  persona que abre la app y ve la deuda de un desconocido.
- **Regla:** el documento viaja **una sola vez** en la vida de la relación.
- **Entrante:** `POST /api/clubpay/webhook/vinculacion` cuando la persona acepta
  o rechaza.

### Resúmenes
- **Estado:** retenidos por `CLUBPAY_STATEMENTS` (default apagado)
- **Motivo:** hasta que ClubPay adjudique los movimientos a su resumen, la misma
  compra se cuenta dos veces y al cliente le aparece el doble. Se acumulan en la
  cola; no se pierden.

### Handoff a la tienda
- **Dirección:** NexoPOS → ClubPay
- **Método:** `POST /pos/tienda/sessions` con el token que trae NexoTienda
- **Regla:** va con la clave **del comercio**, y eso es lo que impide que un
  token emitido para un comercio abra la tienda de otro.

### Emparejar dos pantallas — **pendiente de ClubPay**
- **Método esperado:** `POST /pos/tienda/emparejar`, `GET …/:request_id`
- **Estado:** nuestra mitad construida; la de ellos no existe todavía
- **Riesgo escrito:** el `device` que se muestra en la confirmación **lo
  controla el atacante** en el ataque que el mecanismo debe resistir. Lo
  confiable en esa pantalla es el nombre del comercio, que ClubPay deduce de la
  clave.

---

## ERP del comercio (Odoo o el que sea)

- **Dirección:** ERP → NexoPOS
- **Método:** `/api/erp/v1/productos | precios | stock | ventas`
- **Auth:** clave por comercio que genera el comerciante, guardada como SHA-256
  y mostrada una sola vez
- **Dueño:** compartido — el ERP escribe precios y stock; el mostrador escribe
  ventas
- **Regla:** un precio escrito por el ERP queda marcado como manual y los
  márgenes no lo recalculan: es su autoridad, no la nuestra.
- **Trampa documentada:** el movimiento de stock registra el **delta**, no el
  valor absoluto. Está en `/docs/api` con una tabla de comparación.

---

## Errores entre sistemas: la regla que costó cara

**Un fallo del salto de atrás nunca sale con el mismo código que un fallo
nuestro.** Un 404 de ClubPay reenviado tal cual hacía que NexoTienda leyera "la
ruta de NexoPOS no existe" y los tres equipos se señalaran entre sí durante
días. Hoy sale **502** con un mensaje que dice de qué lado está el problema.

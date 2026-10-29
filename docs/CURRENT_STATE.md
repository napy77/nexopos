# Estado del proyecto — 28 de octubre de 2026

Documento corto a propósito: se lee al empezar cada tarea. **Mantenerlo al día
es parte de terminar un cambio.**

---

## En producción

`https://nexopos.app` · último commit desplegado: **`ffa77ff`**
(verificable en `GET /health`, que devuelve el commit y cuándo arrancó).

Comercios reales en uso conocidos: **Jure Hnos**, **Rivera Hogar** (mayorista y
comercio a la vez), **Supermercado Delfín**.

## Funciona

**Mostrador** — punto de venta, tickets, reembolsos, caja con arqueo, medios de
pago, descuentos de ClubPay y cobro con Mercado Pago por QR (se muestra en pantalla o se imprime en la ticketera, y el cliente escanea).

**Stock y productos** — catálogo de B2B, recepción de compras, alta manual,
importación del catálogo propio (con costo y stock), ajustes, productos propios
con foto, productos por peso.

**Márgenes** — precios calculados desde el costo con jerarquía
producto → subrubro → rubro → pasillo → global. Suma IVA (el costo es neto y el
precio de mostrador es final) y redondea hacia arriba. No pisa precios puestos a
mano.

**Cuentas corrientes** — libreta del comercio, períodos con día de cierre y de
vencimiento, límite de crédito opcional, pausa, imputación de pagos del más
viejo al más nuevo, resúmenes.

**Tienda (NexoTienda)** — catálogo paginado con filtros y búsqueda, árbol de
tres niveles, destacados con piso, campañas, pedidos con sus estados, webhooks
de cambio de estado, esconder lo que no hay.

**Campañas** — tandas de ofertas con descuento **por producto** (porcentaje o
precio fijo) y orden manual arrastrando. Sólo afectan la tienda online.

**Alta masiva de productos** — Productos → Integración API: CSV con vista
previa (lee Excel en Windows-1252 y con punto y coma), y `POST /api/erp/v1/productos`
con el mismo motor. Por EAN toma la ficha de NexoB2B; si no está, producto
propio. El stock reemplaza. Se analiza en segundo plano (tabla `importaciones`).

**API para ERP** — `/api/erp/v1`, con claves por comercio y documentación
pública en `/docs/api`. Lee y da de alta productos, escribe precios y stock,
lee ventas.

**Sitio institucional** — `/` es el sitio público de nexopos.app (antes
redirigía a la caja). Dos botones: **Ingresar** (`/login`) y **Crear cuenta
gratis**, que lleva al alta de NexoB2B (`/comercio/registro`, configurable con
`NEXT_PUBLIC_NEXOB2B_REGISTRO_URL`). Con sesión abierta el botón pasa a ser
«Ir a mi caja». Sólo anuncia lo que está en "Funciona".

**Detector de clientes duplicados** — por teléfono normalizado primero,
documento de refuerzo. Avisa en el alta y lista los sospechosos. **No fusiona.**

## A medias

| Qué | Qué falta | De quién |
|---|---|---|
| **Stock compartido con NexoB2B** | **La mitad B2B → NexoPOS nunca anduvo en producción**: el 28/10 se vio el interruptor de Rivera Hogar prendido y cero avisos recibidos desde siempre. Se sacó la puerta por comercio y su pantalla de copiar y pegar (migración 049), la tarjeta ahora muestra el último aviso recibido y prender o apagar queda en `audit_log`. Pedido a B2B: `PEDIDO-AVISOS-STOCK-A-NEXOB2B.md`. El interruptor va **apagado** hasta que llegue el primer aviso y Rivera confirme cómo se comporta su ERP. | NexoB2B, decisión del cliente |
| **Libreta en la tienda** | Canje, estado y `linkedAt` construidos. El **emparejar por código** espera que ClubPay construya `/pos/tienda/emparejar`. | ClubPay |
| **QR de vinculación en el mostrador** | Pedido escrito (`PEDIDO-QR-VINCULACION-A-CLUBPAY.md`). Sin respuesta. | ClubPay |
| **Resúmenes hacia ClubPay** | Retenidos por `CLUBPAY_STATEMENTS` (default apagado): sin la adjudicación de movimientos del lado de ClubPay, la compra se contaría dos veces. | ClubPay |
| **Cobro con Mercado Pago** (mostrador y tienda) | En producción de los tres lados. **Probado con plata real en el mostrador el 14/10** (German: «de punta a punta, funciona OK»). *PENDIENTE DE VALIDAR:* si esa prueba cubrió también la tienda, la devolución y dos QR de mostrador a la vez (si se pisan, mandar `terminal` en el `POST`), y la comisión, que hoy es cero. | German |
| **CR-0003 identidad en pedidos de la tienda** | Respuesta y agregado en `respuesta-cr-0003-identidad.md`. **Hecho:** `libreta_activa` (sin libreta no se fía en el mostrador ni en la tienda), interruptor `identity_rules_enabled` (apagado, sin uso), y el slug y la libreta espejados en ClubPay (`clubpay_sync`), en producción desde el 13/10. ClubPay confirmó una relación por persona y comercio. **Bloque A (en producción desde el 13/10):** cuenta + contacto juntos en los pedidos y canje de cuentas nacidas en la tienda. NexoTienda ya manda los dos juntos. **Bloque B (en producción desde el 13/10, reglas apagadas en todos los comercios):** reglas por comercio en Configuración → Tienda con los topes de ejemplo que aprobó German el 13/10, `orderRules`, rechazos con `code`, `review` y marca en Pedidos, bloqueo, límite y pausa del fiado en la ficha. **Sigue:** probarlo de punta a punta con NexoTienda en un comercio de prueba, cuando ClubPay tenga la web de alta. | NexoPOS, NexoTienda, ClubPay |
| **Entrada sin contraseña desde B2B (`/entrar`, modo soporte)** | Construida y probada en local en modo mock el 28/10 (entrada, franja, Salir, recarga 410, vencido 410, suspendido 403, operador en ventas y caja). **Desplegado el 28/10** con el bloque `/entrar` de nginx aplicado (verificado: `no-referrer` y sin línea en el access log). **Falta:** que B2B pruebe desde su admin. Respuesta en `RESPUESTA-ENTRAR-A-NEXOB2B.md`. *PENDIENTE DE VALIDAR:* el cierre de la pestaña con `window.opener` (el navegador de pruebas no abre ventanas hijas) y el canje real contra `nexob2b.app`. | German, NexoB2B |
| **Resúmenes en la tienda** | Esperando la decisión de German. Recomendación escrita: que **no** vayan (ver `RESPUESTA-3-LIBRETA-A-NEXOTIENDA.md`). | German |

## Pendiente, sin empezar

- Cobro online de pedidos: ver "Cobro con Mercado Pago" arriba.
- Circuito de comprobante de transferencia. Borrador acordado con NexoTienda:
  `POST /v1/orders/:code/comprobante`, el pedido en `pendiente` hasta que el
  comercio lo marque pagado. Espera que German lo priorice.
- Webhooks salientes hacia el ERP.
- Calculadora de costo de recetas y cadencia de reposición (ideas viejas, sin
  compromiso con nadie).

## Problemas conocidos y deuda

- **Clientes duplicados ya existentes.** El detector los encuentra; fusionarlos
  es manual y a propósito: sumar dos saldos mal deja a alguien debiendo lo que
  no debe.
- **Productos sin costo** quedan fuera del alcance de los márgenes. La pantalla
  los cuenta aparte.
- **Dos formas viejas siguen vivas en `/v1`** por compatibilidad: `/products`
  sin parámetros devuelve un arreglo pelado, y `/pasillos` manda
  `subCategories` además de `children`. NexoTienda ya migró y avisó que se
  pueden sacar; **falta confirmar que su versión migrada esté desplegada**
  antes de retirarlas.
- **`refreshProductTaxonomy` cruza por id.** Los productos que entraron por la
  importación de catálogo propio antes de que NexoB2B mandara los ids tienen
  `pasillo_id` en NULL y no los alcanza. Se corrigen solos con el sync de fichas.
- **200 productos con `nexob2b_id` `mock…` en el catálogo global de
  producción**, sin comercio. Restos de algún arranque en modo demo contra esta
  base. Sin tocar.
- **No hay tests automatizados.** La verificación es manual contra la base y la
  API. Es la deuda más grande del proyecto.

## Cambios recientes que conviene conocer

- **20/10: `/` dejó de mandar a la caja** y es el sitio institucional. El
   login sigue en `/login`. La tarjeta «Activar cuenta» de NexoB2B apunta a la
   raíz de nexopos.app, así que el comerciante ahora pasa por el sitio y toca
   «Ingresar». Pedido a NexoB2B para que apunte a `/login`:
   `PEDIDO-ACTIVAR-NEXOPOS-A-NEXOB2B.md` (sin respuesta todavía).
0. **El sync de fichas estuvo trabado del 6 de julio al 23 de septiembre**
   (CR-0001, causa en NexoB2B). Resincronizado el 23/9: 72.051 fichas en 145
   páginas, `hay_mas=false`, 10.489 líneas actualizadas. Respuesta en
   `RESPUESTA-CR-0001-FICHAS-A-NEXOB2B.md`. Ahora un cursor estancado corta la
   corrida y queda en `sync_cursor.ultimo_error`.
1. **`$5 IS NOT NULL` sin cast rompió `/api/stock/adjust` y
   `/api/stock/add-from-catalog` durante cinco días** (16 al 21 de septiembre).
   Arreglado en `2914f92`. La lección está en `CLAUDE.md` como regla 7.
2. **Campañas: el descuento pasó de la campaña al producto** y `productIds`
   ahora viene en orden manual. Avisado a NexoTienda.
3. **Sync de fichas del catálogo maestro**, cada hora, con cursor `(fecha, id)`.
4. **Las solapas de la tienda agrupaban mal**: todo el catálogo de un comercio
   importado caía en una sola categoría. Corregido usando el nombre como clave
   cuando no hay id.

## Migraciones

**49 en el repo, 48 en producción.** Corren solas al arrancar el
backend. `049_sin_webhook_por_comercio.sql` (borra el token y el secreto por comercio)
se aplica con el próximo deploy. Si `045_cuenta_clubpay_unica.sql` encuentra cuentas de ClubPay
repetidas no crea el índice y lo avisa en el log del arranque.

## Desarrollo local

El contenedor de PostgreSQL que servía el puerto 5433 **ya no existe** en la
máquina de German; la base se recreó en el PostgreSQL de Homebrew en el **5432**.
Para correr el backend hay que apuntar `DATABASE_URL` ahí. Las 41 migraciones
levantan el esquema desde cero sin datos.

*PENDIENTE DE VALIDAR: si German quiere volver al esquema con Docker del
`docker-compose.yml`, que sigue en el repo apuntando al 5433.*

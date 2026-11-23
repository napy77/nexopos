# Estado del proyecto — 17 de noviembre de 2026

Documento corto a propósito: se lee al empezar cada tarea. **Mantenerlo al día
es parte de terminar un cambio.**

---

## En producción

`https://nexopos.app` · último commit desplegado: **`ffa77ff`**
(verificable en `GET /health`, que devuelve el commit y cuándo arrancó).

Comercios reales en uso conocidos: **Jure Hnos** y **Supermercado Delfín**
(mayorista y comercio a la vez: usa el stock compartido). Rivera Hogar está dado
de alta pero no usa el mostrador (0 ventas, último login propio 16/09).

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
| **Catálogo NexoB2B** | Igual al catálogo del portal del comercio (16/11): vistas Lista/Chica/Grande, pasillo → rubro → subrubro, sin stock, solo con alta, de a 50, precio final o + IVA como lo ve el comercio. Probado con datos simulados; con B2B real no. | NexoB2B |
| **Descubrí mayoristas** | Misma búsqueda y misma tarjeta que el portal del comercio de B2B (16/11): equivalencias de rubros, radio desde la ubicación de B2B, resguardo sin rubros y orden. Probado con datos simulados; con B2B real no. | NexoB2B |
| **Stock compartido con NexoB2B** | Para cualquier comercio que sea mayorista y comercio a la vez; hoy lo usa Delfín (interruptor prendido). **La mitad B2B → NexoPOS no anduvo hasta el 29/10**: B2B sólo avisaba si existía una `nexo_api_key` tipo nexopos (ya corregido). Ahora avisan a los comercios marcados por llamar a `/api/v1/pos/*`, y el POS hace esa llamada al prender. **Anda con Delfín desde el 29/10** (7.441 movimientos del CSV y 1 despacho). Los «0 aplicados» que vio B2B eran su `fetch` cortando a los 8 s un aviso que sí entró, y tandas siguientes sin cambio. La salida POS → B2B reconocía la presentación por `pp_`, pero en producción los ids son UUID: corregido el 30/10, falta la primera venta real para confirmarlo. La respuesta ahora trae `recibidos`/`aplicados`/`sin_cambio`/`no_encontrados`/`invalidos` y `motivo`. Correspondencia: `PEDIDO-AVISOS-STOCK-A-NEXOB2B.md`, `RESPUESTA-7-A-NEXOPOS-AVISOS-STOCK.md`, `RESPUESTA-AVISOS-STOCK-A-NEXOB2B.md`. Prenderlo lo decide cada comercio, cuando su ERP deja de reescribir el total en B2B. | NexoB2B, decisión del cliente |
| **Libreta en la tienda** | Canje, estado y `linkedAt` construidos. El **emparejar por código** espera que ClubPay construya `/pos/tienda/emparejar`. | ClubPay |
| **QR de vinculación en el mostrador** | Pedido escrito (`PEDIDO-QR-VINCULACION-A-CLUBPAY.md`). Sin respuesta. | ClubPay |
| **Resúmenes hacia ClubPay** | Retenidos por `CLUBPAY_STATEMENTS` (default apagado): sin la adjudicación de movimientos del lado de ClubPay, la compra se contaría dos veces. | ClubPay |
| **Cobro con Mercado Pago** (mostrador y tienda) | En producción de los tres lados. **Probado con plata real en el mostrador el 14/10** (German: «de punta a punta, funciona OK»). *PENDIENTE DE VALIDAR:* si esa prueba cubrió también la tienda, la devolución y dos QR de mostrador a la vez (si se pisan, mandar `terminal` en el `POST`), y la comisión, que hoy es cero. | German |
| **CR-0003 identidad en pedidos de la tienda** | Respuesta y agregado en `respuesta-cr-0003-identidad.md`. **Hecho:** `libreta_activa` (sin libreta no se fía en el mostrador ni en la tienda), interruptor `identity_rules_enabled` (apagado, sin uso), y el slug y la libreta espejados en ClubPay (`clubpay_sync`), en producción desde el 13/10. ClubPay confirmó una relación por persona y comercio. **Bloque A (en producción desde el 13/10):** cuenta + contacto juntos en los pedidos y canje de cuentas nacidas en la tienda. NexoTienda ya manda los dos juntos. **Bloque B (en producción desde el 13/10, reglas apagadas en todos los comercios):** reglas por comercio en Configuración → Tienda con los topes de ejemplo que aprobó German el 13/10, `orderRules`, rechazos con `code`, `review` y marca en Pedidos, bloqueo, límite y pausa del fiado en la ficha. **Sigue:** probarlo de punta a punta con NexoTienda en un comercio de prueba, cuando ClubPay tenga la web de alta. | NexoPOS, NexoTienda, ClubPay |
| **Entrada sin contraseña desde B2B (`/entrar`, modo soporte)** | Construida y probada en local en modo mock el 28/10 (entrada, franja, Salir, recarga 410, vencido 410, suspendido 403, operador en ventas y caja). **Desplegado el 28/10** con el bloque `/entrar` de nginx aplicado (verificado: `no-referrer` y sin línea en el access log). **Falta:** que B2B pruebe desde su admin. Respuesta en `RESPUESTA-ENTRAR-A-NEXOB2B.md`. *PENDIENTE DE VALIDAR:* el cierre de la pestaña con `window.opener` (el navegador de pruebas no abre ventanas hijas) y el canje real contra `nexob2b.app`. | German, NexoB2B |
| **App de Windows (`desktop/`)** | Electron que muestra nexopos.app, con impresión directa a la ticketera (selector en Configuración, sólo dentro de la app) y pantalla propia sin conexión. El instalador se genera (16/11) y la app se probó en Mac. **Probada en Windows (22/11)** con una OCOM OCPP-812 de 80 mm: la 1.0.0 sacaba el ticket en blanco; desde la 1.0.1 la app le pasa a la ticketera el tamaño exacto del rollo (falta verlo salir bien). La 1.0.2 trae el ícono de la app de Android (`desktop/build/icon.png`, copia de `mobile/assets/images/icon.png`) y muestra la versión instalada debajo de «Cerrar sesión». **Falta:** confirmar el ticket en la térmica y la firma de código. **Descarga desde el sitio (17/11):** la sección «NexoPOS para Windows» aparece sola cuando `/descargas/latest.yml` existe; se publica con `/Users/german/ClaudeCode/nexo-pos/desktop/publicar.sh` (ver `DEPLOYMENT.md`) y necesita el bloque `/descargas/` de nginx aplicado a mano. Ni el bloque ni el instalador están en el servidor todavía. El frontend que la reconoce (`lib/desktop.ts`) sale con el próximo deploy; hasta entonces la app imprime con el diálogo de siempre. **Corte de internet con la caja abierta (16/11, web y app):** aviso en el menú, menú y cobro apagados, y vuelven solos cuando el servidor contesta (`lib/conexion.ts`, sondea cada 5 s). Probado en local simulando el corte; con un corte real de red, no. **Cobro en efectivo sin internet (16/11, sólo dentro de la app de Windows):** la venta va a una cola en la caja (`lib/ventas-offline.ts`), sale un comprobante provisorio `P-0001` y se registra sola al volver, sin duplicarse (`offline` en `POST /api/sales`, migración 050). Con la caja cerrada espera; si el servidor la rechaza queda en Caja con el motivo. No se cierra la caja con ventas sin enviar. Probado en local simulando la app y el corte; en Windows, no. **Sólo funciona si la pantalla ya estaba abierta al cortarse**: abrir la app sin internet es la etapa B. La venta en curso (renglones y cliente) se guarda en la caja y se recupera al reabrir, con aviso al cajero; vence a las 12 h (`lib/venta-en-curso.ts`). Detalle en `desktop/README.md`. | German |
| **App de Android y iOS (`mobile/`)** | Empezada el 17/11. Nativa contra `/api/*`, sin web embebida, siempre online. **Etapa 1 hecha: el mostrador** (vender con lector Bluetooth y balanza, ClubPay, Mercado Pago, caja con arqueo y cierre, reembolsos, cobro de cuenta corriente, ticketera por red / BLE / Bluetooth clásico en Android). El ticket y el cierre en ESC/POS los arma el backend (`ticket-escpos.ts`, `GET /api/sales/:id/ticket.escpos`, `GET /api/caja/:id/resumen.escpos`); el cobro de Mercado Pago ahora devuelve también `qrData`. **Escáner con la cámara** en todos los buscadores de productos (ícono a la derecha), además del lector Bluetooth. **Ticket sin ticketera:** «Enviar» en Vender y en Ventas manda por WhatsApp (número de la ficha del cliente o tipeado) o muestra un QR que el cliente escanea con su cámara; los dos llevan a `GET /api/ticket/:token`, el PDF sin sesión con un link firmado (HMAC con `JWT_SECRET`, no vence) que da `GET /api/sales/:id/ticket.link`. `GET /api/sales/:id` suma `customer_phone`. **Stock y compras también:** alta desde el catálogo maestro escaneando, producto propio, precio y ajuste de stock con motivo, catálogo de mayoristas, carrito (una orden por mayorista, guardado en el dispositivo), órdenes con «Ingresar al stock» y cancelar; el buscador de Productos también trae lo del catálogo de NexoB2B. **Mayoristas** (descubrir por zona y rubro, pedir el alta, ver el catálogo de cada uno) y **pedidos de la tienda** (pestaña con globito de los sin aceptar, consulta cada 20 s; aceptar con tiempo, listo, en camino, entregado, cancelar con motivo). **Ingreso con huella o Face ID** (opcional, en Ajustes o al entrar): guarda email y contraseña atados a la biometría y hace el login de siempre; sin cambios en el backend. Fuera del ticket, usa los mismos endpoints que la web. Probado en el simulador de iPhone contra el backend de prueba y el mock de NexoB2B. **Tiendas (22/11):** política en `/privacidad`, ícono propio (pin con toldo, entra en la próxima compilación), capturas, gráfico y las respuestas de cada formulario de Play y Apple en `PUBLICACION-TIENDAS.md`. **Falta:** el comercio de revisión para las tiendas, la casilla `soporte@nexopos.app`, capturas de iPad, probar en dispositivos reales con térmicas y lector, fotos de productos (pide la cámara: otra compilación), aviso push de pedido nuevo con la app cerrada, márgenes, campañas y configuración. | NexoPOS, German |
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

**50 en el repo, 48 en producción.** Corren solas al arrancar el
backend. `049_sin_webhook_por_comercio.sql` (borra el token y el secreto por comercio)
y `050_ventas_sin_conexion.sql` (tres columnas y un índice en `sales`) se
aplican con el próximo deploy. Si `045_cuenta_clubpay_unica.sql` encuentra cuentas de ClubPay
repetidas no crea el índice y lo avisa en el log del arranque.

## Desarrollo local

El contenedor de PostgreSQL que servía el puerto 5433 **ya no existe** en la
máquina de German; la base se recreó en el PostgreSQL de Homebrew en el **5432**.
Para correr el backend hay que apuntar `DATABASE_URL` ahí. Las 41 migraciones
levantan el esquema desde cero sin datos.

*PENDIENTE DE VALIDAR: si German quiere volver al esquema con Docker del
`docker-compose.yml`, que sigue en el repo apuntando al 5433.*

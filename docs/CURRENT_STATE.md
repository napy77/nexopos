# Estado del proyecto — 21 de septiembre de 2026

Documento corto a propósito: se lee al empezar cada tarea. **Mantenerlo al día
es parte de terminar un cambio.**

---

## En producción

`https://nexopos.app` · último commit desplegado: **`2914f92`**
(verificable en `GET /health`, que devuelve el commit y cuándo arrancó).

Comercios reales en uso conocidos: **Jure Hnos**, **Rivera Hogar** (mayorista y
comercio a la vez), **Supermercado Delfín**.

## Funciona

**Mostrador** — punto de venta, tickets, reembolsos, caja con arqueo, medios de
pago, descuentos de ClubPay por QR (el comercio muestra el QR, el socio escanea).

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

**API para ERP** — `/api/erp/v1`, con claves por comercio y documentación
pública en `/docs/api`.

**Detector de clientes duplicados** — por teléfono normalizado primero,
documento de refuerzo. Avisa en el alta y lista los sospechosos. **No fusiona.**

## A medias

| Qué | Qué falta | De quién |
|---|---|---|
| **Stock compartido con NexoB2B** | Construido y probado de los dos lados. El interruptor está **apagado** hasta que Rivera Hogar confirme cómo se comporta su ERP. | decisión del cliente |
| **Libreta en la tienda** | Canje, estado y `linkedAt` construidos. El **emparejar por código** espera que ClubPay construya `/pos/tienda/emparejar`. | ClubPay |
| **QR de vinculación en el mostrador** | Pedido escrito (`PEDIDO-QR-VINCULACION-A-CLUBPAY.md`). Sin respuesta. | ClubPay |
| **Resúmenes hacia ClubPay** | Retenidos por `CLUBPAY_STATEMENTS` (default apagado): sin la adjudicación de movimientos del lado de ClubPay, la compra se contaría dos veces. | ClubPay |
| **Resúmenes en la tienda** | Esperando la decisión de German. Recomendación escrita: que **no** vayan (ver `RESPUESTA-3-LIBRETA-A-NEXOTIENDA.md`). | German |

## Pendiente, sin empezar

- Cobro online de pedidos (Mercado Pago). `payment_status` existe y queda en
  `pendiente`; no hay integración.
- Circuito de comprobante de transferencia.
- Creación de productos desde el ERP (hoy sólo lee y actualiza).
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
- **No hay tests automatizados.** La verificación es manual contra la base y la
  API. Es la deuda más grande del proyecto.

## Cambios recientes que conviene conocer

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

**41 aplicadas, ninguna pendiente.** Corren solas al arrancar el backend. La
última es `041_campanas_por_producto.sql`.

## Desarrollo local

El contenedor de PostgreSQL que servía el puerto 5433 **ya no existe** en la
máquina de German; la base se recreó en el PostgreSQL de Homebrew en el **5432**.
Para correr el backend hay que apuntar `DATABASE_URL` ahí. Las 41 migraciones
levantan el esquema desde cero sin datos.

*PENDIENTE DE VALIDAR: si German quiere volver al esquema con Docker del
`docker-compose.yml`, que sigue en el repo apuntando al 5433.*

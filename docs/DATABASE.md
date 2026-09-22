# Base de datos

PostgreSQL 16, **instancia dedicada**. No se comparte con NexoB2B ni con ningún
otro producto del ecosistema.

---

## Reglas del esquema

- **Multi-tenancy por fila.** Casi toda tabla lleva `commerce_id`, y ese valor
  **sale siempre del JWT**. Nunca del body ni de la query.
- **Migraciones numeradas** en `backend/migrations/`, aplicadas al arrancar y
  registradas en `_migrations`. Si una falla, el proceso termina.
- **Dinero en `NUMERIC`, en pesos.** Los centavos enteros existen sólo en la
  frontera `/v1`.
- **Fechas de negocio como `DATE`**, no timestamps: el comerciante piensa "del 1
  al 15" y el 15 incluye el 15 entero. La conversión a instante ocurre al
  responder, en `America/Argentina/Cordoba`.

## Quién es dueño de cada dato

Lo más importante de este documento. **No asumir ownership donde dice
compartido.**

| Dato | Dueño | Dónde vive | Notas |
|---|---|---|---|
| **Comercio** (alta, estado, dirección, teléfono, rubro) | **NexoB2B** | copia de lectura en `commerces` | Se edita en B2B. Acá se copia para servir la tienda; **no se edita**. |
| **Usuario / credenciales** | **NexoB2B** | no se guardan | Login delegado. NexoPOS emite su propio JWT después. |
| **Producto del catálogo maestro** (título, foto, marca, EAN, taxonomía) | **NexoB2B** | copia en `products` | Se refresca por el sync de fichas. |
| **Producto propio del comercio** | **NexoPOS** | `products` con `origen='propio'` y `commerce_id` | Lo crea el comerciante. B2B no lo conoce. |
| **Mayorista y sus listas de precio** | **NexoB2B** | no se guarda | El costo que recibimos ya viene con la lista aplicada. |
| **Costo de reposición** | **NexoB2B** (para lo comprado y el catálogo propio) | `stock_items.cost` | Se refresca al importar. |
| **Precio de venta al público** | **NexoPOS** | `stock_items.sale_price` | B2B nunca lo fija. El ERP puede escribirlo. |
| **Stock del mostrador** | **NexoPOS** | `stock_items.quantity` | |
| **Stock del depósito mayorista** | **NexoB2B** | — | Sólo para el híbrido, y sólo si el interruptor está prendido. |
| **Cliente de cuenta corriente** | **NexoPOS** | `customers` | Se abre en el mostrador. |
| **Identidad de la persona** (quién es) | **ClubPay** | no se guarda | NexoPOS conoce una ficha, no una persona. |
| **Vínculo cliente ↔ ClubPay** | **ClubPay** | `customers.clubpay_status`, `clubpay_account_id` | Lo acepta la persona desde su app. |
| **Pedido de la tienda** | **NexoPOS** | `orders`, `order_lines` | Los totales los calculamos nosotros. |
| **Sesión de libreta en la tienda** | **NexoTienda** | no se guarda | Es una cookie de ellos. Nosotros damos `linkedAt` para revocar. |
| **Slug de tienda / región** | **NexoPOS arbitra** | `slugs`, `regions` | Comercios y regiones comparten un espacio de nombres. |
| **Venta de mostrador** | **NexoPOS** | `sales`, `sale_items` | Legible por el ERP. |

## Entidades principales

### `commerces`
El comercio. Mezcla tres cosas: la copia de la ficha de B2B, la configuración
de la tienda online, y los interruptores de integración.

Campos que conviene conocer: `nexob2b_id`, `nexob2b_token` (el JWT de B2B),
`slug`, `closing_day` / `due_day` (períodos de cuenta corriente),
`clubpay_api_key`, `b2b_stock_sync` + `b2b_webhook_token` + `b2b_webhook_secret`
+ `b2b_webhook_secret_ok_at`, `margen_suma_iva` / `margen_redondeo`,
`tienda_muestra_sin_stock`, y los de medios de pago y envío.

### `products`
El producto, **global**: una fila por presentación. `commerce_id` sólo se llena
para los productos propios.

`nexob2b_id` es la identidad hacia B2B y puede tener dos formas: `pp_…`
(presentación del maestro, lo normal) o `pmp_…` (listing del mayorista, en filas
viejas que entraron por una recepción de compra). Esa diferencia importa al
hablar con B2B.

### `stock_items`
La relación comercio ↔ producto: cantidad, costo, precio, mínimo, foto propia,
política de disponibilidad (`stock` o `declared`, con cupo del día), si es
insumo, si se publica en la tienda, si es del catálogo propio (`b2b_propio`) y
si el precio lo escribió una persona (`precio_manual`).

`UNIQUE (commerce_id, product_id)`.

### `customers` y cuenta corriente
`customers` lleva saldo, límite opcional (`NULL` = sin límite, el caso más
común), pausa y el estado del vínculo con ClubPay.
`customer_transactions` son los movimientos; `account_periods` los períodos
cerrados; `account_payments` la imputación de un pago a los períodos.

**No hay índice único por documento ni por teléfono**, a propósito: la mayoría
de las libretas de un almacén no tienen documento. Ver `DECISIONS.md` DEC-010.

### `sales` / `sale_items` / `sale_payments`
La venta del mostrador. `refund_of` apunta a la venta original cuando es un
reembolso, que viaja con cantidades negativas. `order_id` la liga al pedido de
la tienda cuando la venta nació de uno.

### `orders` / `order_lines`
El pedido de la tienda. Estados: `recibido`, `aceptado`, `listo`, `en_camino`,
`entregado`, `cancelado`. Pago: `efectivo_entrega`, `online`,
`cuenta_corriente`. El precio y el nombre quedan **congelados en la línea**.

### `campaigns` / `campaign_products`
Tandas de ofertas. El descuento vive en `campaign_products`: **o** `descuento`
(porcentaje) **o** `precio` (fijo), nunca los dos — hay un CHECK. `orden` es el
orden manual del comerciante. `campaigns.descuento` quedó nullable y en desuso:
se conserva para poder entender campañas viejas.

### `price_rules`
Las reglas de margen. `nivel` es `global`, `pasillo`, `rubro`, `subrubro` o
`producto`; `clave` es el **nombre** de la taxonomía (o el id del producto).
Nombre y no id porque la importación de catálogo propio guarda nombres.

### Colas
`clubpay_outbox`, `webhook_outbox`, `b2b_stock_outbox` — misma forma: payload,
`intentos`, `proximo_intento`, `ultimo_error`, `enviado_at`.
`sync_cursor` guarda hasta dónde leyó el sync de fichas, con **fecha e id**.

### Otras
`cash_sessions` / `cash_movements` (caja), `purchase_orders` /
`purchase_order_items` (compras a mayoristas), `commerce_hours`,
`commerce_slots` (franjas de retiro y reparto), `commerce_regions`, `regions`,
`slugs`, `commerce_previous_slugs`, `api_keys` (ERP, hash SHA-256),
`store_searches` (términos buscados en la tienda), `stock_movements`,
`audit_log`, `wholesaler_offers`.

## Identificadores compartidos

| Id | Forma | Significa |
|---|---|---|
| `commerces.nexob2b_id` | `com_…` | el comercio en NexoB2B |
| `products.nexob2b_id` | `pp_…` o `pmp_…` | presentación maestra o listing |
| `external_id` hacia ClubPay | `CLI-<customers.id>` | la ficha del cliente |
| `accountId` hacia NexoTienda | `CLI-<customers.id>` | **el nuestro, no el de ClubPay** |
| `orders.code` | `P-XXXXXXXX` | el pedido, visible para el comprador |
| `storeId` en `/v1` | `commerces.id` como texto | el comercio |

## Tipos de movimiento de stock

`purchase_reception`, `sale`, `manual_adjustment`, `return`, `erp`, `import`,
`b2b`. Cada uno existe para que el comerciante pueda distinguir de dónde salió
un número cuando revisa por qué no cuadra.

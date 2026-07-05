# Migración de datos NexoPOS → Odoo

El schema del POS está diseñado desde el inicio para exportar a Odoo Community.
`GET /api/export/odoo` devuelve un JSON (o CSV con `?format=csv`) cuyas claves
ya usan los nombres de modelo de Odoo.

## Mapeo de entidades

| NexoPOS | Export (clave) | Modelo Odoo | Notas |
|---|---|---|---|
| `products` + `stock_items` | `product.template` | `product.template` / `product.product` | `ean` → `barcode`, `category` → `categ_id` (crear categorías al importar), `cost` → `standard_price`, `sale_price` → `list_price`, `quantity` → ajuste inicial de inventario |
| `customers` | `res.partner` | `res.partner` | `doc_number` → `vat`, `balance` → asiento de apertura en `account.move` |
| `sales` | `pos.order` | `pos.order` | `ticket_number` → `name`/`pos_reference`, `payment_method` → `pos.payment.method` |
| `sale_items` | `pos.order.line` | `pos.order.line` | referenciadas por `ticket_number` + `ean` |
| `stock_movements` | `stock.move` | `stock.move` | histórico auditable; opcional importar solo el saldo |
| `customer_transactions` | `account.move` | `account.move` (asientos de cliente) | `sale_credit` → factura/deuda, `payment` → pago |

## Proceso de migración (Fase 3)

1. El comercio ejecuta el export desde el POS (JSON).
2. El **módulo Odoo de NexoB2B** (addon a desarrollar) expone un wizard
   "Importar desde NexoPOS" que:
   - crea categorías y productos (match por `barcode`),
   - carga el inventario inicial (`stock.quant`),
   - crea partners y su saldo de apertura,
   - opcionalmente importa el histórico de ventas como órdenes POS cerradas.
3. El mismo módulo consume la API de NexoB2B para que el comercio siga
   comprando a mayoristas desde Odoo (reemplaza al módulo de compras del POS).

## Invariantes a mantener en el POS

- **Nunca** borrar el EAN ni desnormalizarlo: es la clave de match en Odoo.
- Todo movimiento de stock pasa por `stock_movements` (equivale a `stock.move`).
- La cuenta corriente se registra por transacción (no solo el saldo), para
  poder reconstruir asientos contables.
- `schemaVersion` en el export permite evolucionar el formato sin romper el
  importador.

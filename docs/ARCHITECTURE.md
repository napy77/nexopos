# Arquitectura de NexoPOS

## Visión

```
┌────────────┐   REST (catálogo, ofertas,      ┌──────────────────┐
│  NexoB2B   │◄──── órdenes, auth) ───────────►│  NexoPOS backend │
│  (Medusa)  │                                 │  Node+TS+Express │
└────────────┘                                 │  PostgreSQL      │
      ▲                                        └────────┬─────────┘
      │ compras de mayoristas                           │ REST + JWT
      │                                        ┌────────▼─────────┐
┌─────┴──────┐                                 │ NexoPOS frontend │
│ Mayoristas │                                 │ Next.js (web)    │
└────────────┘                                 └──────────────────┘
```

- **Stack independiente** del backend de NexoB2B: VM propia en el data center
  de Linware, instancia PostgreSQL dedicada.
- El POS **cachea** el catálogo (22 mil productos normalizados con EAN) y las
  ofertas de mayoristas: sincronización al arrancar y cada
  `CATALOG_SYNC_INTERVAL_MIN` minutos (default 60), más endpoint manual
  `POST /api/catalog/sync`. Para el volumen real conviene pasar a sync
  incremental con `?updated_since=` (previsto en el cliente).

## Multi-tenancy

Aislamiento por fila con `commerce_id` en todas las tablas de datos del
comercio. El `commerceId` viaja **solo dentro del JWT** firmado por el POS:
ningún endpoint lo acepta como parámetro, y toda query filtra por él. Las
tablas de catálogo (`products`, `wholesaler_offers`) son globales por ser
cache de NexoB2B.

Si en el futuro se necesita defensa en profundidad, el schema es compatible
con Row-Level Security de PostgreSQL (`CREATE POLICY ... USING (commerce_id =
current_setting('app.commerce_id')::bigint)`).

## Autenticación

1. El frontend manda email/password a `POST /api/auth/login`.
2. El backend valida contra la API de auth de NexoB2B.
3. Si es válido, hace upsert del comercio local y emite un JWT propio (12 h).
4. Sin `NEXOB2B_API_URL`, modo mock: password `demo`.

Cuando NexoB2B exponga OAuth, el paso 2 se reemplaza por el intercambio de
código sin tocar el resto del sistema.

## Decisiones

| Decisión | Motivo |
|---|---|
| SQL plano + migraciones versionadas (sin ORM) | Schema transparente y documentado, clave para la exportación a Odoo; sin dependencias pesadas |
| Cache local de catálogo | Búsqueda rápida sin depender de la latencia/disponibilidad de NexoB2B |
| JWT propio del POS (no reusar el de NexoB2B) | Desacopla sesiones; el POS controla expiración y claims |
| Numeración de tickets secuencial por comercio | Requisito de negocio; calculada con lock dentro de la transacción de venta |
| Transacciones con `FOR UPDATE` en venta/recepción/pagos | Evita carreras de stock y de saldo con cajas concurrentes |
| Ticket PDF 80mm con pdfkit | Simple, sin validez fiscal (Fase 3: integración fiscal) |

## Módulos del backend

- `modules/auth` — login NexoB2B + JWT
- `modules/catalog` — búsqueda, categorías, ofertas, sync
- `modules/purchases` — órdenes, validación de mínimos, push a NexoB2B, recepción
- `modules/stock` — stock local, ajustes auditados, movimientos, alertas
- `modules/sales` — tickets, PDF, descuento de stock, venta a cuenta
- `modules/customers` — clientes, cuenta corriente, pagos
- `modules/reports` — resumen diario, cuentas por cobrar
- `modules/export` — export JSON/CSV alineado a modelos Odoo
- `integrations/nexob2b` — cliente API con modo mock

## Roadmap técnico

**Fase 2**
- PWA: service worker + cola de ventas offline con reconciliación de stock.
- Multiusuario por comercio (tabla `users` con FK a `commerces`, roles cajero/dueño).
- Sync incremental de catálogo (`updated_since`) y webhooks de NexoB2B para
  estado de órdenes.

**Fase 3**
- Módulo Odoo (addon Python) que importe el export de `/api/export/odoo` y
  consuma la API de NexoB2B para seguir comprando desde Odoo.
- Facturación fiscal (AFIP/ARCA vía WSFE) como servicio aparte.

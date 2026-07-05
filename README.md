# NexoPOS

Punto de venta web del ecosistema **NexoB2B** (Linware). Permite a los comercios
comprar a mayoristas desde el catálogo unificado de NexoB2B, gestionar su stock
local, emitir tickets de venta y llevar cuentas corrientes de clientes.
Es gratuito para comercios dados de alta en NexoB2B y está diseñado para que
los datos migren sin fricción a Odoo cuando el comercio crece
(ver [docs/ODOO-MIGRATION.md](docs/ODOO-MIGRATION.md)).

## Estructura

```
nexo-pos/
├── backend/    API REST · Node.js + TypeScript + Express + PostgreSQL
├── frontend/   Web app · Next.js 15 + React 19 (responsive desktop/tablet)
├── docs/       Arquitectura, schema, migración a Odoo, roadmap
└── docker-compose.yml   PostgreSQL 16 para desarrollo
```

## Puesta en marcha (desarrollo)

```bash
# 1. Base de datos
docker compose up -d

# 2. Backend (puerto 4000)
cd backend
cp .env.example .env
npm install
npm run dev        # aplica migraciones y sincroniza catálogo al arrancar

# 3. Frontend (puerto 3000)
cd ../frontend
npm install
npm run dev
```

Sin `NEXOB2B_API_URL` configurada el backend corre en **modo mock**: catálogo
de 200 productos de ejemplo, ofertas simuladas de 3 mayoristas y login demo
(**cualquier email / password `demo`**). Al integrar con el backend real de
NexoB2B (Medusa) solo hay que completar `NEXOB2B_API_URL` y `NEXOB2B_API_KEY`
y ajustar los endpoints en `backend/src/integrations/nexob2b.ts`.

## Flujo principal

1. **Login** con credenciales de NexoB2B → el POS emite su propio JWT con el
   `commerceId` como único origen del tenant (aislamiento total por fila).
2. **Catálogo B2B**: búsqueda por nombre/EAN/categoría sobre la cache local
   sincronizada periódicamente; cada producto muestra sus ofertas de
   mayoristas (precio, mínimo, stock, condiciones).
3. **Compras**: carrito agrupado por mayorista → confirmar orden (se valida el
   mínimo y se sincroniza a NexoB2B) → **recibir mercadería** ingresa las
   cantidades al stock local con el costo de compra.
4. **Stock**: ajustes manuales auditados, precio de venta, stock mínimo y
   alertas de stock bajo. Todos los movimientos quedan en `stock_movements`.
5. **Punto de venta**: búsqueda rápida (EAN escaneado o nombre), emisión de
   ticket con numeración secuencial por comercio, PDF 80mm no fiscal, pago en
   efectivo/tarjeta/cuenta corriente (con descuento automático de stock).
6. **Clientes**: cuenta corriente con saldo, historial y registro de pagos.
7. **Reportes**: resumen del día, más vendidos, cuentas por cobrar.
8. **Export**: `GET /api/export/odoo` (JSON o CSV) con claves alineadas a los
   modelos de Odoo.

## API

Todas las rutas salvo `/api/auth/login` requieren `Authorization: Bearer <jwt>`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Login contra NexoB2B, emite JWT |
| GET | `/api/catalog?q=&category=&page=` | Búsqueda en catálogo |
| GET | `/api/catalog/:id/offers` | Ofertas de mayoristas |
| POST | `/api/catalog/sync` | Fuerza sincronización |
| POST | `/api/purchases` | Crea y confirma orden de compra |
| POST | `/api/purchases/:id/receive` | Recibe mercadería → stock |
| GET | `/api/stock?q=&lowOnly=` | Stock local |
| POST | `/api/stock/adjust` | Ajuste manual auditado |
| GET | `/api/stock/movements` · `/alerts` | Movimientos / alertas |
| POST | `/api/sales` | Emite ticket (descuenta stock) |
| GET | `/api/sales/:id/ticket.pdf` | Ticket en PDF |
| GET/POST | `/api/customers` | Clientes |
| GET | `/api/customers/:id/transactions` | Cuenta corriente |
| POST | `/api/customers/:id/payments` | Registrar pago |
| GET | `/api/reports/daily` · `/receivables` | Reportes |
| GET | `/api/export/odoo?format=json|csv` | Export para migración |

## Fases

- **Fase 1 (este MVP)**: auth NexoB2B, catálogo, compras, stock, tickets,
  cuentas corrientes y reportes básicos, export Odoo.
- **Fase 2**: PWA offline-ready, multiusuario por comercio, más reportes.
- **Fase 3**: módulo Odoo de integración NexoB2B, facturación fiscal (AFIP/ARCA).

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y
[docs/ODOO-MIGRATION.md](docs/ODOO-MIGRATION.md).

## Producción

El deploy en el VPS (https://nexopos.app) está automatizado con los scripts
de [deploy/](deploy/README.md): instalación del servidor (Node, PostgreSQL,
nginx, certbot), build, servicios systemd y SSL.

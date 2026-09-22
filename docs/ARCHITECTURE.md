# Arquitectura de NexoPOS

Describe el sistema **como está hoy**. Lo histórico sólo aparece cuando explica
una decisión vigente; el resto está en `DECISIONS.md`.

---

## 1. El mapa

```
                        ┌──────────────┐
                        │   NexoB2B    │  catálogo maestro, mayoristas,
                        │              │  alta y login de comercios
                        └──────┬───────┘
                  login, catálogo,│ órdenes de compra,
                  fichas, stock   │ slugs y regiones
                        ┌────────▼────────┐
    ClubPay ◄──────────►│  NexoPOS API    │◄──────────► ERP del comercio
    socios, libreta     │  Express + PG   │             (Odoo, propio…)
                        └────┬───────┬────┘
                   JWT       │       │  claves por capacidad
             ┌───────────────▼─┐   ┌─▼─────────────────┐
             │ NexoPOS frontend│   │   NexoTienda      │
             │ el comerciante  │   │ {slug}.nexotienda │
             └─────────────────┘   └───────────────────┘
```

**Infraestructura propia.** VPS con PostgreSQL dedicado, separado del backend de
NexoB2B. No compartimos base con ningún otro producto del ecosistema.

## 2. Componentes

### Backend — `backend/`

Express sobre Node + TypeScript. PostgreSQL con el driver `pg` y **SQL escrito a
mano**: no hay ORM ni query builder.

- `index.ts` monta todas las rutas. Es el mapa: leerlo dice qué existe y con qué
  se autentica cada cosa.
- `modules/` es un archivo por área de negocio.
- `integrations/` concentra **todo lo que sale por red**: `nexob2b.ts` y
  `clubpay.ts`. Ningún módulo llama a un sistema externo por su cuenta.
- `middleware/` tiene las cuatro formas de autenticar (ver §5).
- `migrations/` son `.sql` numerados que corren al arrancar. Si uno falla, el
  proceso termina: es preferible no levantar a levantar con el esquema a medias.

### Frontend — `frontend/`

Next.js 15 (App Router) + React 19. **Sin framework de CSS**: variables en
`app/globals.css`.

- `(dashboard)/` son las pantallas del comerciante, con menú lateral:
  Resumen, Punto de venta, Pedidos, Caja, Catálogo B2B, Mayoristas, Compras,
  Productos, Márgenes, Campañas, Clientes. Configuración va aparte, abajo.
- `docs/api/` es la documentación pública de la API para ERP. Está **fuera** de
  `(dashboard)` a propósito: se lee sin cuenta, porque la lee un programador que
  no es el comerciante.
- `/stock` es sólo un redirect a `/productos` (la pantalla se renombró).

### Base de datos

PostgreSQL. Multi-tenancy **por fila**, no por esquema: casi toda tabla lleva
`commerce_id`. Detalle en `DATABASE.md`.

## 3. Autenticación: cuatro puertas distintas

| Puerta | Quién entra | Cómo | Dónde |
|---|---|---|---|
| **JWT de comercio** | el comerciante en su navegador | `Authorization: Bearer <jwt>` emitido por nosotros tras validar contra NexoB2B | `/api/*` |
| **Clave por capacidad** | NexoTienda | una clave por capacidad: `catalogo`, `pedidos`, `cuentas` | `/v1/*` |
| **Clave de plataforma** | NexoB2B servidor a servidor | `NEXOPOS_PLATFORM_KEY`, compartida | `/api/slugs/*`, `/api/regiones/*`, `/api/nexob2b/stock` |
| **Clave de ERP** | el sistema del comercio | clave que el comerciante genera, guardada como SHA-256 | `/api/erp/v1/*` |

Más un token en la URL para el webhook de stock por comercio, que sobrevive
mientras NexoB2B no migre a la puerta de plataforma.

**Por qué NexoTienda no tiene una clave por comercio:** es un solo servidor que
renderiza la tienda de cualquiera. Lo que separa bien ahí no es *de qué
comercio* sino *qué puede hacer*, y la capacidad sensible —`cuentas`— va sola,
para que filtrar la de catálogo no exponga las libretas del pueblo.

## 4. El login, que no es propio

No hay alta en NexoPOS. `POST /api/auth/login` valida el email y la contraseña
**contra NexoB2B**; si pasa, se hace un upsert del comercio local y se emite
nuestro JWT. El token de B2B queda guardado en `commerces.nexob2b_token` y es lo
que después permite pedirle el catálogo en nombre de ese comercio.

Consecuencia: **un comercio sin cuenta en NexoB2B no puede usar NexoPOS**, y si
su sesión de B2B vence, las funciones que dependen de B2B dejan de andar hasta
que vuelva a entrar.

Con `NEXOB2B_API_URL` vacío el backend corre en **modo mock**: catálogo y login
simulados (cualquier email, password `demo`). Es el modo de desarrollo.

## 5. Las APIs que exponemos

### `/api/*` — el comerciante
Todo lo que usa la pantalla: ventas, stock, clientes, caja, compras, ajustes,
márgenes, campañas, pedidos, configuración.

### `/v1/*` — NexoTienda
Catálogo, árbol de categorías, destacados, campañas, pedidos y libreta. Dos
convenciones que no se negocian: **importes en centavos enteros** y **nada se
cachea** (el stock cambia con cada venta del mostrador).

### `/api/erp/v1/*` — el ERP del comercio
`GET /productos`, `PUT /precios`, `PUT /stock`, `GET /ventas`. Existe para que
NexoPOS **no sea obligatorio**: un comercio con Odoo puede escribir precios y
stock, y leer lo que vendió el mostrador. Documentada en `/docs/api`.

### `/api/*` de plataforma — NexoB2B
Arbitraje de slugs y alta de regiones, más la puerta única de stock.

## 6. Flujo de datos

**Catálogo hacia adentro.** El comerciante navega el catálogo de B2B en vivo
(`/api/catalog`). Un producto entra al stock local cuando se recibe una compra,
cuando se lo da de alta a mano, o —si el negocio es mayorista y comercio a la
vez— con "Importar mi catálogo".

**Correcciones del catálogo.** Cada hora, `fichas` le pide a NexoB2B lo que
cambió desde un cursor `(fecha, id)` y actualiza títulos, fotos y clasificación.

**Ventas.** El mostrador descuenta stock, numera el ticket por comercio y, si
corresponde, registra deuda en la cuenta corriente y encola avisos a ClubPay y a
NexoB2B.

**Tienda online.** NexoTienda pide catálogo y campañas, y crea pedidos. **Los
totales los calculamos nosotros**: el precio y el stock del momento salen del
POS. Un pedido entregado termina como nota de venta, igual que una venta de
mostrador.

**Cuenta corriente.** Se abre en el mostrador, con el cliente presente. Los
movimientos se empujan a ClubPay para que la persona los vea en su app; la
libreta se abre en la tienda canjeando un token de un solo uso.

## 7. Dependencias externas

| De quién | Para qué | Si se cae |
|---|---|---|
| NexoB2B | login, catálogo, órdenes, fichas | no se puede entrar; el stock local sigue andando |
| ClubPay | descuentos de socios, libreta | el mostrador vende igual; los avisos se acumulan |
| NexoTienda | nada entrante crítico | los avisos de pedido se acumulan en cola |

Ninguna caída externa detiene una venta de mostrador. Es deliberado: el cajero
no puede quedarse esperando a una red.

## 8. Lo que corre en segundo plano

Cuatro colas y un refresco, todos con la misma forma: la fila se escribe **en la
misma transacción** que el cambio de estado, y la llamada por red ocurre
después, donde puede fallar sin arrastrar nada.

| Proceso | Cada | Reintentos |
|---|---|---|
| `clubpay-outbox` | 15 s | 1, 5, 15, 60 min y después 6 h · 12 intentos |
| `webhooks` (NexoTienda) | 15 s | ídem |
| `b2b-stock` | 15 s | ídem, con lote como clave de idempotencia |
| `fichas` | 1 h | cursor persistido, reanuda donde quedó |
| `refreshProductTaxonomy` | 12 h | sin cola: es idempotente |

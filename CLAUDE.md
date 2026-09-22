# NexoPOS — léeme primero

Punto de venta web para comercios del ecosistema **Nexo** (Linware). Gratuito
para comercios dados de alta en NexoB2B: **no hay alta propia en NexoPOS**, el
login es la cuenta de NexoB2B.

## Su lugar en el ecosistema

| Producto | Qué es | Relación con NexoPOS |
|---|---|---|
| **NexoB2B** | Núcleo B2B. Catálogo maestro, mayoristas, comercios, pedidos. | Fuente del alta, del login y del catálogo. |
| **NexoPOS** | Este repo. Mostrador, stock, cuentas corrientes, pedidos online. | — |
| **NexoTienda** | Tienda online del comercio, en `{slug}.nexotienda.app`. | Consume nuestra API `/v1`. Un solo servidor para todos los comercios. |
| **ClubPay** | App de fidelización: socios de clubes, descuentos, libreta. | Descuentos en el mostrador y la libreta del cliente en su teléfono. |

## Stack

- **Backend** `backend/` — Node + TypeScript + Express + PostgreSQL con `pg`.
  **SQL a mano, sin ORM.** Migraciones `.sql` numeradas que corren al arrancar;
  si una falla, el proceso termina (`process.exit(1)`).
- **Frontend** `frontend/` — Next.js 15 (App Router) + React 19.
  **Sin framework de CSS**: variables en `app/globals.css`.
- **Deploy** `deploy/` — VPS propio, systemd + nginx. Sin Docker en producción.

## Estructura

```
backend/src/
  index.ts          monta todas las rutas — el mapa del sistema
  config.ts         variables de entorno, con el porqué de cada default
  migrations/       001..041, numeradas, se aplican al arrancar
  modules/          un archivo por área (ventas, stock, campañas, …)
  integrations/     nexob2b.ts y clubpay.ts: todo lo que sale por red
  middleware/       auth (JWT), api-key (NexoTienda), erp-key, error
  lib/              fechas, slug, identidad
frontend/app/
  (dashboard)/      pantallas del comerciante, con layout y menú
  docs/api/         documentación pública de la API para ERP (sin login)
docs/               esta documentación + los acuerdos entre equipos
```

## Servicios que corren solos

Arrancan en `index.ts` y trabajan en segundo plano:

| Servicio | Qué hace |
|---|---|
| `clubpay-outbox` | Movimientos de cuenta corriente hacia ClubPay, con reintentos. |
| `webhooks` | Avisos de cambio de estado de pedido hacia NexoTienda. |
| `b2b-stock` | Avisos de stock hacia NexoB2B (sólo si el comercio lo prendió). |
| `fichas` | Trae del catálogo maestro las fichas corregidas, cada hora. |
| `refreshProductTaxonomy` | Nombres de pasillo/rubro/subrubro, cada 12 h. |

## Reglas que no se rompen

1. **El `commerce_id` sale del JWT, nunca del body ni de la query.** Es lo único
   que separa los datos de un comercio de los de otro.
2. **Centavos enteros en toda la frontera `/v1`.** Adentro es NUMERIC en pesos;
   la conversión ocurre en esa frontera y en ningún otro lado.
3. **Fechas del negocio en `America/Argentina/Cordoba`**, nunca en la zona del
   servidor. Los helpers están en `backend/src/lib/fechas.ts`.
4. **Los avisos salientes se encolan dentro de la misma transacción** que el
   cambio de estado, y se mandan por red después. Nunca al revés.
5. **Un precio se escribe en un solo lugar.** El precio de campaña vive en
   `modules/campanas-precio.ts` y lo importan las tres consultas que lo usan
   (catálogo, ficha y pedido). Si se copia, divergen.
6. **Rutas literales antes que comodines.** `/orden` va antes que `/:id`, o
   Express le pasa `"orden"` como id. Ya pasó tres veces.
7. **Un parámetro SQL necesita tipo.** `$5 IS NOT NULL` sin cast hace que
   Postgres rechace la consulta entera. TypeScript no mira adentro del SQL.
8. **Nunca precio de venta automático desde el costo de NexoB2B.** Ese número
   es el costo; usarlo de precio hace vender a costo miles de productos.

## Antes de modificar algo

1. Leer este archivo.
2. Leer `docs/CURRENT_STATE.md`.
3. Leer **sólo** los documentos relacionados con la tarea (tabla de abajo).
4. No recorrer el repositorio entero sin necesidad.
5. No analizar `node_modules/`, `.next/`, `dist/`, logs, backups ni caches.
6. No leer los otros proyectos del ecosistema salvo que la tarea sea una
   integración concreta con ellos.

## Qué leer según la tarea

| Tarea | Documentos |
|---|---|
| Entender el sistema | `ARCHITECTURE.md` |
| Saber qué anda y qué no | `CURRENT_STATE.md` |
| Tocar tablas o migraciones | `DATABASE.md` |
| Hablar con B2B / Tienda / ClubPay | `INTEGRATIONS.md` |
| Cambiar algo que otro sistema consume | `API_CONTRACTS.md` |
| Desplegar o mirar el servidor | `DEPLOYMENT.md` |
| Entender por qué algo es así | `DECISIONS.md` |

Los `PEDIDO-*.md` y `RESPUESTA-*.md` de `docs/` son la correspondencia con los
otros equipos. Son la fuente de los contratos, pero **el código manda**: ante
una contradicción, vale lo que hace el código.

## Cómo se trabaja

- **El código es de este repo; el deploy lo hace German.** Nunca desplegar sin
  que lo pida.
- Al terminar, decirle cuántos commits quedan sin desplegar y, **inmediatamente
  debajo**, el comando:

  ```bash
  sudo bash /opt/nexopos/deploy/02-deploy-app.sh
  ```

- **Verificar contra la base o la API antes de decir que algo anda.** Un
  `tsc --noEmit` no prueba una consulta SQL.
- Los comentarios del código explican **por qué**, no qué. Mantener ese tono.
- Cuando un cambio afecta a otro equipo, dejar el `.md` en `docs/` para que
  German lo reenvíe.

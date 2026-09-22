# Despliegue

**Ningún secreto va en este archivo ni en ningún otro del repositorio.**
Los valores reales viven en `backend/.env` del servidor, que está en
`.gitignore` y tiene permisos `600`.

---

## Producción

| | |
|---|---|
| Dominio | `https://nexopos.app` |
| Servidor | VPS propio de Linware. **Sin Docker.** |
| Ruta de la app | `/opt/nexopos` |
| Usuario del sistema | `nexopos` |
| Backend | `nexopos-backend.service` · puerto **4000** |
| Frontend | `nexopos-frontend.service` · puerto **3000** |
| Base | PostgreSQL local, puerto **5432**, base `nexopos` |
| Proxy | nginx + certbot |
| Repositorio | `https://github.com/napy77/nexopos.git` |

### Qué proxea nginx

| Ruta | Va a |
|---|---|
| `/api/` | backend `127.0.0.1:4000` |
| `/v1/` | backend `127.0.0.1:4000` |
| `/health` | backend `127.0.0.1:4000` |
| `/` | frontend `127.0.0.1:3000` |

**`/v1/` necesita su propio bloque.** Sin él, todo lo que consume NexoTienda cae
en el 404 de Next.js y el error no se parece a lo que pasa.

## Desplegar

Un solo comando, en el servidor, como root:

```bash
sudo bash /opt/nexopos/deploy/02-deploy-app.sh
```

Hace: `git pull --ff-only` → `npm ci && npm run build` del backend → ídem del
frontend → instala y reinicia los servicios systemd → recarga nginx.

**Las migraciones corren solas** al arrancar el backend. No hay paso aparte.

La primera vez, `01-install-server.sh` prepara el servidor (PostgreSQL, Node,
nginx, el usuario y la contraseña de la base en `/etc/nexopos/db.pass`).

### Verificar que quedó

```bash
curl -s https://nexopos.app/health
```

Devuelve el **commit desplegado**, si está en modo mock y cuándo arrancó. Es la
forma de saber si el servidor tiene el código que uno cree, sin entrar por SSH.

### Logs

```bash
journalctl -u nexopos-backend -f
journalctl -u nexopos-frontend -f
```

Cuando un comerciante reporta *"Ocurrió un error inesperado (referencia XXXXXX)"*,
ese código está en el log con la ruta, el comercio y el stack completo:

```bash
journalctl -u nexopos-backend --since "1 hour ago" | grep -A 12 "error XXXXXX"
```

### Rollback

**No hay un script de rollback.** Se vuelve moviendo el repo del servidor a un
commit anterior y volviendo a correr el deploy:

```bash
sudo -u nexopos git -C /opt/nexopos checkout <commit>
sudo bash /opt/nexopos/deploy/02-deploy-app.sh
```

**Las migraciones no se revierten.** No hay `down`. Un rollback de código sobre
un esquema ya migrado sólo es seguro si las migraciones nuevas son aditivas —
que es como se escriben, pero hay que mirarlo antes.

*PENDIENTE DE VALIDAR: nunca se hizo un rollback en producción.*

## Variables de entorno

Nombres y para qué sirven. Los valores están en el servidor.
`backend/.env.example` tiene la lista con el porqué de cada default.

| Variable | Si está vacía |
|---|---|
| `PORT`, `DATABASE_URL`, `JWT_SECRET` | defaults de desarrollo |
| `NEXOB2B_API_URL` | **modo mock**: catálogo y login simulados |
| `NEXOB2B_PUBLISHABLE_KEY` | — |
| `NEXOB2B_PUBLIC_URL` | usa `NEXOB2B_API_URL` |
| `CLUBPAY_API_URL` | modo demo. **El QR lleva una URL falsa que la app no abre.** |
| `CLUBPAY_STATEMENTS` | los resúmenes quedan retenidos en la cola (default) |
| `NEXOPOS_PLATFORM_KEY` | los endpoints de plataforma devuelven **503** |
| `NEXOTIENDA_KEY_CATALOGO` / `_PEDIDOS` / `_CUENTAS` | esa capacidad queda cerrada |
| `NEXOTIENDA_WEBHOOK_URL` / `_SECRET` | los avisos **se acumulan**, no se pierden |
| `PUBLIC_URL` | usa `https://nexopos.app` para armar la URL del webhook de stock |

Generar una clave: `openssl rand -hex 32`.

## Desarrollo

```bash
cd backend  && npm install && npm run dev    # 4000
cd frontend && npm install && npm run dev    # 3000
```

Con `NEXOB2B_API_URL` vacío se entra con cualquier email y password `demo`.

**La base local:** el `docker-compose.yml` del repo levanta PostgreSQL 16 en el
**5433**, pero en la máquina de German hoy **no hay Docker**; la base se recreó
en el PostgreSQL de Homebrew, en el **5432**. Hay que apuntar `DATABASE_URL` a
donde esté realmente corriendo.

Las 41 migraciones levantan el esquema desde cero contra una base vacía.

### Diferencias desarrollo / producción

| | Desarrollo | Producción |
|---|---|---|
| NexoB2B | mock | API real |
| ClubPay | mock (QR falso) | API real |
| Base | local, puerto variable | local al servidor, 5432 |
| Build | `npm run dev` | `npm run build` + systemd |
| TLS | no | certbot |
| Migraciones | al arrancar | al arrancar |

## Reglas

- **El deploy lo hace German.** Nunca desplegar sin que lo pida.
- Al terminar un cambio, decirle **cuántos commits quedan sin desplegar** y
  poner el comando **inmediatamente debajo** de esa línea.
- El `.env` de producción no se pisa si ya existe: el script sólo lo genera la
  primera vez.
- nginx sólo se instala la primera vez. Después lo administra certbot, y pisar
  el archivo borraría el bloque SSL.

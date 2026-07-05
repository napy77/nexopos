# Deploy de NexoPOS en el VPS (Ubuntu)

Objetivo: https://nexopos.app sirviendo el frontend, con la API en `/api`
y PostgreSQL local.

## Requisitos previos

- VPS Ubuntu 24.04 o superior con acceso root (SSH).
- DNS: registros `A` de `nexopos.app` y `www.nexopos.app` apuntando a la IP
  del VPS (necesario para el certificado SSL).

## Pasos

```bash
# En el VPS, como root:
git clone https://github.com/napy77/nexopos.git /tmp/nexopos-deploy
cd /tmp/nexopos-deploy/deploy

# 1. Instala Node.js 22, PostgreSQL, nginx, certbot; crea usuario y DB
bash 01-install-server.sh

# 2. Clona el repo en /opt/nexopos, compila, genera .env,
#    instala servicios systemd y nginx
bash 02-deploy-app.sh

# 3. HTTPS (una sola vez, con el DNS ya propagado)
certbot --nginx -d nexopos.app -d www.nexopos.app
```

Listo: https://nexopos.app

Mientras `NEXOB2B_API_URL` esté vacío en `/opt/nexopos/backend/.env`, el
sistema corre en **modo mock** (login: cualquier email / password `demo`).
Para conectar con NexoB2B real, completar esa variable y
`NEXOB2B_API_KEY`, y reiniciar: `systemctl restart nexopos-backend`.

## Actualizar a una nueva versión

```bash
cd /opt/nexopos/deploy && sudo bash 02-deploy-app.sh
```

(hace `git pull`, recompila y reinicia los servicios; el `.env` existente
no se toca)

## Operación

| Qué | Comando |
|---|---|
| Logs backend | `journalctl -u nexopos-backend -f` |
| Logs frontend | `journalctl -u nexopos-frontend -f` |
| Reiniciar | `systemctl restart nexopos-backend nexopos-frontend` |
| Estado | `systemctl status nexopos-backend` |
| Salud API | `curl localhost:4000/health` |
| Password DB | `/etc/nexopos/db.pass` |
| Config app | `/opt/nexopos/backend/.env` |
| Backup DB | `sudo -u postgres pg_dump nexopos > backup.sql` |

## Arquitectura en el VPS

```
Internet → nginx :443 (SSL certbot)
             ├── /api, /health → backend  :4000 (systemd, node dist/index.js)
             └── /*            → frontend :3000 (systemd, next start)
                                    backend → PostgreSQL :5432 (local)
```

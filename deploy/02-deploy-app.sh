#!/usr/bin/env bash
#
# NexoPOS · Deploy / actualización de la app
# Clona (o actualiza) el repo, compila backend y frontend, genera el .env
# la primera vez, instala los servicios systemd y la config de nginx.
#
# Uso (como root, después de 01-install-server.sh):
#   sudo bash 02-deploy-app.sh
#
# Re-ejecutar este mismo script para desplegar nuevas versiones.
#
set -euo pipefail

REPO_URL="https://github.com/napy77/nexopos.git"
APP_DIR=/opt/nexopos
DOMAIN=nexopos.app

if [[ $EUID -ne 0 ]]; then
  echo "Ejecutar como root: sudo bash $0" >&2
  exit 1
fi

echo "══ 1/5 · Código fuente ══════════════════════════════════════════"
if [[ -d "$APP_DIR/.git" ]]; then
  # git como el dueño del repo (root lo rechaza por "dubious ownership")
  sudo -u nexopos git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
  chown -R nexopos:nexopos "$APP_DIR"
fi

echo "══ 2/5 · Backend: dependencias, .env y build ════════════════════"
ENV_FILE="$APP_DIR/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  DB_PASS=$(cat /etc/nexopos/db.pass)
  JWT_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
PORT=4000
DATABASE_URL=postgres://nexopos:${DB_PASS}@localhost:5432/nexopos
JWT_SECRET=${JWT_SECRET}
# Completar cuando se integre con el backend real de NexoB2B.
# Vacío = modo mock (login demo: cualquier email / password 'demo')
NEXOB2B_API_URL=
NEXOB2B_API_KEY=
CATALOG_SYNC_INTERVAL_MIN=60
EOF
  chown nexopos:nexopos "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  .env generado (JWT y password de DB nuevos)"
fi
sudo -u nexopos bash -c "cd $APP_DIR/backend && npm ci && npm run build"

echo "══ 3/5 · Frontend: dependencias y build ═════════════════════════"
sudo -u nexopos bash -c "cd $APP_DIR/frontend && npm ci && npm run build"

echo "══ 4/5 · Servicios systemd ══════════════════════════════════════"
cp "$APP_DIR/deploy/nexopos-backend.service" /etc/systemd/system/
cp "$APP_DIR/deploy/nexopos-frontend.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nexopos-backend nexopos-frontend
systemctl restart nexopos-backend nexopos-frontend

echo "══ 5/5 · nginx ══════════════════════════════════════════════════"
# Solo instalar la config la primera vez: después la administra certbot
# (pisar el archivo borraría el bloque SSL que certbot agrega)
if [[ ! -f /etc/nginx/sites-available/nexopos ]]; then
  cp "$APP_DIR/deploy/nginx-nexopos.conf" /etc/nginx/sites-available/nexopos
  ln -sf /etc/nginx/sites-available/nexopos /etc/nginx/sites-enabled/nexopos
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t && systemctl reload nginx

echo
echo "✔ Deploy completo."
echo "  Backend:  http://localhost:4000/health"
echo "  Frontend: http://localhost:3000"
echo "  Web:      http://${DOMAIN}"
echo
echo "Para HTTPS (una sola vez, con el DNS ya apuntando al VPS):"
echo "  certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo
echo "Logs:  journalctl -u nexopos-backend -f"
echo "       journalctl -u nexopos-frontend -f"

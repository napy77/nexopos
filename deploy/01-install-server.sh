#!/usr/bin/env bash
#
# NexoPOS · Instalación del servidor (Ubuntu 24.04+)
# Instala: Node.js 22 LTS, PostgreSQL, nginx, certbot.
# Crea: usuario de sistema "nexopos", base de datos y credenciales.
#
# Uso (como root en el VPS):
#   sudo bash 01-install-server.sh
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Ejecutar como root: sudo bash $0" >&2
  exit 1
fi

echo "══ 1/6 · Paquetes base ══════════════════════════════════════════"
apt-get update
apt-get install -y curl git ca-certificates gnupg ufw

echo "══ 2/6 · Node.js 22 LTS (NodeSource) ════════════════════════════"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

echo "══ 3/6 · PostgreSQL ═════════════════════════════════════════════"
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

echo "══ 4/6 · nginx + certbot ════════════════════════════════════════"
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx

echo "══ 5/6 · Usuario de sistema y base de datos ═════════════════════"
if ! id nexopos &>/dev/null; then
  useradd --system --create-home --shell /bin/bash nexopos
fi

DB_PASS_FILE=/etc/nexopos/db.pass
mkdir -p /etc/nexopos
chmod 750 /etc/nexopos
if [[ ! -f "$DB_PASS_FILE" ]]; then
  DB_PASS=$(openssl rand -hex 24)
  echo "$DB_PASS" > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
else
  DB_PASS=$(cat "$DB_PASS_FILE")
fi

# Usuario y DB idempotentes
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nexopos') THEN
    CREATE ROLE nexopos LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE nexopos WITH PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'nexopos'" | grep -q 1 \
  || sudo -u postgres createdb -O nexopos nexopos

echo "══ 6/6 · Firewall ═══════════════════════════════════════════════"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo
echo "✔ Servidor listo."
echo "  Password de PostgreSQL guardada en: $DB_PASS_FILE"
echo "  Siguiente paso: bash 02-deploy-app.sh"

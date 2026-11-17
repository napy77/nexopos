#!/usr/bin/env bash
#
# Genera el instalador y lo publica en https://nexopos.app/descargas/
#
# Uso, desde la Mac:
#   bash /Users/german/ClaudeCode/nexo-pos/desktop/publicar.sh usuario@servidor
#
# Pide la contraseña de sudo en el servidor. Antes de correrlo:
#   - probar el instalador en Windows: publicar actualiza todas las cajas;
#   - subir la versión en desktop/package.json si cambió algo de desktop/,
#     o las apps instaladas no se enteran de que hay una nueva;
#   - que el servidor tenga este repo desplegado (usa deploy/03-publicar-instalador.sh).
#
set -euo pipefail

SERVIDOR="${1:?Uso: bash /Users/german/ClaudeCode/nexo-pos/desktop/publicar.sh usuario@servidor}"
cd "$(dirname "$0")"

npm run dist

ARCHIVO=$(sed -n 's/^path: *//p' release/latest.yml | tr -d "'\"")
echo
echo "Subiendo $ARCHIVO a ${SERVIDOR}…"
ssh "$SERVIDOR" "rm -rf /tmp/nexopos-instalador && mkdir -p /tmp/nexopos-instalador"
scp release/latest.yml "release/$ARCHIVO" "release/$ARCHIVO.blockmap" "$SERVIDOR:/tmp/nexopos-instalador/"
ssh -t "$SERVIDOR" "sudo bash /opt/nexopos/deploy/03-publicar-instalador.sh /tmp/nexopos-instalador && rm -rf /tmp/nexopos-instalador"

#!/usr/bin/env bash
#
# NexoPOS · Publica el instalador de Windows en https://nexopos.app/descargas/
#
# Uso (como root, en el servidor):
#   sudo bash /opt/nexopos/deploy/03-publicar-instalador.sh /tmp/nexopos-instalador
#
# La carpeta tiene que traer lo que deja `npm run dist` en desktop/release/:
# latest.yml, el .exe y su .blockmap. Lo normal es no correr esto a mano sino
# `bash /Users/german/ClaudeCode/nexo-pos/desktop/publicar.sh usuario@servidor` desde la Mac, que lo sube y lo llama.
#
# Al publicar pasan dos cosas: la sección «NexoPOS para Windows» aparece en el
# sitio, y las apps ya instaladas se actualizan a esta versión. Publicar sólo
# lo que se probó en Windows.
#
set -euo pipefail

ORIGEN="${1:?Falta la carpeta con latest.yml, el .exe y el .blockmap}"
DESTINO=/var/www/nexopos/descargas

if [[ $EUID -ne 0 ]]; then
  echo "Ejecutar como root: sudo bash $0 $ORIGEN" >&2
  exit 1
fi

YML="$ORIGEN/latest.yml"
[[ -f "$YML" ]] || { echo "No está $YML" >&2; exit 1; }

ARCHIVO=$(sed -n 's/^path: *//p' "$YML" | tr -d "'\"")
VERSION=$(sed -n 's/^version: *//p' "$YML" | tr -d "'\"")
SHA=$(sed -n 's/^sha512: *//p' "$YML" | tr -d "'\"")

# El sitio arma la URL con este nombre: un espacio la rompe.
if [[ ! "$ARCHIVO" =~ ^[A-Za-z0-9._-]+\.exe$ ]]; then
  echo "latest.yml apunta a «$ARCHIVO»: tiene que ser un .exe sin espacios." >&2
  echo "Regenerá el instalador con el artifactName de desktop/package.json." >&2
  exit 1
fi
[[ -f "$ORIGEN/$ARCHIVO" ]] || { echo "No está $ORIGEN/$ARCHIVO" >&2; exit 1; }

# Un .exe que llegó cortado y un latest.yml sano hacen que todas las cajas
# bajen un instalador roto. Se compara contra el hash que escribió el build.
echo "Verificando ${ARCHIVO}…"
REAL=$(openssl dgst -sha512 -binary "$ORIGEN/$ARCHIVO" | base64 -w0)
if [[ "$REAL" != "$SHA" ]]; then
  echo "El .exe no coincide con latest.yml (se subió incompleto o es de otro build)." >&2
  exit 1
fi

mkdir -p "$DESTINO"

# Primero el instalador, al final latest.yml: mientras no cambia el yml, el
# sitio y las apps siguen apuntando a la versión anterior, que sigue ahí.
# Al revés, durante la copia habría un link a un archivo que no existe.
install -m 644 "$ORIGEN/$ARCHIVO" "$DESTINO/$ARCHIVO"
[[ -f "$ORIGEN/$ARCHIVO.blockmap" ]] && install -m 644 "$ORIGEN/$ARCHIVO.blockmap" "$DESTINO/$ARCHIVO.blockmap"
install -m 644 "$YML" "$DESTINO/latest.yml.nuevo"
mv -f "$DESTINO/latest.yml.nuevo" "$DESTINO/latest.yml"

# Las versiones viejas no se borran: alguien puede estar bajándola ahora.
echo
echo "✔ Publicada la versión $VERSION"
echo "  https://nexopos.app/descargas/$ARCHIVO"
echo "  Comprobar: curl -s https://nexopos.app/descargas/latest.yml"

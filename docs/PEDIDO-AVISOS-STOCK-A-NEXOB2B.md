# Pedido a NexoB2B: los avisos de stock nunca llegaron a NexoPOS

**De:** NexoPOS · **Para:** NexoB2B · **Fecha:** 28/10/2026
**Sobre:** stock compartido del comercio híbrido (`avisarStockAlPos`, `lib/stock.ts`)

## Qué pasa

En producción, **NexoPOS nunca recibió un aviso de stock de NexoB2B**. Ni por la
puerta de plataforma (`POST /api/nexob2b/stock`) ni por la vieja con token.

Lo comprobamos de dos formas, en el servidor de nexopos.app:

- **nginx:** en todos los access logs que hay (incluidos los rotados), cero
  pedidos a `/api/nexob2b/stock`, con o sin token. Los avisos no se rechazan:
  **no llegan**.
- **Base:** cero movimientos de stock con origen NexoB2B, en ningún comercio y
  desde siempre.

La otra mitad sí está prendida: en el comercio híbrido (Rivera Hogar, 7441
productos propios) el interruptor estaba encendido. Cada venta del mostrador
baja el stock en B2B, pero lo que se despacha por mayor nunca baja en el POS.
El número del mostrador queda alto, y la caja vende unidades que ya salieron en
un camión. Es la media sincronización que los dos queríamos evitar. Mientras
esto no se resuelva, el interruptor de ese comercio va apagado.

## Por qué creemos que no sale, en orden de probabilidad

Leímos `apps/backend/src/lib/stock.ts` y `lib/nexopos.ts` en el repo de ustedes.

### 1. Red: el servidor de B2B no llega a nexopos.app por su IP pública

nexob2b.app y nexopos.app están detrás del mismo router del datacenter de
Linware, que **no tiene NAT loopback**. A nosotros nos pasó al revés: el VPS de
NexoPOS no llegaba a `https://nexob2b.app` y lo resolvimos con una entrada en
`/etc/hosts` que apunta el dominio a la IP interna.

`avisarStockAlPos` llama a `${NEXOPOS_API_URL || "https://nexopos.app"}`. Si el
servidor de ustedes resuelve nexopos.app a `181.111.252.198`, el `fetch` se
cuelga o falla, y el aviso termina en un `console.warn` que nadie mira. Esto
también explica por qué nginx no registra nada.

**Cómo verificarlo**, desde el servidor de B2B:

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 https://nexopos.app/health
```

Si no da `200` en un par de segundos, es esto. **Arreglo:** una línea en
`/etc/hosts` del servidor de B2B con la IP **interna** de nexopos.app. Así el
dominio y el certificado siguen siendo los mismos. Poner una IP en
`NEXOPOS_API_URL` no sirve con https, porque el certificado es del dominio.

También pueden buscarlo en su log:

```bash
journalctl -u <servicio-backend-b2b> --since "30 days ago" | grep -E "\[nexopos\] (No pudimos avisar|Falta NEXOPOS_PLATFORM_KEY|NexoPOS no conoce)"
```

### 2. El filtro de la consulta deja afuera al comercio

`avisarCambioDeStock` sólo avisa si se dan **las dos** condiciones:

- un vínculo `mayorista_comercio` en estado `confirmado` entre el mayorista y
  la cuenta de comercio de Rivera Hogar, y
- una `nexo_api_key` **activa, de tipo `nexopos`**, con `entidad_id` = el
  `com_…` de Rivera Hogar.

Si falta cualquiera, no sale nada y no queda rastro. La segunda es fácil de no
tener: después de la puerta única, esa key ya no se usa para nada más que este
filtro, y nadie tiene motivo para crearla.

**Pedido:** confirmar las dos para Rivera Hogar. Y, si les parece, sacar la
condición de la API key: el 404 que les devolvemos cuando no conocemos un
comercio ya cumple esa función, y sin el filtro nadie depende de crear una key
que no hace nada.

### 3. El despliegue

Que el servidor de producción tenga el código con la puerta única
(`avisarStockAlPos` con `POST /api/nexob2b/stock`) y `NEXOPOS_PLATFORM_KEY` en
su `.env`. Si falta la clave, el log dice `Falta NEXOPOS_PLATFORM_KEY` en cada
cambio de stock.

## Qué sacamos de nuestro lado (28/10)

- **La puerta por comercio, `POST /api/nexob2b/stock/:token`, ya no existe**
  (responde 404), y con ella el token y el secreto por comercio y la pantalla
  que pedía pegarlos «en la clave de API de tu comercio». El portal del comercio
  no tiene ese lugar, y la puerta nunca recibió un aviso.
- **Queda una sola entrada:** `POST https://nexopos.app/api/nexob2b/stock` con
  `Authorization: Bearer <NEXOPOS_PLATFORM_KEY>`, el contrato de
  `PEDIDO-PUERTA-UNICA-A-NEXOB2B.md`, sin cambios.
- **Ahora cruzamos también por `pmp_id`.** Antes sólo buscábamos por
  `presentacion_id`, y un producto que entró por una recepción de compra
  (guardado con su `pmp_…`) no se encontraba. Pueden seguir mandando los dos.
- **La pantalla muestra cuándo llegó el último aviso**, o que no llegó ninguno.
  El comerciante ya no ve un interruptor prendido como si anduviera.

En el admin de ustedes, el campo «Webhook URL» de una key tipo NexoPOS todavía
sugiere `https://nexopos.app/api/nexob2b/stock/…`. Esa dirección ya no existe;
conviene sacar el placeholder o el campo para ese tipo.

## Cómo lo probamos juntos

1. Arreglan lo que corresponda de lo de arriba y nos avisan.
2. Prendemos el interruptor de Rivera Hogar.
3. Despachan o editan en el portal el stock de **un** producto propio de Rivera.
4. Nosotros confirmamos el movimiento `NexoB2B (portal)` en el historial del
   producto, y la pantalla pasa a «Último aviso de NexoB2B: …».

Si el `curl` del punto 1 da `200`, las dos condiciones del punto 2 están y el
paso 3 igual no llega, pásennos la línea de log de ese momento y lo seguimos
juntos.

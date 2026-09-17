# Fichas modificadas: cómo nos enteramos de que corrigieron un título

## El problema

Un mayorista subió 7000 productos. Después corrigió títulos que estaban mal y
cargó fotos que faltaban. Esas correcciones no llegan a NexoPOS.

Hoy la ficha de un producto se copia a NexoPOS en un solo momento —cuando el
comercio recibe una compra que lo incluye, o cuando importa su catálogo
propio— y ahí se congela. Si el comercio no vuelve a comprar ese artículo, se
queda con el título viejo para siempre.

El único camino que existe es que el comerciante apriete "Importar mi catálogo"
otra vez, y eso sólo sirve al que es mayorista y comercio a la vez. Al almacén
que le compró a este mayorista no le llega nada.

## Lo que pedimos

Un campo de última modificación en la ficha maestra, y una forma de preguntar
qué cambió desde una fecha.

### 1. `actualizado_at` en la ficha

En los productos que ya devuelven hoy (`/store/productos`,
`/api/v1/pos/productos`), agregar:

```json
{ "id": "pm_...", "nombre": "...", "actualizado_at": "2026-09-16T14:32:10.000Z" }
```

Con eso cualquiera puede comparar contra lo que tiene guardado sin pedir nada
más.

Lo que nos importa que mueva esa fecha: **título, descripción, marca, EAN,
foto de portada, galería y clasificación**. Un cambio de precio o de stock no
necesita moverla —esos ya nos llegan por otro lado— y si la mueve, nos hace
releer 7000 fichas para no cambiar nada.

### 2. `GET /api/v1/fichas?desde=ISO`, con la clave de plataforma

Lo que evita las 7000 llamadas:

```
GET /api/v1/fichas?desde=2026-09-15T00:00:00Z
Authorization: Bearer <NEXOPOS_PLATFORM_KEY>

→ 200
{
  "productos": [
    {
      "id": "pm_...",
      "ean": "779...",
      "nombre": "Access Point Huawei eKitEngine AP263",
      "descripcion": "...",
      "marca": "HUAWEI",
      "unidad_base": "unidad",
      "alicuota_iva": 10.5,
      "imagen_url": "/media/...",
      "imagenes": [ { "url": "...", "tipo": "imagen", "descripcion": null } ],
      "pasillo_id": null,   "pasillo_nombre": null,
      "rubro_id": "ru_...", "rubro_nombre": "Informática",
      "subrubro_id": "sr_...", "subrubro_nombre": "Periféricos y Componentes",
      "presentaciones": [ { "id": "pp_...", "nombre": "unidad", "factor": 1, "ean_propio": null } ],
      "actualizado_at": "2026-09-16T14:32:10.000Z"
    }
  ],
  "hasta": "2026-09-16T14:32:10.000Z",
  "hay_mas": false
}
```

`hasta` es la fecha del último que mandaron; la próxima llamada va con ese
`desde`. `hay_mas` dice si quedó cola. Es la misma forma que tiene nuestro
`GET /api/erp/v1/ventas`, que ya usan los ERP y funciona.

**Con la clave de plataforma y no con el JWT de un comercio**, por tres
razones: la ficha maestra no es de nadie en particular —el título de un access
point es el mismo para los cuarenta almacenes que lo venden—, así lo corremos
una vez por noche y no una vez por comercio, y no depende de que el token de
sesión de alguien no haya vencido.

Es la misma puerta que acordamos para el stock. Nos gusta que sea la misma.

## Por qué esto arregla tres cosas de una

**Los productos comprados.** El almacén que le compró a este mayorista recibe
el título corregido y la foto nueva sin tener que volver a comprar.

**El catálogo propio.** Hoy se arregla apretando "Importar mi catálogo", pero
sólo si alguien se acuerda de apretarlo. Con esto se arregla solo.

**Los ids de taxonomía.** Este es el que no es obvio. `/api/v1/pos/productos`
manda los nombres de pasillo, rubro y subrubro pero no los ids. Por eso, en los
productos que entraron por la importación de catálogo propio, `pasillo_id` está
en NULL — y nuestro trabajo que resincroniza los nombres de taxonomía cada 12
horas cruza justamente por id, así que a esos productos nunca les llega un
rubro renombrado.

Si las fichas de este endpoint traen los ids, esos productos quedan completos y
ese tercer agujero se cierra sin que ninguno de los dos haga nada más. Es el
mismo problema que causó que la tienda de Rivera Hogar mostrara una sola
categoría con todo el local adentro.

## Dos cosas que no hace falta que resuelvan

**Los productos dados de baja.** Si sacan un producto del catálogo maestro, no
lo manden en esta lista y no hagan nada especial: nosotros no lo vamos a
borrar. Un comercio puede tener unidades en la góndola de algo que el
marketplace dejó de listar, y borrárselo le rompe el stock.

**La foto que el comerciante subió.** Si él cargó su propia foto desde el POS,
gana la suya. La del catálogo se guarda igual, pero no se muestra. Eso ya está
resuelto de nuestro lado.

## Lo que hacemos nosotros cuando esté

Un trabajo nocturno que guarda la última fecha leída, pide lo que cambió desde
ahí y actualiza las fichas locales. Una llamada por noche para toda la
plataforma, no una por comercio.

Mientras tanto, al que es mayorista y comercio a la vez le decimos que apriete
"Importar mi catálogo", que refresca título, foto y galería. Al que compró no
tenemos nada que decirle, y por eso es este pedido.

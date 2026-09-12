# Galería de fotos por producto

NexoB2B empezó a mandar varias fotos por producto y ya las estamos sirviendo.
**Es aditivo: si hoy leen `imageUrl`, sigue funcionando igual.**

## Lo que agregamos

Un campo `images` en `Product`, en `GET /v1/stores/{storeId}/products` y en el
de un producto suelto:

```ts
interface Product {
  imageUrl?: string;   // la portada, como siempre
  images: string[];    // la galería completa, CON la portada primero
  …
}
```

**`images[0]` es la portada.** A diferencia de lo que manda NexoB2B —donde la
portada viene aparte y no se repite en el arreglo—, acá ya viene armada: es la
lista que se muestra, en orden, y no hay que concatenar nada.

Lo hicimos así porque del lado de ustedes lo único que importa es qué se ve y en
qué orden, y hacer que cada consumidor arme `[imageUrl, ...resto]` es repetir la
misma decisión en cada pantalla hasta que una la haga distinto.

**Nunca es `null`.** Un producto sin ninguna foto llega con `images: []`, y uno
con solo portada llega con un elemento. `imageUrl` sigue ahí para que no tengan
que cambiar nada hoy.

## Dos cosas que ya resolvimos de este lado

**La portada es la del comercio si subió una propia.** En el POS el comerciante
puede reemplazar la foto del catálogo por una suya —la saca él, del producto en
su góndola— y esa gana. Si la cambió es porque la del catálogo no le servía. Las
del catálogo siguen apareciendo detrás.

**Los videos quedan afuera.** NexoB2B tiene `tipo: "video"` en su modelo porque
el pedido original hablaba de multimedia; hoy no hay ninguno cargado. Los
filtramos: el día que aparezca uno, una galería que asume imágenes mostraría un
recuadro roto, y preferimos que no llegue a que llegue y rompa.

Si algún día quieren mostrarlos, avisen y los dejamos pasar con su tipo.

## Lo único que conviene que miren

Si la ficha del producto hoy asume una sola imagen, **revisen que una con cuatro
no les rompa el diseño.** Es el único efecto práctico del cambio, y es el mismo
que NexoB2B nos marcó a nosotros.

Un producto propio del comercio —la pizza, el pan— tiene una sola foto y va a
seguir llegando con `images` de un elemento: la galería viene del catálogo
maestro, y eso el comercio no lo carga.

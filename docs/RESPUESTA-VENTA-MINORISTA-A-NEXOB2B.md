# Venta minorista: lo que necesitamos para poder construirlo

El diseño nos cierra y el caso es real. Pero hay **un dato que falta en el
endpoint** y sin él no podemos cumplir el punto 3 —no duplicar—, así que va
primero.

Lo que sí hicimos ya es la protección del precio, que marcaron como lo más
importante.

---

## 1. Nos falta el id de la presentación maestra

`GET /api/v1/pos/productos` devuelve, en cada presentación:

```json
{ "id": "pmp_...", "nombre": "unidad", "factor": 1, "precio": 30899, "stock": 5 }
```

Ese `id` es `producto_mayorista_presentacion.id` —lo verificamos en su SQL, es
`pmp.id`—. O sea, **el listing de ese mayorista**, no el producto.

**La identidad del stock en NexoPOS es la presentación maestra**,
`producto_maestro_presentacion.id`. No es un capricho: ya nos pasó. El mismo
artículo entraba con dos identidades según por dónde se cargara —el maestro al
agregarlo del catálogo, el del mayorista al recibir una compra— y quedaban dos
filas con el mismo EAN, el mismo nombre y cada una con su stock. Lo arreglamos
con una migración que consolidó por nombre, y desde entonces la identidad es
la maestra.

Si importamos con el id del listing, **volvemos a ese bug**, y encima en el
caso que ustedes mismos describen en el punto 3: el producto propio y el mismo
producto comprado a otro mayorista entrarían como dos.

**Lo que pedimos**: que la presentación traiga también el id maestro.

```json
{ "id": "pmp_...", "presentacion_id": "pp_...", "nombre": "unidad", … }
```

Es el campo que **`/store/productos` ya devuelve** —ahí está como
`presentacion_id`, al lado del `id`—, así que es agregar la misma línea al
endpoint nuevo. Con eso importamos y deduplicamos solos.

Mientras no esté, **no construimos la importación**: preferimos no tenerla a
tenerla duplicando productos que después hay que consolidar a mano.

---

## 2. El precio mayorista: de acuerdo, y ya está protegido

Tienen razón y era el riesgo más caro del documento. **No vamos a usar `precio`
como precio de venta.** De B2B tomamos el catálogo y nada más; el precio de
mostrador lo pone el comerciante.

Su sugerencia —dejarlo sin precio y marcarlo— es la que implementamos, con una
vuelta de tuerca que conviene que sepan:

**Un producto sin precio de venta no sale a NexoTienda.** No como $0, no como
"consultar": directamente no aparece. Un producto en $0 alguien lo compra, y el
comercio se entera cuando cierra la caja.

En el mostrador tampoco se puede cobrar —ya daba error— y ahora además:

- Hay un aviso en la pantalla de Productos: *"N productos sin precio de venta.
  No se muestran en tu tienda online hasta que les pongas uno. El precio de
  NexoB2B es el mayorista: no es el tuyo."*
- Y un filtro para ver solo esos, porque con miles importados de una vez el
  comerciante no los encuentra de otra forma.

Ya está andando, verificado: con precio el producto aparece en la tienda, sin
precio desaparece y queda listado en el filtro.

---

## 3. El stock: no vamos a construir sobre esa suposición

Su recomendación es la correcta y la seguimos: **no asumimos stock compartido
hasta que la pregunta del ERP tenga respuesta.**

Dicho eso, queremos dejar por escrito lo que nos preocupa del modelo de dos
espejos, porque si el cliente contesta "sí, el ERP le escribe a los dos" igual
hay un agujero:

**El mostrador vende sin pasar por el ERP.** Cuando el cajero de Rivera pasa una
silla por la caja, eso lo descuenta NexoPOS en el momento. Si el ERP es la
fuente de verdad y reescribe el stock cada tanto, el próximo sync **pisa** ese
descuento y devuelve la unidad que ya se vendió.

Para que dos espejos funcionen, el ERP tiene que enterarse de las ventas del
mostrador — o sea que el flujo no es "el ERP escribe a los dos", es "el ERP
escribe y NexoPOS le avisa lo que vendió". Eso es una integración más, no la
misma.

**Lo podemos hacer**: exportar las ventas del día ya existe en el POS. Pero es
trabajo y hay que decidirlo, no darlo por hecho. Conviene preguntárselo al
cliente en la misma conversación: *¿el ERP puede leer las ventas del mostrador?*

---

## 4. Los casos borde, contestados

**Se desvincula.** Coincidimos: no los borramos. Un producto que el comerciante
ya cargó, con su precio de mostrador puesto y su stock contado, es suyo. Que
deje de ser "propio" solo cambia de dónde se repone, y eso ya lo maneja el POS
—un producto puede tener varios orígenes—.

**Pendientes de aprobación.** Nos parece bien el filtro y por la razón que dan:
NexoTienda es público. Un producto sin revisar publicado en la tienda de un
pueblo es peor que uno que tarda un rato en aparecer.

**Un comercio, un mayorista.** Anotado. Si aparece la cadena, el que se rompe
primero es el modelo de stock, no el del vínculo.

---

## Lo que queda, en orden

1. **Ustedes**: agregar `presentacion_id` a las presentaciones de
   `/api/v1/pos/productos`.
2. **Nosotros**: la importación de catálogo propio, apenas esté ese campo.
3. **El cliente**: si el ERP puede leer las ventas del mostrador.

La protección del precio ya está desplegada y no depende de ninguna de las tres.

# Los slugs: el endpoint está vivo, y su contrapropuesta está implementada

Desplegado. Pueden dar de alta Morrison.

## El 404 no lo reproducimos

Contra producción, ahora mismo:

```
GET  /api/slugs/morrison       → 401  {"error":"Clave de plataforma inválida"}
GET  /api/slugs/morrison  (sin header) → 401
PUT  /api/regiones/morrison    → 401
```

Con la clave correcta contestan 200. **Esa ruta no puede devolver 404**: sin
clave da 401 y, si el servidor no tuviera la clave configurada, 503.

Nuestra lectura es que probaron antes del despliegue que la incluía. Si les
sigue dando 404, mándennos el `curl -v` entero: la diferencia va a estar en el
prefijo o en el método, y con los headers se ve en un minuto.

Un detalle por si ayuda: **`/api/regiones/:slug` es `PUT`, no `GET`.** Un `GET`
ahí sí devuelve el 404 de Express, porque la ruta existe solo para ese verbo.

## Su contrapropuesta: tenían razón, y la implementamos

> «que sea POST reservando en vez de GET consultando. Una lectura no reserva
> nada, y entre que preguntamos y guardamos alguien puede tomar el slug.»

Correcto. Pero el problema no era el verbo: era que **la unicidad se validaba
consultando tres tablas y después se guardaba en otra**. Aunque hubiéramos hecho
un POST, entre el chequeo y el INSERT quedaba la misma ventana.

Ahora hay **un registro único de slugs, y su clave primaria es la reserva**. No
hay dos pasos que separar, así que no hay ventana que cerrar.

Para ustedes eso significa que **`PUT /api/regiones/:slug` ya es la reserva**:

- Si contesta **200**, el slug es suyo y nadie más lo puede tomar. Creen la
  región de su lado con tranquilidad.
- Si contesta **409**, lo tiene un comercio. No lo creen.

**Llamen a ese PUT primero y creen después.** No hace falta consultar antes: el
`GET /api/slugs/:slug` queda para mostrarle al admin si está libre mientras
escribe, que es otra cosa y no pretende garantizar nada.

Probado en los seis casos que importan, incluido que un comercio puede volver a
un slug que dejó atrás y que nadie más lo puede agarrar.

## Lo otro, corto

**`presentacion_id`: gracias.** Con eso arrancamos la importación del catálogo
propio. Era el único bloqueo.

**La autenticación de `/api/v1/pos/productos`: no la unifiquen todavía.** Vamos
a construir contra ese endpoint con el JWT de comercio, que ya tenemos; si la
cambian ahora nos rompen antes de empezar.

Si la quieren unificar igual —y entendemos por qué—, lo mejor es que **acepte
las dos durante una transición**: la API key nueva y el JWT viejo, hasta que
confirmemos que migramos. Así la rareza no queda para siempre y nadie se cae en
el medio.

**El stock**: la pregunta para el cliente queda como la dejamos, y es la que
decide si el modelo de dos espejos cierra. *¿El ERP puede leer las ventas del
mostrador?*

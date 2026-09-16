# `indice`, y la respuesta a lo que no les cerraba

## Primero lo que preguntaron, porque la respuesta corrige algo que escribimos

**Lo encontramos leyendo nuestro propio código. Nunca le pegamos al endpoint.**

No hay nada que ninguno de los dos no entienda. Lo que hay es un error nuestro
en el documento anterior: escribimos que "NexoB2B devuelve `pmp_id` siempre,
así que buscar el resultado por el campo que mandamos no lo encontraba". La
primera mitad es cierta; la segunda la dedujimos mal. Ustedes echan de vuelta
el campo que mandamos **además** de agregar `pmp_id`, así que nuestra búsqueda
habría funcionado y el bug no se habría manifestado.

Era un error real en nuestro código —buscábamos por el campo equivocado— pero
inofensivo contra su API. Lo describimos como si fuera a costar descuentos, y
eso no era cierto. Perdón por el rato de búsqueda.

Y hay una razón concreta por la que no podíamos haberlo visto probando: nuestro
mock devolvía `{...item, ok: true}`. Echaba exactamente el campo que le
mandábamos y nada más. Un cruce equivocado pasaba todas las pruebas locales.

Eso también lo arreglamos, y es el arreglo que más vale de los dos: el mock
ahora imita la forma exacta de su respuesta —`indice`, el campo que mandamos, y
`pmp_id` siempre—. Un mock más indulgente que la API no prueba nada; prueba que
el mock se lleva bien con el código, que es otra cosa.

## `indice`: tomado

Cruzamos por ahí. El orden queda de respaldo por si del otro lado corre una
versión anterior a este acuerdo, tal como plantearon.

Y agregamos una consecuencia que antes no estaba: **si no se puede cruzar, no
se da nada por bueno**. Si vuelven menos resultados que ítems y sin índice,
falla el lote entero y se reintenta con la misma clave, que es idempotente.
Antes, la fila se marcaba como enviada. Marcar una línea como enviada sin saber
si entró es exactamente la forma de perder un descuento en silencio, que es lo
que veníamos diciendo que hay que evitar — y lo teníamos nosotros.

Probado con la forma nueva: un lote de dos, uno por `presentacion_id` y otro
por `pmp_id` sin EAN, cruzados bien; y con el mock rechazando el índice 1, el
error cayó en la fila que le tocaba y la otra salió limpia.

## Sobre que la regeneración avise

Nos parece bien anotarlo y no hacerlo ahora, por la misma razón por la que
ustedes lo dejaron anotado: hoy lo hace una persona, y esa persona está mirando
la pantalla que le dice qué copiar.

Cuando lo hagamos, lo que nos gustaría que sea es esto, para que quede escrito:
que NexoPOS le avise a NexoB2B —con la clave de plataforma, que ya existe— que
el par de tal comercio cambió, y que del otro lado eso se vea como un aviso
para revisar, no como un valor que se escribe solo. Un sistema que se
reconfigura a sí mismo el secreto de otro es cómodo hasta el día que alguien
consigue disparar esa llamada.

## Estado

De los dos equipos no queda nada. Falta Rivera Hogar y su ERP.

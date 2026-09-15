# Sí, se puede liberar. Y cuándo conviene no hacerlo.

```
DELETE /api/regiones/{slug}
Authorization: Bearer <clave de plataforma>

→ 200  { "ok": true, "liberado": "morrison" }
→ 409  "No se borra: 3 comercios reparten en esa región. Sacálos primero…"
```

Desplegado. Borra la región y **libera el slug**, que es lo que les hacía falta
para el caso que describieron: reservan, les falla el guardado local, y queda un
slug tomado por algo que no existe.

**Es idempotente.** Borrar algo que ya no está contesta 200 con
`yaNoEstaba: true`. Si su reintento no sabe si el DELETE anterior llegó, puede
mandarlo igual.

## No borra una región que tenga comercios

Si hay aunque sea uno asignado, contesta **409** y dice cuántos son.

No es prudencia genérica: la relación comercio–región tiene `ON DELETE CASCADE`,
así que borrar la región se llevaría puestas las asignaciones sin que nadie lo
pida. El comerciante no se enteraría hasta que alguien busque su pueblo y no lo
encuentre. Con el 409 la decisión la toma una persona, con el número delante.

Si igual quieren borrarla, saquen los comercios primero. Eso es explícito y deja
rastro.

## La advertencia que importa: úsenlo para reservas, no para regiones vivas

El slug se libera junto con la región, y eso es correcto para una reserva que
nunca llegó a ser nada.

**Para una región que estuvo publicada, no lo es.** `morrison.nexotienda.app`
circuló por WhatsApp igual que la dirección de un comercio. Si liberamos ese
slug, mañana un comercio lo toma y hereda el tráfico del pueblo — gente que
buscaba "quién tiene lo que necesito en Morrison" cayendo en un almacén.

Es exactamente la razón por la que el slug anterior de un comercio **no se
libera nunca**. Con las regiones dejamos la puerta abierta porque su caso lo
necesitaba, pero la puerta corta.

Nuestra recomendación: **DELETE solo para reservas que fallaron.** Para una
región que estuvo viva, si alguna vez hace falta, hablémoslo — probablemente lo
correcto sea borrar la región y dejar el slug tomado, como hacemos con los
comercios.

## Renombrar una región: todavía no, y qué haría falta

No hay verbo para eso, y borrar-y-recrear no es un rename: los links viejos
mueren.

Lo que haría falta es lo mismo que ya tienen los comercios: que el slug viejo
siga resolviendo y redirija al nuevo. De nuestro lado es una tabla de slugs
anteriores de región y un `kind: "moved"` en la resolución de subdominio —que
NexoTienda ya sabe manejar, porque lo usa para los comercios que cambian de
dirección—.

**No lo construimos todavía** porque no sabemos si hace falta. Si les aparece el
caso, díganlo y lo hacemos con ese diseño; es media tarde.

## Lo demás

**El 404**: cierra con lo que cuentan. Si su cliente le pegaba a
`POST /api/slugs/:slug`, eso nunca existió — y vale la pena que anoten por qué
quedó escrito como acordado, porque es el tipo de cosa que vuelve a pasar.

**Autenticación y stock**: como quedó. Arrancamos la importación con el JWT.

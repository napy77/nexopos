# Una sola puerta para el stock, sin configurar nada por comercio

Nos equivocamos los dos en la forma, y lo vio German antes que nosotros.

El par de token y secreto por comercio funciona con Rivera Hogar. Con veinte
comercios es una persona copiando dos valores de una pantalla a otra, veinte
veces, y una equivocación no avisa: el stock deja de moverse y nadie se entera
hasta que alguien mira un número raro.

Lo diseñamos así porque ustedes ya tenían un campo de webhook por clave de API
y nosotros nos apoyamos en él. Es lo que había, no lo que hacía falta.

## Lo que está listo de nuestro lado

```
POST https://nexopos.app/api/nexob2b/stock
Authorization: Bearer <NEXOPOS_PLATFORM_KEY>
Content-Type: application/json

{
  "evento": "stock.actualizado",
  "origen": "despacho",
  "comercio_id": "com_xxx",
  "items": [
    { "presentacion_id": "pp_...", "pmp_id": "pmp_...", "stock": 47 }
  ],
  "enviado_at": "2026-09-16T12:00:00.000Z"
}
```

Sin token en la URL y sin secreto por comercio. La clave es la de plataforma
—la misma con la que verifican slugs, la que ya tienen en su `.env`— y el
comercio se identifica con **el id que ustedes mismos le asignaron**, el que
guardamos en `nexob2b_id`.

Respuestas:

```
200  { "ok": true, "aplicados": 1, "no_encontrados": 0 }
200  { "ok": true, "aplicados": 0, "motivo": "sincronización apagada" }
401  clave de plataforma inválida
404  no tenemos ningún comercio con ese id
```

El 404 es a propósito y es distinto del `no_encontrados`. Una presentación que
no está de este lado es normal —el comercio todavía no la importó— y va en el
contador. Un **comercio** que no está es otra cosa: ustedes creen tener un
comercio que de este lado no existe, y eso lo queremos ver los dos.

Probado: sin clave 401, clave equivocada 401, comercio desconocido 404,
correcto 200 con el movimiento asentado.

## Qué les pedimos

Que manden el aviso de stock por ahí en vez de por la URL con token. Un solo
destino para todos los comercios, fijo, que no cambia nunca.

La puerta por comercio la dejamos andando mientras tanto: sacarla antes de que
migren cortaría los avisos de Rivera sin que se note. Cuando confirmen que ya
no la usan, la sacamos y con ella se va toda la pantalla de copiar y pegar.

## Lo que esto también resuelve

Las dos cosas que habíamos dejado anotadas se caen solas:

- **Que la regeneración avise.** No hay nada que regenerar. Si mañana hay que
  rotar la clave de plataforma, es una y se rota una vez, no una por comercio.
- **El comerciante que se queda afuera solo.** No puede: no hay ningún paso
  suyo entre prender el interruptor y que el circuito funcione.

Y desaparece también la ventana de gracia del secreto, que existía sólo para
que el comerciante no se cortara los avisos mientras el par estaba a medio
cargar. Sin par que cargar, no hay medio camino.

## Una cosa que no cambia

El interruptor por comercio se queda. No es configuración técnica: es la
decisión del comerciante de que su mostrador y su depósito mayorista sean el
mismo número. Eso lo decide él y tiene que poder apagarlo.

Lo que se va es todo lo demás.

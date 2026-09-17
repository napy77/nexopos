# Abrir la libreta en otra pantalla: un código corto

Un caso que apareció probando NexoTienda: **la tienda abierta en la computadora
de casa y ClubPay en el teléfono.**

El handoff no lo cubre, porque abre la tienda *en el teléfono*. Y la compu no
tiene con qué demostrar quién es. Un QR tampoco sirve: nadie escanea su propia
pantalla.

La solución es un código corto que la persona lee en la compu y escribe en su
app. El pedido grande es de ustedes, que son los que tienen la app y la sesión.

## Lo que pedimos

```
POST /pos/tienda/pairings
X-API-Key: la clave del comercio
{ "device": "una computadora con Chrome" }
→ { "request_id": "…", "code": "VRCCX", "expira_at": "…" }

GET /pos/tienda/pairings/:request_id
X-API-Key: la clave del comercio
→ { "status": "pendiente" }
| { "status": "listo", "token": "…" }
| { "status": "vencido" }
```

**El `token` tiene que ser el mismo de un solo uso del handoff**, el que
`POST /pos/tienda/sessions` ya valida. Eso es lo que hace que todo termine en el
canje que ya funciona, y que no haya una segunda forma de abrir una sesión de
tienda: una segunda forma es una segunda superficie que auditar por el resto de
la vida del producto.

`request_id` opaco y no adivinable, por favor. No correlativo.

## Nuestra mitad ya está

Los dos endpoints nuestros son pase de pelota —`POST /v1/cuentas/emparejar` y
`GET /v1/cuentas/emparejar/:requestId`— y no guardan nada. Están construidos y
probados contra un simulador con la forma de arriba. En cuanto existan los
suyos, cambiamos la URL y anda.

Si la forma les queda mejor de otra manera, díganla: es una traducción de diez
líneas de nuestro lado.

## Una advertencia sobre el `device`, que es importante

NexoTienda lo describe como "la única defensa del mecanismo", y el razonamiento
es bueno: el ataque no es robarle el código a alguien —el código aparece en la
pantalla del que lo pidió— sino al revés, que el atacante abra el pedido en su
compu y convenza a la víctima de escribir *ese* código en su ClubPay.

Pero justamente por eso: **en ese ataque, el que pide el código es el atacante,
así que el `device` lo escribe él.** Nada le impide mandar "tu iPhone" y que la
pantalla de confirmación de la víctima diga exactamente lo que ella espera ver.

Nosotros lo pasamos tal cual y sin agregarle nada, como pidió NexoTienda. Pero
no conviene que sea lo único que sostiene la decisión de la persona.

Lo que sí es confiable en esa pantalla es **el nombre del comercio**, porque lo
deducen ustedes de la clave y no de lo que les mandamos. Nos parece que la
confirmación tiene que apoyarse ahí y en la pregunta, no en el dispositivo:

> Alguien está pidiendo abrir tu libreta de **Jure Hnos** en otra pantalla.
> Si no fuiste vos, no confirmes.
> *Dice ser: una computadora con Chrome.*

El "si no fuiste vos" no depende de ningún dato que el atacante controle. El
dispositivo ayuda en el caso honesto —"sí, es mi compu"— y ahí está bien que
esté, pero como color y no como prueba.

## Dos preguntas

1. **¿Cuánto quieren que viva el código?** Cinco minutos nos parece bien: es el
   tiempo de caminar del escritorio al teléfono, y no más.
2. **¿Hay tope de pedidos por persona?** Si alguien puede abrir cincuenta
   pedidos, la app le muestra cincuenta confirmaciones a la víctima y alguna va a
   apretar. Eso se defiende de su lado, no del nuestro.

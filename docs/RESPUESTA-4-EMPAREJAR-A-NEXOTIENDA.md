# Emparejar: nuestra mitad está, y una advertencia sobre el `device`

Los dos endpoints están construidos con la forma que propusieron, tal cual:

```
POST /v1/cuentas/emparejar                        (clave `cuentas`)
{ "storeId": "12", "dispositivo": "una computadora con Chrome" }
→ { "requestId": "…", "code": "VRCCX", "expiresAt": "…" }

GET /v1/cuentas/emparejar/:requestId?storeId=12   (clave `cuentas`)
→ { "status": "pendiente" } | { "status": "listo", "token": "…" } | { "status": "vencido" }
```

No guardan nada de este lado. No hubo migración, porque no hay estado nuestro
que llevar: son pase de pelota, como dijeron.

Probado el circuito entero contra un simulador con la forma que le pedimos a
ClubPay: pide el código, espera, aprueba, devuelve el token, **el token se canjea
en `POST /v1/cuentas/canjear` que ya existía**, y el pedido queda usado. Más los
caminos de error: sin clave 401, comercio sin ClubPay configurado 409.

**Falta la mitad de ClubPay.** El pedido ya está escrito y va para ellos. Cuando
exista, de nuestro lado es cambiar una URL.

De acuerdo con que termine en el canje viejo y no en una sesión nueva, por el
motivo que dan: una segunda forma de abrir sesión es una segunda superficie que
auditar por el resto de la vida del producto.

## El `device`: lo pasamos tal cual, pero no alcanza como defensa

Su razonamiento del ataque es correcto y es el que hay que resistir: no le roban
el código a nadie —el código aparece en la pantalla del que lo pidió— sino que el
atacante abre el pedido en su compu y convence a la víctima de escribir *ese*
código en su ClubPay.

Pero ahí está el problema con llamarlo "la única defensa del mecanismo": **en ese
ataque el que pide el código es el atacante, así que el `device` lo escribe él.**
Nada le impide mandar "tu iPhone" y que la confirmación de la víctima diga
exactamente lo que ella espera ver.

Lo pasamos tal cual y sin agregarle nada, como pidieron, y queda escrito en el
código que no es una prueba.

Lo que sí es confiable en esa pantalla es **el nombre del comercio**, porque
ClubPay lo deduce de la clave y no de lo que le mandamos. Les propusimos a ellos
que la confirmación se apoye ahí y en la pregunta:

> Alguien está pidiendo abrir tu libreta de **Jure Hnos** en otra pantalla.
> Si no fuiste vos, no confirmes.
> *Dice ser: una computadora con Chrome.*

El "si no fuiste vos" no depende de ningún dato que el atacante controle. El
dispositivo sigue sirviendo en el caso honesto —"sí, es mi compu"— y ahí está
bien que esté. Como color, no como prueba.

## Lo de la cookie httpOnly con el `requestId`

Buena. Es la pieza que hace que aprobar un pedido ajeno no le sirva a nadie: el
token vuelve, pero sólo el navegador que abrió el pedido puede canjearlo.

De nuestro lado no hace falta nada para eso y es como tiene que ser: el
`requestId` nos llega, contestamos, y quién puede usar la respuesta lo decide su
cookie. Si lo hubiéramos resuelto nosotros, habríamos tenido que inventar una
identidad de navegador que no tenemos por qué conocer.

## Dos cosas que les preguntamos a ClubPay y les pueden importar

- **Cuánto vive el código.** Propusimos cinco minutos: el tiempo de caminar del
  escritorio al teléfono, y no más.
- **Si hay tope de pedidos por persona.** Si alguien puede abrir cincuenta, la
  app le muestra cincuenta confirmaciones a la víctima y alguna va a apretar.
  Eso se defiende del lado de ellos.

# Emparejar: corrimos el diagnóstico, y las dos causas eran nuestras

Gracias por armarlo con una prueba en vez de con opiniones. Las dos cosas que
faltaban eran de este lado, y ninguna de las dos era la que decía la tabla.

---

## 1. Las rutas existen y están desplegadas

Se puede comprobar sin la clave, que es más rápido que el `curl` que propusieron:
una ruta que existe contesta **401** porque el guardia de la clave corre, y una
que no existe contesta **404** antes de llegar a él.

Contra producción, recién:

```
POST /v1/cuentas/emparejar      → 401     ← existe
GET  /v1/cuentas/emparejar/x    → 401     ← existe
POST /v1/cuentas/canjear        → 401     ← existe, y ya sabíamos que anda
POST /v1/cuentas/inventado      → 404     ← ésta de verdad no existe
```

Así que no era eso. Pero su `curl` iba a dar **404 igual**, y por el motivo de
abajo, que es el que importa.

## 2. El 404 que acusaba al equipo equivocado

**Ésta es nuestra, y es la que les hizo perder el tiempo.**

Cuando ClubPay nos contestaba 404, nosotros reenviábamos ese 404 tal cual. Y su
tabla lee un 404 como *"la ruta no existe. Es de ustedes."* — y está bien que lo
lea así.

Dos causas opuestas, el mismo número, y los tres mirando para el costado.

Ya no. Un fallo del salto de atrás sale como **502** y el mensaje dice de quién
es:

```json
{ "error": "ClubPay no reconoce el pedido de emparejamiento. La ruta de NexoPOS
            existe; lo que falta está del otro lado." }
```

Vale para las tres llamadas de la libreta, el canje incluido. El pedido de quien
nos llamó estaba bien; lo que falló fue lo de atrás, y eso es un 502.

Su tabla queda mejor así: **502 ya no es ambiguo**, dice explícitamente de qué
lado está el problema.

## 3. La ruta de ClubPay: le erramos al nombre

Llamábamos a `/pos/tienda/pairings`. **Ese nombre lo inventamos nosotros**,
porque no teníamos la especificación de ClubPay escrita y les pusimos nombre en
inglés a los endpoints que les pedimos.

La que existe es `/pos/tienda/emparejar` — la que ustedes hablaron con ellos y
pusieron en su diagrama. Corregido.

Así que ClubPay tenía razón cuando decía que su punta estaba construida, y
nosotros llamábamos a una puerta que no existe.

## 4. No, no quedó apuntando a un simulador

Buena pregunta y era la correcta para hacer. La respuesta es que no: el
simulador sólo vive cuando `CLUBPAY_API_URL` está vacío, que es el modo demo. En
producción está configurado y las llamadas salen de verdad — por eso ClubPay
contestaba 404 en vez de que no llegara nada.

## 5. `clientHint`

Lo tomamos. Aceptamos `clientHint` y `dispositivo`, y hacia ClubPay mandamos
`device` y `client_hint`.

Renombrar un campo opcional es de las cosas que no rompen nada visible —el
endpoint sigue contestando 200— pero deja de viajar justo el dato que sostiene la
pantalla de confirmación. Preferimos aceptar los dos nombres a que eso pase en
silencio.

## 6. Y leemos la respuesta de ClubPay con tolerancia de nombres

`request_id` o `requestId`, `expira_at` o `expiresAt`. Son cinco líneas y evitan
gastar otro ida y vuelta de tres equipos en un guión bajo.

Probado contra un ClubPay de mentira en los dos modos: contestando 404 devuelve
502 con el mensaje que señala bien, y contestando con los nombres "del otro
lado" el pedido se lee igual.

---

## Lo que sigue

De nuestro lado no queda nada. **Prueben de nuevo cuando German despliegue** —es
un commit— y si vuelve a fallar, ahora el error les va a decir de quién es.

Si ClubPay contesta algo que no sea 404 —un 401, o una forma que no entendemos—
el mensaje también lo va a decir, con el status adentro. Mándennoslo tal cual y
lo llevamos nosotros.

Y una cosa suya que nos copiamos sin decirlo: lo del log que faltaba. Nuestro
404 tampoco dejaba rastro útil; ahora cada salto fallido queda escrito con la
ruta, el status y el cuerpo.

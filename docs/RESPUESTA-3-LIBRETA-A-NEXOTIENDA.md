# `closingDay` está; los resúmenes, esperando

## `closingDay`, y dos campos más que no pidieron

```json
{
  "closingDay": 10,
  "dueDay": 20,
  "currentPeriod": { "from": "2026-09-11", "to": "2026-10-10", "dueDate": "2026-10-20" }
}
```

**`dueDay` va porque "cierra el 10" sin "vence el 20" es media frase**, y el día
que quieran escribir la otra mitad tendrían que pedir otro viaje.

**`currentPeriod` va porque calcularlo tiene una trampa** que preferimos que no
tengan que descubrir: un cierre el 31 en febrero es el 28, y el 29 en los
bisiestos. Probado con las dos configuraciones:

```
cierre 10 →  del 2026-09-11 al 2026-10-10,  vence 2026-10-20
cierre 31 →  del 2026-09-01 al 2026-09-30   ← septiembre no tiene 31
```

Si la pantalla dice "cierra el 10 de cada mes", `closingDay` alcanza. Si alguna
vez dice "cierra el 10 de octubre", usen `currentPeriod.to` y esa cuenta la
hacemos nosotros, en un solo lugar.

Y bien no inventar un "cierra el 1" cuando el dato no está. Ese es el tipo de
número que hace que el comerciante deje de creerle a todo lo demás.

## Los resúmenes: nuestra recomendación es que no vayan, y hay un motivo nuevo

No construimos nada, como pidieron. Pero al mirarlo con la decisión de German
sobre la mesa apareció algo que cambia la pregunta:

**La audiencia de las dos pantallas es exactamente la misma, por construcción.**

La libreta online requiere ClubPay sí o sí —está decidido y ya lo
implementaron—. Entonces *toda* persona que pueda abrir su libreta en la tienda
tiene ClubPay, y ClubPay ya le muestra la pila de resúmenes, en la vista
agregada del deudor, que es donde corresponde.

O sea que no es un intercambio entre "mostrar más" y "mostrar menos". Es
mostrarle lo mismo dos veces a la misma gente, con dos implementaciones que
pueden desincronizarse, para que una sesión robada en la tienda sirva además
para pasearse por la historia financiera de alguien.

Nos parece que la tienda tiene que decir **"podés cargar a la libreta y tenés
tanto disponible"** y nada más, y que el historial se quede en ClubPay. Con el
estado que ya consumen alcanza para eso: saldo, disponible, pausa, cuándo
cierra.

Queda en German igual. Si dice que van, los construimos: la pila de períodos ya
existe de este lado —el abierto arriba, los cerrados abajo, sin sumarse nunca
entre sí— y es exponerla, no calcularla.

## Lo de comparar el valor y no la fecha

Nos lo copiamos como criterio. Guardar el `linkedAt` que había al abrir y
compararlo contra el actual saca los relojes del medio: no importa cuánto se
corrió, importa que se corrió. Es más robusto que lo que teníamos pensado
nosotros, que era comparar contra la hora de apertura de la sesión.

## Estado

De nuestro lado no queda nada bloqueado tampoco.

- El pedido del QR ya está escrito y va para ClubPay.
- `closingDay` está.
- Los resúmenes, esperando a German, con nuestra recomendación arriba.

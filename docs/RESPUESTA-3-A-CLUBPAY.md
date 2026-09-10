# Un agujero en la regla 1.b, y la mitad es de ustedes

Confirmamos la regla del punto 1.b y la implementamos. Pero yendo a leer cómo
quedó de su lado encontramos que **entre las dos puntas la misma plata se cuenta
dos veces**, y no lo arregla ninguno solo.

Es exactamente el caso que ustedes marcaron como "puede costar plata". Tenían
razón en marcarlo; lo que no vimos ninguno de los dos es que la regla, sola, no
alcanza.

---

## Lo que encontramos

Su cálculo es este, y está bien:

```sql
SUM(amount_cents) FILTER (WHERE statement_id = '') AS saldo_cents
```

Vacío suma, con id no suma. Y los resúmenes se listan aparte con su
`pendiente_cents`. Impecable.

**El problema es cuándo se escribe ese `statement_id`.**

Un movimiento nace en el período abierto. En ese momento no pertenece a ningún
resumen, así que va con `statement_id` vacío y suma. Correcto.

Después ese período cierra. Nosotros les mandamos el resumen con su
`total_cents`, que pasa a sumar como pendiente. Pero **el movimiento sigue con
el id vacío**, porque nada lo actualiza:

- `registrarResumen` solo escribe en `merchant_statements`. No toca los
  movimientos.
- `registrarMovimiento` es `ON CONFLICT DO NOTHING`, así que aunque
  reenviáramos el movimiento con el id puesto, **no se actualizaría**.

Resultado: la compra de agosto queda contada en `saldo_cents` *y* en el
`pendiente_cents` del resumen de agosto. Al cliente le aparece el doble.

## Y nosotros teníamos el error espejo

Cuando implementamos esto, mandábamos `statement_id` en **todos** los
movimientos, incluidos los del período abierto —no habíamos leído todavía que el
vacío es lo que suma—. Con eso, `saldo_cents` daba **cero**: la persona veía "Al
día" debiendo.

**Ya está corregido de nuestro lado y desplegado.** La regla que aplicamos ahora:

> El `statement_id` viaja **solo si el período ya está cerrado** en el momento
> de mandar el movimiento. El del período abierto va sin id, para que sume.

Eso además resuelve bien el caso que ustedes plantearon: un movimiento que llega
tarde, cuando su período ya cerró, sí lleva el id y entra como detalle sin mover
el total. El resumen ya es un documento.

---

## Lo que falta, y es de ustedes

Falta que, **cuando llega un resumen, se le adjudiquen los movimientos que
todavía están en vacío y caen en su rango**. El resumen trae `period_start` y
`period_end` justamente, así que tienen todo:

```sql
UPDATE merchant_account_movements
   SET statement_id = $statement_id
 WHERE merchant_customer_id = $mc
   AND statement_id = ''
   AND occurred_at::date BETWEEN $period_start AND $period_end;
```

Adentro de `registrarResumen`, en la misma transacción que el `INSERT`.

Tres cosas que lo hacen seguro:

- **Es idempotente.** Los reenvíos de `paid_cents` —que van a ser muchos— la
  vuelven a correr y no hacen nada, porque ya no queda ninguno en vacío.
- **No pisa nada.** Solo toca los que están en vacío; un movimiento que ya tiene
  su resumen no se mueve.
- **No hace falta que cambien el `ON CONFLICT DO NOTHING`.** Nos gusta como está:
  un movimiento es un hecho y no debería poder reescribirse desde afuera. La
  adjudicación la hace el resumen, que es de ustedes.

Por qué de ese lado y no del nuestro: reenviar todos los movimientos de un
período al cerrarlo sería mandar cientos de llamadas para corregir un campo, y
ustedes lo resuelven con un `UPDATE` en el momento en que ya tienen el dato.

---

## El orden en que conviene desplegarlo

Importa, porque en el medio los números se ven mal:

1. **Ustedes primero**, la adjudicación. Sola no rompe nada: hoy no hay ningún
   resumen en producción, así que no tiene a qué aplicarse.
2. **Después nosotros empezamos a mandar resúmenes.** Hasta que el paso 1 esté,
   los tenemos en la cola sin enviar —preferimos que no lleguen a que lleguen y
   dupliquen—.

Avísennos cuando esté y los soltamos. Mientras tanto **el saldo y los
movimientos siguen andando como ahora**, que es lo que su punto 1.d ya
anticipaba.

---

## Una pregunta que queda

¿Qué pasa con un movimiento en vacío que **no** cae en el rango de ningún
resumen? Puede pasar si el comercio cambia su día de cierre: un movimiento del
2 de septiembre con el cierre movido del 31 al 10 queda en tierra de nadie
durante un ciclo.

Nuestra lectura es que **está bien que siga sumando** —es plata que se debe y
todavía no entró en ningún documento—, y que se va a adjudicar sola cuando cierre
el período que sí lo contenga. Pero si de su lado eso deja un movimiento colgado
para siempre, díganlo y lo miramos: acá el día de cierre es configurable y el
comerciante lo va a mover.

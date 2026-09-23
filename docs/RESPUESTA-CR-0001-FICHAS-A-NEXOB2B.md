# CR-0001 · Resincronización de fichas: terminó bien

Respuesta de NexoPOS al aviso del 23 de septiembre de 2026.

## Lo que pidieron

1. Reiniciar el cursor a antes de `2026-07-06T17:50:05`.
2. Correr la sincronización completa contra `/api/v1/fichas` hasta agotar la
   paginación.
3. Avisar cuántas fichas trajo y si `hay_mas` terminó en `false` sin repetir
   páginas.

## Lo que hicimos

- **Cursor:** estaba en `2026-07-06 17:50:05.633+00`, a mitad del bloque
  empatado. Cada corrida horaria leía 200 páginas de 500 —el tope de vueltas—
  y eran siempre las mismas fichas. Lo reiniciamos a `2026-07-06T00:00:00Z`,
  sin `desde_id`.
- **Corrida:** 23 de septiembre, de ~23:18 a 23:30:23 UTC, con `limite=500`.

## Resultado

| | |
|---|---|
| Fichas recibidas | **72.051** |
| Fichas distintas | **72.051** — ninguna página repetida |
| Páginas | **145** de 500 (el equivalente a sus 37 de 2000) |
| `hay_mas` al final | **`false`** |
| Líneas de stock actualizadas en NexoPOS | 10.489 |
| Errores | ninguno |

El total coincide exactamente con las 72.051 que midieron ustedes.

## Lo que cambiamos de nuestro lado

El contrato no cambió y no hizo falta adaptar nada. Sí agregamos tres
defensas, para que un estancamiento así no vuelva a pasar dos meses sin que se
note:

- Si una página trae sólo fichas ya leídas en la misma corrida, la corrida se
  corta y el error queda registrado. Antes se repetía en silencio.
- El cursor guardado se reenvía con la precisión completa (microsegundos), sin
  recortarlo a milisegundos.
- Una sola corrida a la vez, para que una resincronización larga no se pise
  con la horaria.

Desde ahora el sync vuelve a correr cada hora desde el cursor nuevo.

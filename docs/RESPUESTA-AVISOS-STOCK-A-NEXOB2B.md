# Respuesta a NexoB2B: los «0 aplicadas» de Delfín

**De:** NexoPOS · **Para:** NexoB2B · **Fecha:** 29/10/2026
**Sobre:** `RESPUESTA-7-A-NEXOPOS-AVISOS-STOCK.md`

Gracias. Que los avisos ya salgan y lleguen es la mitad que faltaba.

## 1. Por qué daban 0: los avisos sí se aplicaron

**Actualizado 30/10, después de mirar nuestra base.** El interruptor de Delfín
está prendido, y los avisos de ustedes **llegaron y se aplicaron**:

| Origen | Cuándo (hora de Córdoba) | Movimientos |
|---|---|---|
| `NexoB2B (csv)` | 29/10, de 18:58 a 22:01 | 7.441 |
| `NexoB2B (despacho)` | 29/10, 20:03 | 1 |

El aviso de 6.168 **sí entró completo**. Lo procesamos ítem por ítem dentro de
una transacción, y eso tardó más que los 8 segundos de su `fetch`. Ustedes
cortaron antes de recibir la respuesta, pero de este lado quedó todo
guardado. Las tandas que mandaron después traían los mismos números que ya
teníamos. La versión anterior no contaba lo que no cambiaba, así que contestó
`aplicados: 0`. Con la respuesta nueva eso aparece en `sin_cambio`.

Lo que queda para ustedes: si un aviso se corta por tiempo, **no lo den por
perdido**. Puede haber entrado. Reenviarlo es seguro, porque `stock` es un
total y no una diferencia, así que repetirlo no cambia nada. Con tandas de 300
no debería volver a pasar.

## 2. La respuesta ahora explica cada número

Desde este deploy, cada aviso contesta así (también con el interruptor apagado):

```json
{
  "ok": true,
  "recibidos": 300,
  "aplicados": 12,
  "sin_cambio": 280,
  "no_encontrados": 7,
  "invalidos": 1,
  "no_encontrados_muestra": ["pp_…", "pp_…"]
}
```

- Los cuatro contadores suman `recibidos`.
- `sin_cambio`: teníamos ese mismo número. No hay movimiento y **no es un
  error**. En un `resync` lo normal es que sea la mayoría.
- `no_encontrados`: el comercio no tiene ese producto como propio en el POS.
  Casi siempre es porque no lo importó. Cruzamos por `presentacion_id` o
  `pmp_id`, así que manden los dos, como ya hacen.
- `invalidos`: sin id o con `stock` no numérico.
- `no_encontrados_muestra`: hasta diez ids, para que puedan buscarlos sin
  pedirnos el log.
- Cuando no se aplica nada por decisión nuestra, viene `motivo`, un **código
  fijo** para registrar tal cual. Hoy hay uno solo: `"interruptor_apagado"`
  (en ese caso los contadores vienen en 0 y `recibidos` con lo que llegó).
  Si agregamos otro, se lo avisamos antes.

Además dejamos una línea en nuestro log por cada aviso, con los mismos números.
Así se cruzan los dos logs sin adivinar.

## 3. Tamaño

Las tandas de 300 nos vienen bien. El aviso de 6.168 entraba en nuestros
límites (4 MB en la app, 10 MB en nginx): fue sólo el tiempo, como dice el
punto 1.

## 4. La marca de «usa NexoPOS»

La marca por llamadas a `/api/v1/pos/*` tiene un hueco que vale para cualquier
comercio: **el mostrador casi nunca pasa por ahí**. El login va por otro lado.
Con el token del comercio sólo llamamos a dos cosas:

- `GET /api/v1/pos/productos`, cuando el comercio importa su catálogo propio.
- `PUT /api/v1/pos/stock`, la cola de salida, que sólo sale **con el interruptor
  prendido y después de una venta de un producto propio**.

Un comercio que prende el interruptor y todavía no vendió un producto propio
nunca quedaba marcado, y nunca recibía avisos.

**Lo cerramos nosotros:** al prender el interruptor, el POS hace un
`GET /api/v1/pos/productos?page=1&pageSize=1` con el token del comercio. Eso
los marca en el momento, y además prueba que el token sirve. Si B2B no lo
reconoce, el interruptor no se prende y el comerciante ve que tiene que volver
a entrar. No hace falta nada de su lado. Sólo que la marca **no se borre** si
un comercio pasa un tiempo sin llamar.

**Sobre Rivera Hogar:** no usa el mostrador de NexoPOS. Nunca hizo una venta y
su último login propio es del 16/09. No hay otra cuenta: por eso no ven
llamadas, y está bien que no le lleguen avisos. Retiramos lo que dijimos el
28/10 sobre las ventas de su mostrador.

## 5. Un arreglo en la otra mitad (POS → B2B)

Mirando los datos de Delfín encontramos un error nuestro. Los ids de
presentación son UUID sin prefijo, y la cola de salida reconocía la
presentación por `pp_`. Con un UUID, la venta del mostrador hubiera viajado
por EAN, o, sin EAN, con un id inválido. No llegó a pasar: Delfín todavía no
vendió productos propios por el mostrador. Desde este deploy, todo id que no
empieza con `pmp_` viaja como `presentacion_id`, el mismo valor que ustedes nos
mandan en los avisos.

**Para confirmar de su lado:** que `PUT /api/v1/pos/stock` acepte como
`presentacion_id` ese UUID, el mismo que viene en sus avisos.

## 6. Cómo seguimos

1. Deployamos esto.
2. Mandan el `resync` completo de Delfín cuando quieran: el interruptor ya
   está prendido. Esperamos casi todo en `sin_cambio`.
3. Cambian el stock de un producto desde el portal y miramos juntos: ustedes
   la línea del log, nosotros el movimiento `NexoB2B (portal)`.
4. Delfín vende un producto propio en el mostrador y ustedes confirman que bajó
   en B2B. Es la primera vez que esta mitad sale con un UUID.

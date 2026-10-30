# Respuesta a NexoB2B: los «0 aplicadas» de Delfín

**De:** NexoPOS · **Para:** NexoB2B · **Fecha:** 29/10/2026
**Sobre:** `RESPUESTA-7-A-NEXOPOS-AVISOS-STOCK.md`

Gracias. Que los avisos ya salgan y lleguen es la mitad que faltaba.

## 1. Por qué daban 0: el interruptor de Delfín está apagado

Lo deducimos de lo que describen. Con el interruptor apagado, la versión
anterior contestaba `{ ok: true, aplicados: 0, motivo: "sincronización apagada" }`,
**sin** `no_encontrados`. Con el interruptor prendido, `no_encontrados` venía
siempre, aunque fuera 0. Si no lo ven, es que contestó la rama del interruptor
apagado. Lo confirmamos en la base y les avisamos.

No es un error: el interruptor arranca apagado, y lo prende el comercio cuando
su ERP deja de reescribir el total en B2B. Si lo prendiéramos antes, el ERP le
devolvería las unidades que el mostrador acaba de descontar.

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

Las tandas de 300 nos vienen bien. Igual, para que quede claro: el aviso de
6.168 entraba en nuestros límites (4 MB en la app, 10 MB en nginx), así que
si no llegó, no fue un rechazo de este lado por tamaño. Si tienen el error de
ese envío, nos interesa saber si fue un timeout de su `fetch`.

## 4. La marca de «usa NexoPOS» y Rivera Hogar

La marca por llamadas a `/api/v1/pos/*` tiene un hueco: **el mostrador casi
nunca pasa por ahí**. El login va por otro lado. Con el token del comercio sólo
llamamos a dos cosas:

- `GET /api/v1/pos/productos`, cuando el comercio importa su catálogo propio.
- `PUT /api/v1/pos/stock`, la cola de salida, que sólo sale **con el interruptor
  prendido y después de una venta de un producto propio**.

Un comercio que prende el interruptor y todavía no vendió un producto propio
nunca quedaba marcado, y nunca recibía avisos.

**Rivera Hogar, revisado en nuestra base (30/10):** no usa el mostrador de
NexoPOS. Nunca hizo una venta, su último login es del 16/09 (el del 29/10 fue
una entrada de soporte) y la cola de salida nunca tuvo un aviso suyo. No hay
otra cuenta: si algo baja stock en B2B por Rivera, no es NexoPOS. Por eso no
registran llamadas desde el 20/10, y está bien que no le lleguen avisos.
Retiramos lo que dijimos el 28/10 sobre «cada venta del mostrador baja el stock
en B2B»: el interruptor estaba prendido, pero no hubo ventas que avisar.

**Lo cerramos nosotros:** al prender el interruptor, el POS hace un
`GET /api/v1/pos/productos?page=1&pageSize=1` con el token del comercio. Eso
los marca en el momento, y además prueba que el token sirve. Si B2B no lo
reconoce, el interruptor no se prende y el comerciante ve que tiene que volver
a entrar. No hace falta nada de su lado. Sólo que la marca **no se borre** si
un comercio pasa un tiempo sin llamar.

## 5. Cómo seguimos

Su plan está bien, con un cambio de orden:

1. Deployamos esto (hoy).
2. Les avisamos cuando el interruptor de Delfín esté prendido. Lo decide el
   comercio, por lo del ERP del punto 1.
3. Mandan el `resync` completo de Delfín. Esperamos ver casi todo en
   `sin_cambio` o `aplicados`. Si `no_encontrados` es grande, la
   `no_encontrados_muestra` nos dice cuáles mirar.
4. Cambian el stock de un producto desde el portal y miramos juntos: ustedes
   la línea del log, nosotros el movimiento `NexoB2B (portal)` y la tarjeta,
   que pasa a «Último aviso de NexoB2B: …».

Mientras tanto, mandar avisos a un comercio con el interruptor apagado no
molesta: contestamos `interruptor_apagado` sin tocar nada.

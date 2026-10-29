# Cómo dejar el stock en un solo número

Para el negocio que vende por mayor y por mostrador. Es el mismo depósito, así
que lo que buscamos es que las dos pantallas digan siempre lo mismo.

---

## Primero: en cuál de todas las ventanas estás

Tu negocio está dado de alta en varios lugares, y algunos son dos veces. Esto
es lo que es cada uno:

| Dónde | Con qué cuenta | Para qué |
|---|---|---|
| **NexoB2B** · nexob2b.app | como **mayorista** | le vendés a los almacenes |
| **NexoB2B** · nexob2b.app | como **comercio** | le comprás a otros mayoristas |
| **NexoPOS** · nexopos.app | como comercio | tu caja, tu mostrador, tu stock |
| **NexoTienda** · tutienda.nexotienda.app | como comercio | tu tienda online |
| **ClubPay** | como comercio | los descuentos a socios |

**Para esto que vamos a hacer sólo entran dos:** NexoPOS, y NexoB2B con tu
cuenta de **comercio** (no la de mayorista).

NexoTienda y ClubPay no tienen nada que ver acá. No hay que tocar nada ahí.

---

## Paso 1 — En NexoPOS

Entrá a **nexopos.app** con tu cuenta de comercio.

En el menú de la izquierda: **Productos** → botón **"Importar mi catálogo"**
(está arriba, a la derecha del buscador).

Trae tus productos con el costo que tenés cargado en NexoB2B y con las unidades
que tenés contadas allá.

Se puede apretar las veces que haga falta: no pisa el stock que hayas contado
ni los precios de venta que hayas puesto. Sólo refresca los costos.

> **Aunque ya lo hayas importado antes, apretalo una vez más.** Hace falta para
> que aparezca la pantalla del paso 2.

---

## Paso 2 — En NexoPOS, la misma ventana

En el menú de la izquierda, abajo de todo: **Configuración**.

Bajá hasta la tarjeta que dice **"Stock compartido con NexoB2B"** y prendé el
interruptor **"Mantener los dos en el mismo número"**.

Desde ese momento:

- lo que vendés por el mostrador baja también en NexoB2B
- lo que despachás por mayor baja también en NexoPOS

Si esa tarjeta no está en Configuración, es que faltó el paso 1.

---

## Cómo saber que quedó bien

No hay nada que copiar ni pegar en NexoB2B: los dos sistemas se hablan solos.

En NexoPOS → Configuración → la tarjeta "Stock compartido con NexoB2B":

- **"Último aviso de NexoB2B: …"** → lo que despachás por mayor está llegando.
- **"Todavía no llegó ningún aviso de NexoB2B"** → si ya despachaste algo de
  tu catálogo propio y sigue así, avisanos.

La prueba de verdad es más simple: vendé una unidad por el mostrador de
NexoPOS y fijate que en NexoB2B haya bajado.

---

## Dos cosas que van a pasar, para que no te asusten

**El stock va a subir a veces sin que nadie cargue mercadería.**

Entre que vendés y que emitís la factura, tu sistema de facturación todavía no
sabe de esa venta. Si justo sincroniza en el medio, esas unidades reaparecen
por un rato. Se acomoda solo en la sincronización siguiente a la factura. No se
acumula y no hay que tocar nada.

En NexoPOS, en el historial de cada producto, esos movimientos figuran como
**NexoB2B**, así que siempre podés ver de dónde salió un número.

**Los productos importados entran sin precio de venta.**

El número que viene de NexoB2B es el **costo**, no el precio del mostrador. No
lo usamos como precio de venta a propósito: si lo hiciéramos, estarías
vendiendo a costo miles de productos sin darte cuenta hasta cerrar la caja.

Para ponerles precio sin cargarlos de a uno, en NexoPOS hay una pantalla
**Márgenes** (en el menú, justo abajo de Productos). Ponés cuánto querés ganar
sobre el costo —en general, o distinto por pasillo, por rubro, por subrubro o
por producto— y los precios se calculan solos. Antes de aplicar nada te muestra
cómo quedarían.

---

## Si algo no anda

**No encuentro la tarjeta "Stock compartido" en Configuración.**
Faltó el paso 1. Volvé a Productos y apretá "Importar mi catálogo".

**Despaché por mayor y no baja en NexoPOS.**
Fijate la tarjeta: si dice "Todavía no llegó ningún aviso", el problema no es
tuyo. Avisanos y lo vemos con NexoB2B.

**Vendo en el mostrador y no baja en NexoB2B.**
El aviso se reintenta solo durante varias horas. Si al día siguiente sigue
igual, avisanos.

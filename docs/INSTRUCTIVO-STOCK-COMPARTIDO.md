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

## Paso 3 — En NexoB2B, con tu cuenta de COMERCIO

Este paso puede no hacer falta. Mirá la tarjeta del paso 2: si **no** aparece
un recuadro que dice *"Falta un paso, en NexoB2B"*, ya está todo conectado y
podés saltear este paso.

Si aparece, vas a ver dos cajitas con un botón **Copiar** al lado: una
**Dirección** y un **Secreto**.

1. Copiá la Dirección.
2. Entrá a **nexob2b.app** con tu cuenta de **comercio** — la que usás para
   comprar, no la de mayorista.
3. Buscá la clave de API de tu comercio y pegala en el campo de la dirección.
4. Volvé a NexoPOS, copiá el Secreto, y pegalo en el campo del secreto.

Los dos son secretos: quien los tenga puede cambiarte el stock. No los mandes
por un grupo de WhatsApp ni los dejes anotados en el mostrador.

---

## Cómo saber que quedó bien

Volvé a NexoPOS → Configuración → la tarjeta "Stock compartido con NexoB2B":

- **"Esperando el primer aviso firmado"** → todavía falta el paso 3.
- **"Los avisos llegan firmados con el secreto"** → listo, anda en los dos
  sentidos.

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

**Dice "Esperando el primer aviso firmado" y ya cargué todo en NexoB2B.**
Revisá que la dirección y el secreto estén pegados enteros, sin espacios al
principio ni al final. Y que los hayas cargado en tu cuenta de **comercio** de
NexoB2B, no en la de mayorista.

**Vendo en el mostrador y no baja en NexoB2B.**
El aviso se reintenta solo durante varias horas. Si al día siguiente sigue
igual, avisanos.

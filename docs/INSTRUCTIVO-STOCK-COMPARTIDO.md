# Cómo dejar el stock en un solo número

Para el negocio que vende por mayor en NexoB2B y por mostrador en NexoPOS. Es
el mismo depósito, así que el objetivo es que las dos pantallas digan siempre
lo mismo.

Son tres pasos y se hacen una sola vez.

---

## 1. Traer tu catálogo al POS

**Productos** → botón **"Importar mi catálogo"**.

Trae tus productos con el costo que tenés cargado en NexoB2B y con las unidades
que tenés contadas allá.

Se puede apretar las veces que haga falta. No pisa el stock que hayas contado
ni los precios de venta que hayas puesto: sólo refresca los costos.

> **Importante:** si ya lo importaste antes, apretalo igual una vez más. Hace
> falta para que el paso 2 aparezca.

---

## 2. Prender el stock compartido

**Configuración** → tarjeta **"Stock compartido con NexoB2B"** → prendé
**"Mantener los dos en el mismo número"**.

Desde ese momento:

- lo que vendés por el mostrador baja también en NexoB2B
- lo que despachás por mayor baja también en el POS

Si la tarjeta no aparece, es que falta el paso 1.

---

## 3. Si la pantalla te pide copiar dos valores

Puede aparecer un recuadro que dice **"Falta un paso, en NexoB2B"**, con una
**Dirección** y un **Secreto**, cada uno con su botón de copiar.

Si aparece: copiá los dos y pegalos en NexoB2B, en la clave de API de tu
comercio — la dirección en el campo de dirección, el secreto en el de secreto.

Si no aparece: no hay nada que hacer, ya está conectado.

Los dos valores son secretos. Quien los tenga puede cambiarte el stock, así que
no los mandes por un grupo ni los dejes anotados en un papel en el mostrador.

---

## Cómo saber que quedó bien

Volvé a la tarjeta de Configuración:

- **"Esperando el primer aviso firmado"** → todavía falta cargar los datos del
  paso 3 en NexoB2B.
- **"Los avisos llegan firmados con el secreto"** → listo, funciona en los dos
  sentidos.

La prueba de verdad es más simple: vendé una unidad por el mostrador y fijate
que en NexoB2B haya bajado.

---

## Dos cosas que van a pasar y conviene saber de antes

**El stock puede subir sin que nadie cargue mercadería.** Entre que vendés y
que emitís la factura, tu sistema de facturación todavía no sabe de esa venta.
Si justo sincroniza en el medio, esas unidades reaparecen por un rato. Se
acomoda solo en la sincronización siguiente a la factura. No se acumula y no
hay que tocar nada.

En el historial de cada producto esos movimientos figuran como **NexoB2B**, así
que siempre se puede ver de dónde salió un número.

**Los productos importados no tienen precio de venta.** El número que viene de
NexoB2B es el costo, no el precio del mostrador, y no lo usamos como precio
para que no termines vendiendo a costo sin darte cuenta.

Para ponerles precio sin cargarlos de a uno está la pantalla **Márgenes**:
ponés cuánto querés ganar sobre el costo —en general, o distinto por pasillo,
rubro, subrubro o producto— y los precios se calculan solos. Antes de aplicar
nada te muestra cómo quedarían.

---

## Si algo no anda

- **No aparece la tarjeta de Configuración:** falta el paso 1.
- **Dice "Esperando el primer aviso firmado" y ya cargaste todo:** revisá que
  la dirección y el secreto estén pegados enteros, sin espacios al principio ni
  al final.
- **Vendés y no baja en NexoB2B:** el aviso se reintenta solo durante varias
  horas. Si al día siguiente sigue igual, avisanos.

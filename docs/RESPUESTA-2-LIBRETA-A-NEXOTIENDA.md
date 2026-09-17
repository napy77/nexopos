# La libreta: construido, con dos cosas del contrato que cambian

Los cinco puntos de su lista están, menos el pedido del QR a ClubPay, que va
por separado y ya está escrito.

**Y tienen razón con el canje.** Preguntar en vez de que nos empujen el token es
mejor por los dos motivos que dan, y el segundo es el que decide: el estado
"emitido en ClubPay, no llegado a NexoPOS" es el que alguien tendría que
diagnosticar a las once de la noche porque un cliente no puede entrar. No
construimos el `handoff`.

---

## 1. El canje necesita `storeId` en el pedido, no sólo en la respuesta

Esta es la que los bloquea si no la ven ahora.

```
POST /v1/cuentas/canjear          (clave `cuentas`)
{ "token": "…", "storeId": "12" }      ← el storeId también acá

→ { "accountId": "CLI-4231", "storeId": "12",
    "displayName": "Germán Yovan", "linkedAt": "2026-09-17T…" }
```

**Por qué hace falta:** para preguntarle a ClubPay necesitamos la clave de *ese*
comercio, y el token no dice de cuál es — justamente por eso ClubPay puede
validarlo contra la clave. Ustedes siempre lo saben, porque el canje ocurre en
`jure.nexotienda.app`.

Y ahí se resuelve solo lo de su sección 2: **no hace falta que ClubPay agregue el
campo.** Si el token es de Jure y ustedes lo canjean diciendo "tienda de Delfín",
ClubPay lo valida contra la clave de Delfín y no coincide. Y si por algún motivo
pasara, lo cortamos nosotros: resolvemos la ficha y comprobamos a qué comercio
pertenece. Probado, contesta `403 Ese acceso no es de esta tienda`.

Igual pídanselo si quieren la comprobación triple; no molesta. Pero ya no los
bloquea.

## 2. `accountId` es `CLI-<id>`, no el `account_id` de ClubPay

Esto es lo que más fácil se asume al revés, y por eso va acá arriba.

El identificador de la libreta en toda nuestra frontera es **el nuestro**:
`CLI-4231`. No es el `account_id` que ClubPay devuelve en el canje, aunque el
canje pase por ahí.

El motivo no es preferencia: **`POST /v1/orders` ya acepta `accountId` con esa
forma** desde que existe. Si el canje devolviera el de ClubPay, la sesión abriría
bien y después el primer pedido a la libreta fallaría, que es el peor lugar para
enterarse.

## 3. El estado, que no existía

Su sección 6 lo da por hecho —"todo lo demás se pregunta en cada operación"— y
tenían razón en el diseño, pero **no había a qué llamarle**. Ahora sí:

```
GET /v1/cuentas/CLI-4231?storeId=12      (clave `cuentas`)

{ "accountId": "CLI-4231", "storeId": "12", "displayName": "Germán Yovan",
  "balanceCents": 2751920,
  "limitCents": null, "availableCents": null,
  "paused": false, "onlineEnabled": true,
  "linkedAt": "2026-09-17T…" }
```

Con eso la sesión deja de tener autoridad de verdad. Probado: el comerciante
pausa el fiado y la consulta siguiente devuelve `paused: true`, sin que nadie
revoque nada.

**`availableCents: null` es el caso más común**, no un borde: sin límite es el
default, porque así funciona el cuaderno. Mostrar 0 sería exactamente al revés
de la verdad.

**`onlineEnabled` es otra cosa que `paused`** y conviene contarlas distinto: el
comerciante puede tener el fiado online apagado aunque esa libreta esté al día.
"No podés cargar" y "este comercio no vende fiado por internet" no son el mismo
mensaje.

## 4. `linkedAt`: la marca que pidieron

Va en las dos respuestas. Se mueve cuando el vínculo cambia de estado o de
cuenta, y **no se mueve en una consulta de rutina**: si se moviera con cada
chequeo, cerrarían la sesión de todo el mundo cada pocos minutos.

Coincidimos en que no es redundante. Es la única revocación que existe acá.

## 5. Duplicados: construido, y el detector encuentra el par de su captura

Por teléfono primero, documento de refuerzo, como salió de probar sus datos.

```
Mismo teléfono: 3515630140
  Germán Yovan   doc 2698535    tel 0351155630140    $850,00
  Germán Yovan   doc 26098535   tel 3515630140       $27.519,20   ve esta en ClubPay
```

La marca de cuál tiene ClubPay está a propósito: es el dato que decide cuál
conservar, y es el único que el comerciante no puede deducir mirando.

También avisa **en el alta**, antes de que nazca otro: si escribe un teléfono que
ya está, le dice a quién pertenece y le deja abrir esa ficha.

No fusiona nada, y no es una etapa pendiente.

### Si un canje resuelve a más de una ficha

**No puede pasar, y conviene que no construyan la rama.**

El `external_id` que viaja a ClubPay es `CLI-<id>`, el id de la fila. Dos fichas
duplicadas son dos filas con dos ids distintos, y sólo una está vinculada. El
canje resuelve siempre a exactamente una.

Lo que sí puede pasar es peor y no lo cubre ningún error: que esté vinculada la
ficha equivocada —la de $850— y la persona vea esa. Eso no se arregla con un
código de error; se arregla con el QR del mostrador y con el detector.

Así que no vamos a devolver `vinculo_ambiguo`. Si lo dejan implementado no
molesta, pero es una rama que nunca se va a ejecutar, y esas envejecen mal.

## 6. El QR

Escrito y va para ClubPay. Les tomamos el argumento tal como quedó: no ata un
DNI a una persona, ata una ficha a una persona.

Agregamos una pregunta que puede cambiar el plazo: si hoy la cámara de la app
sólo sirve para cobrar, esto es más trabajo del lado de ellos del que parece.

## 7. Dos cosas suyas que nos vamos a copiar

**El `Referrer-Policy: no-referrer` en `/entrar`.** No se nos había ocurrido y es
exactamente el tipo de cosa que no se descubre probando: la tienda carga fotos
de servidores ajenos y el navegador les cuenta el token en el `Referer`.

**El `/salir` por POST.** Un link que el prefetch del framework activa al pasar
el mouse es un bug que sólo aparece en producción, con un usuario real, una vez.

## Lo que queda

- El pedido del QR, para ClubPay.
- Que nos digan si quieren igual el campo de comercio desde ClubPay, ahora que
  no los bloquea.

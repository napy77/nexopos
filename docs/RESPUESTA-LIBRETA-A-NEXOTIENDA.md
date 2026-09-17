# La libreta: las cinco preguntas a NexoPOS

El documento está muy bien y la sección 1 es la que ordena todo: la pregunta no
es cómo se loguea alguien sino cómo se desbloquea **la libreta de este
comercio**. Nuestro modelo ya estaba construido así y no lo habíamos dicho con
esa claridad.

---

## 1. El canje del token es nuestro

Confirmado, y con la forma que proponen:

```
POST /v1/cuentas/canjear     (clave `cuentas`)
{ "token": "…" }
→ { "accountId": "acc_…", "storeId": "12", "displayName": "Germán" }
```

**Lo que falta definir con ClubPay es cómo verificamos un token que emitieron
ellos.** La forma que vamos a proponerles:

```
ClubPay al emitir:   POST /api/clubpay/handoff   (clave del comercio)
                     { account_id, token }
                     → lo guardamos hasheado, con 2 minutos de vida

NexoTienda al canjear: POST /v1/cuentas/canjear  (clave `cuentas`)
                     { token } → { accountId, storeId, displayName }
                     y el token muere en ese momento
```

Un solo uso, dos minutos, hasheado. Las tres puertas de su sección 4 terminan
en este mismo canje, que es lo que ustedes pidieron y es lo correcto.

### Sobre su pregunta 2 a ClubPay, el token acotado a un comercio

Eso ya está resuelto por el modelo y no hace falta que nadie lo prometa: **el
`account_id` ES la relación entre una persona y un comercio.** No existe un
account_id "de German"; existe "de German en Jure". Un token que lleva un
account_id no puede abrir otra tienda porque no hay nada adentro que nombre a
otra tienda.

Es la diferencia entre una protección que es una propiedad del modelo y una que
es una promesa del código —la misma distinción que hacen ustedes en 3.A—.

## 2. Duplicados: no hay deduplicación, y su captura tiene la clave

No hay índice único, no hay chequeo al dar el alta, y **el comerciante no ve de
ninguna forma que tiene dos fichas del mismo señor.** Fuimos a mirar y es así.

Pero probamos sus dos German Yovan y salió algo que cambia por dónde hay que
atacarlo:

```
documento   2698535  vs  26098535   →  no coinciden, y ninguno contiene al otro
teléfono    0351155630140  vs  3515630140   →  normalizados, son el MISMO número
```

El documento tiene un dígito comido en el medio, así que **ningún cruce por
documento los junta**: no son iguales, ni uno es prefijo del otro. El teléfono
sí, apenas se le saca el 0, el 15 y los separadores.

O sea que el detector tiene que ser **por teléfono primero**, y el documento
queda de refuerzo. Es exactamente al revés de lo que íbamos a construir.

Probado con los cuatro casos que importan:

```
0351155630140   3515630140          → mismo
351 15 5630140  +54 351 563-0140    → mismo
1145678901      011 15 4567-8901    → mismo
3515630140      3515630141          → distinto
```

Lo que vamos a hacer, si German dice que sí:

- **Avisar en el alta** cuando ese teléfono o ese documento ya están en otra
  ficha del comercio, y ofrecer usar la que existe. Corta el nacimiento de
  duplicados nuevos.
- **Una lista de posibles duplicados** en la pantalla de clientes, para que el
  comerciante los vea sin tener que sospechar.

Lo que **no** vamos a hacer solos es fusionarlos. Fusionar es sumar saldos y
mover movimientos, y si está mal, alguien queda debiendo lo que no debe. Eso lo
confirma el comerciante ficha por ficha.

**Y para el canje:** si un `account_id` resolviera a más de una ficha, no vamos
a elegir una. Preferimos contestarles ambigüedad a mostrarle a alguien la
libreta equivocada. Díganos qué quieren ver en ese caso.

## 3. El QR en el mostrador: sí, y su argumento es más fuerte de lo que dicen

Podemos mostrarlo. La maquinaria ya está —el cobro por QR del mostrador genera
uno— así que de nuestro lado es poco. **Lo que falta es que ClubPay acepte
iniciar una vinculación desde un QR escaneado**: hoy su endpoint recibe un DNI y
nada más. Escribimos el pedido y se lo mandamos.

Su sección 5 dice que la vinculación heredaría la verificación del mostrador.
Es cierto, y hay algo más que no mencionan y que es el remate de la sección 6:

**el QR no ata un DNI a una persona, ata una FICHA a una persona.**

El comerciante tiene abierta la ficha de $27.519,20 y muestra el QR de esa
ficha. La persona escanea y queda vinculada a ésa, no a "el DNI 26098535", que
es el dato que está mal escrito en el otro renglón. El problema de los dos
German deja de existir para todos los clientes nuevos, sin resolver ni un
duplicado viejo.

Eso convierte el QR de "una comodidad" en la única forma de vincular que no
depende de que los datos estén bien cargados.

## 4. "Ve su cuenta en ClubPay": un vínculo hecho y aceptado por la persona

Ni invitación ni permiso del comerciante. El comerciante **propone**; decide el
otro, desde su app.

| Estado | En la pantalla | Qué significa |
|---|---|---|
| `propuesta` | "Vinculación propuesta" | Le llegó y no la aceptó. **No ve nada.** |
| `vinculada` / `aceptada` | "Ve su cuenta en ClubPay" | Aceptó. Ve cada compra y cada pago. |
| `rechazada` | "No quiso vincular" | Dijo que no. El fiado sigue igual, en el mostrador. |
| `sin_cuenta` | "Sin cuenta en ClubPay" | Ese DNI no está en ClubPay. **No es una falla**, y por eso no va en rojo. |

Nace como propuesta por lo mismo que cuenta su sección 6: en el mostrador se
tipean documentos mal, y un dígito de más hace que el match caiga en otra
persona que abre la app y ve la deuda de un desconocido.

**Sólo `vinculada`/`aceptada` tiene `account_id`.** Los otros tres no son
"todavía no cargó": son "no hay nada que mostrarle", cada uno por un motivo
distinto que conviene contar distinto.

## 5. Cortar sesiones: no hace falta, y es mejor que no haga falta

Nuestra respuesta es que **la sesión no debería tener autoridad**. Que diga "esta
es la libreta acc_jure_4b91" y nada más; todo lo demás se pregunta en cada
operación, del lado del servidor.

Eso ya existe: cada vez que consultan una cuenta les contestamos el estado
vigente.

```json
{ "saldo": 27519.20, "limite": null, "disponible": null,
  "pausado": false, "onlineHabilitado": true }
```

Si el comerciante pausa el fiado, `pausado` pasa a `true` en la consulta
siguiente y el pedido se rechaza. No hace falta matar nada: la sesión abierta
deja de servir para comprar en el mismo instante, sin depender de que alguien
haya recordado revocarla.

Para el caso del teléfono perdido, el que tiene que cortar es ClubPay: la
sesión nació de una prueba que ellos emitieron.

Lo único que sí podemos darles, si lo quieren: una marca por cuenta que se mueve
cuando el comerciante desvincula al cliente, para que ustedes puedan invalidar
las sesiones anteriores a esa fecha. Lo agregamos si les sirve, pero nos parece
que con lo de arriba alcanza.

---

## Sobre las tres que decide German

Le vamos a recomendar esto, así lo tienen antes:

**Que la libreta online requiera ClubPay: sí.** Coincidimos, y con su argumento:
un login propio es una segunda identidad que tiene que coincidir con la de
ClubPay, y el 1% que no coincida es alguien viendo la deuda de otro.

**Cuánto del historial vive en la tienda: lo mínimo, y hay un motivo técnico
además del suyo.** `disponible` es `null` cuando no hay límite, **y no tener
límite es el caso más común** —así funciona el cuaderno—. Una pantalla armada
alrededor de "te queda tanto" tiene que tratar "no hay tope" como lo normal y no
como la excepción. Si la tienda muestra "podés cargar a la libreta" y el
historial se queda en ClubPay, ese problema no existe y el de ustedes tampoco.

**Cuánto dura la sesión: de acuerdo con vencer por inactividad**, y sobre todo
con las dos cosas que agregan y que valen más que el número: que se vea de quién
es, y que nunca se abra sola.

## Lo que queda abierto

- El pedido a ClubPay por el QR de vinculación: lo escribimos nosotros.
- Si German aprueba el detector de duplicados, lo construimos esta semana.
- Qué quieren recibir si un canje resuelve a más de una ficha.

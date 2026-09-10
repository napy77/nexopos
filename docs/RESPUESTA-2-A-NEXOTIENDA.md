# Respuesta a la segunda tanda

Va lo que era nuestro —las credenciales—, dos cosas de su documento que no cierran
y hay que resolver antes de construirlas, y el orden en que vamos.

---

## 1. Las credenciales: no son por comercio, son por capacidad

Esto quedó marcado como decisión nuestra, así que la tomamos.

En la primera respuesta habíamos propuesto dos claves, una de plataforma y una
por comercio. **Estaba mal pensado para ustedes**: NexoTienda es un solo servidor
que renderiza la tienda de cualquier comercio, no es un cliente de un comercio.
Pedirle que maneje N claves no tiene forma.

Pero la preocupación original sigue siendo válida: una sola llave que puede leer
todo, incluida la cuenta corriente de cualquier persona, concentra demasiado. Lo
que separa bien no es *de qué comercio* sino *qué puede hacer*:

| Clave | Qué abre | Por qué separada |
|---|---|---|
| `catalogo` | hosts, stores, pasillos, products, regiones, búsqueda del pueblo | Es lo que la tienda muestra a cualquiera que entre. Filtrada, no es más que la vitrina. |
| `pedidos` | crear y leer pedidos, confirmar el cobro | Escribe, pero solo pedidos. No llega a ninguna cuenta. |
| `cuentas` | la cuenta de una persona en un comercio, y registrar un pago | Es la sensible, y por eso va sola |

**Y la clave `cuentas` sola no alcanza.** Los endpoints de cuenta corriente van a
pedir además la sesión que sale del token de un solo uso de ClubPay. Sin eso, una
clave filtrada permitiría recorrer las cuentas de todo el pueblo; con eso, solo
sirve para la persona que acaba de entrar desde su billetera y consintió.

O sea: la clave dice *qué endpoint*, el token dice *de quién*. Hacen falta las
dos.

Las emitimos cuando esté la API. Si les sirve arrancar con una sola y separar
después, díganlo — pero conviene que el código las tome de tres variables desde
el principio, porque unificarlas es fácil y separarlas después es tocar todos los
llamados.

---

## 2. `openingHours` como texto libre no puede sostener dos cosas que ya
   prometieron

Esta es la que más les puede doler, porque hay pantalla construida encima.

En el contrato, `Store.openingHours` es un `string` opcional. Y hay dos cosas que
dependen de saber si el comercio está abierto **ahora**:

- **`Store.isOpenNow`**, que ya está en el tipo y la tienda muestra.
- **La excepción del vencimiento** que proponen en la sección 5: *"un pedido que
  entra fuera del horario de atención no vence"*.

De un texto libre no sale ninguna de las dos. `"Lun a Sáb de 8 a 13 y de 17 a
20:30, feriados cerrado"` es perfectamente claro para una persona y no se puede
evaluar. Y si `isOpenNow` lo calculáramos con una heurística sobre ese texto,
acertaría casi siempre y fallaría los domingos, que es cuando importa.

**Hace falta un horario estructurado.** Proponemos lo mínimo que resuelve las dos:

```ts
interface Horario {
  /** 0 = domingo. Varios tramos por día: el almacén cierra al mediodía. */
  dia: number;
  desde: string;   // "08:00"
  hasta: string;   // "13:00"
}
```

Con eso `isOpenNow` se calcula de verdad, y el reloj del vencimiento arranca
cuando el comercio abre en vez de correr de madrugada.

`openingHours` puede quedar igual, como texto para mostrar —el comerciante
escribe mejor su horario que cualquier formateo nuestro—, pero no puede ser la
fuente de la decisión.

**Lo construimos nosotros** —la pantalla va en el perfil del POS— pero necesitamos
que el campo exista en el contrato antes, así no lo agregan dos veces.

Y una consecuencia que conviene aceptar de entrada: **un comercio sin horario
cargado no tiene `isOpenNow`, tiene `null`**. No `true` ni `false`: no sabemos. La
tienda ya sabe mostrar eso —es lo mismo que hacen con `availability: unknown`— y
es mejor que decir "abierto" y que el tipo tenga la persiana baja.

---

## 3. El slug se crea en dos sistemas y nadie valida contra el otro

Ustedes lo describen bien: comercios y regiones comparten espacio de nombres y la
unicidad se valida contra los tres conjuntos. Lo que el documento no dice es que
**esos conjuntos se crean en dos sistemas distintos**: las regiones en el admin de
B2B, los slugs de comercio en NexoPOS.

Si ninguno ve la lista del otro, nada impide crear la región `morrison` cuando ya
existe un comercio con ese slug. Y no es hipotético: `ballesteros` es un pueblo y
también podría ser el apellido de un almacén.

**Lo resolvemos nosotros y ya se lo pedimos a B2B**: NexoPOS queda como árbitro
único —es quien contesta `GET /v1/hosts/{sub}`—, expone una verificación de slug
que B2B consulta antes de guardar una región, y espeja la lista de regiones con
el mismo mecanismo que ya usa para la taxonomía.

Para ustedes no cambia nada del contrato. Lo mencionamos porque si alguna vez ven
dos cosas peleándose por un subdominio, el lugar donde mirar es ese.

---

## 4. Lo demás de su lista

**El texto de los estados sale de un dato que ya existe.** "Armando" vs
"elaborando" se decide por las líneas del pedido, y eso ya lo sabemos: un producto
con política `declared` es algo que el comercio hace. No hace falta campo nuevo ni
que miren el rubro del comercio.

**`publishedInStore`, de acuerdo, y con default `true`.** El argumento es el
correcto: que tenga que apagar los pocos que no quiere, no encender los cientos
que sí. Lo construimos junto al flag de insumo, que ya está.

**Cancelar con nota, de acuerdo**, incluido que cueste un gesto. `cancelReason`
texto libre del comerciante y `cancelledBy` con los tres valores.

**El vencimiento del pedido**: su propuesta nos cierra —30 minutos configurables y
que no corra fuera del horario— con la dependencia del punto 2. Sin horario
estructurado, la excepción no se puede implementar y quedaría cancelando a
medianoche pedidos que nadie abandonó.

### Sobre capturar el pago al cobrar o al aceptar

Marcan que lo decide Germán. Agregamos el dato que le falta para decidir:
**todavía no construimos nada de Mercado Pago**, así que la decisión no tiene
costo de migración. Es tan barato hacer una como la otra.

Nuestra recomendación es **autorizar en el checkout y capturar al aceptar**,
porque es coherente con lo que ya decidimos en todo el resto: la notificación no
es una aceptación, y cobrar antes de que el comercio acepte es exactamente eso.

Con una advertencia para verificar antes de comprometerlo: **no todos los medios
de pago soportan autorizar sin capturar.** Con tarjeta suele estar; con dinero en
cuenta y algunos medios alternativos, no siempre. Si el medio no lo soporta, el
camino honesto es no ofrecer pago online para ese medio antes de la aceptación —
no capturar igual y prometer devolver.

---

## 5. En qué orden vamos

Nada de esto está construido todavía. El orden que proponemos, de más
desbloqueante a menos:

1. **La API `/v1` con lo de catálogo** —hosts, stores, pasillos, products,
   búsqueda—. Es lo que les saca los fixtures de encima y no depende de ninguna
   decisión pendiente.
2. **Slug del comercio y campos de `Store`**, incluido el horario estructurado.
3. **`publishedInStore`** y el switch de aparecer en la página del pueblo.
4. **Pedidos**: estados, `readyEstimate`, cancelar con nota, webhooks.
5. **Mercado Pago**, cuando esté decidido lo de la captura.

Si para el piloto les sirve más otro orden, díganlo: lo único que está atado es
que el 4 necesita el 2 —el vencimiento depende del horario— y el 5 va último.

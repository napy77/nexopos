# Lo que NexoB2B tiene que construir para NexoTienda

NexoTienda es la tienda online del comerciante: `{comercio}.nexotienda.app` y la
página del pueblo en `{region}.nexotienda.app`. Ya está en producción corriendo
contra datos de prueba.

Del lado de B2B hace falta **una entidad nueva y dos pantallas**. Y hay un
problema de diseño que conviene resolver antes de escribir código, porque
después se arregla con datos vivos.

---

## Por qué acá y no en otro lado

El criterio no es de qué producto es la funcionalidad, sino **quién decide**:

| Quién decide | Dónde va la pantalla |
|---|---|
| El comerciante — su dirección web, si aparece en la página del pueblo | Su perfil en **NexoPOS** |
| Nexo — qué pueblos existen, qué comercio va en cuál | El admin de **Nexo B2B** |

La región va en B2B por tres razones: el comercio ya vive ahí —el alta es en B2B
y el login de NexoPOS es esa misma cuenta—; la taxonomía compartida
(pasillo → rubro → subrubro) ya vive ahí y una región es lo mismo, un vocabulario
que Nexo cura y todos consumen; y es el único panel con vista de Nexo, porque
NexoPOS ve un comercio y NexoTienda no tiene admin.

---

## 1. La entidad `Region`

```ts
interface Region {
  slug: string;      // único en TODO el sistema, lo pone un humano
  name: string;      // "Morrison"
  province: string;  // "Córdoba"
  label: string;     // "Morrison, Córdoba" — para desambiguar en pantalla
}
```

**El slug no puede derivarse del nombre.** Hay varias Santa Rosa, varios San
Martín, varios Belgrano. El segundo pueblo homónimo que entre al sistema
colisiona con el primero, y el que se lleva la URL es el que llegó antes.

Por eso lo asigna una persona, de una vez por pueblo, y ahí se resuelven las
colisiones.

## 2. Qué comercio pertenece a qué región

**Se define por zona de reparto, no por dirección.** Un comercio a 8 km del
centro que reparte en Morrison pertenece a Morrison; uno ubicado en el centro que
solo atiende el mostrador, no. Así la página del pueblo promete algo verdadero
—"lo que te pueden traer"— y el comercio que reparte en dos pueblos aparece en
los dos.

Consecuencia: **es una relación de muchos a muchos**, no un campo en el comercio.

Y ojo con confundir dos cosas que van separadas:

| | Quién decide |
|---|---|
| El comercio **pertenece** a la región | Se deriva de su zona de reparto → **B2B** |
| El comercio **aparece** en la página del pueblo | El comerciante, con un switch → **NexoPOS** |

Lo segundo es opt-in y no lo decide Nexo: poner a dos supermercados del mismo
pueblo uno al lado del otro con los precios a la vista es un objeto social
distinto en un pueblo que en Amazon. Los dos dueños se conocen.

## 3. Las dos pantallas

- **Regiones**: listado con alta —slug, nombre, provincia, label—. Es donde se
  crea `morrison` y donde se resuelve la colisión el día que aparezca la segunda
  Santa Rosa.
- **En la ficha del comercio, "Regiones donde reparte"**: multiselección. Conviene
  poder verlo también desde la región, pero el dato canónico es del comercio.

Es el mismo tipo de pantalla que ya existe para pasillos y subrubros.

---

# El problema que hay que resolver antes

**Comercios y regiones comparten un solo espacio de nombres.**

`morrison.nexotienda.app` puede ser un pueblo o un comercio, nunca los dos. Pero
los slugs se crean en **dos sistemas distintos**: las regiones acá, los comercios
en NexoPOS. Si ninguno de los dos ve la lista del otro, nada impide que un día se
cree la región `morrison` cuando ya existe un comercio con ese slug —o al revés—.
El que pierde es el que estaba antes, y sus links ya circularon por WhatsApp.

No es hipotético: los nombres que un comerciante elige para su negocio y los
nombres de los pueblos se parecen mucho. `ballesteros` es un pueblo y también
podría ser el apellido de un almacén.

**Quién arbitra tiene que ser uno solo, y es NexoPOS**, porque es quien contesta
`GET /v1/hosts/{sub}` —la consulta que decide si un subdominio existe y qué es—.
Si el árbitro fuera B2B, NexoPOS tendría que preguntar en cada request.

Proponemos dos mecanismos, cada uno haciendo lo que hace bien:

**1. Al crear o editar una región, B2B nos pregunta si el slug está libre.**

```
GET  https://nexopos.app/api/slugs/{slug}
Authorization: Bearer <clave de plataforma>

→ { "libre": false, "motivo": "Ya lo usa un comercio" }
   { "libre": false, "motivo": "Reservado" }
   { "libre": true }
```

Una llamada, en el momento en que la persona aprieta guardar. Si falla, **no se
guarda**: es preferible que el admin diga "no pude verificar, probá de nuevo" a
que se cree un slug que rompe una tienda viva.

**2. NexoPOS espeja la lista de regiones**, con el mismo mecanismo que ya usa para
la taxonomía. Sirve para dos cosas: validar los slugs de comercio contra las
regiones sin preguntarle a B2B en cada tecla, y servir la página del pueblo.

Alcanza con exponerla donde ya miramos:

```
GET /store/regiones                        → todas las regiones
GET /store/comercios/me   (o el login)     → + regiones donde reparte
```

Si les resulta más cómodo colgarlo del payload del comercio que ya devuelve el
login, mejor todavía: es donde NexoPOS ya lee estado, ciudad y provincia.

## Las reglas de forma del slug, que son las mismas para los dos

```
3 a 40 caracteres · solo minúsculas, números y guiones
empieza y termina con letra o número · sin guiones dobles · SIN PUNTOS
```

Lo de los puntos no es estético: el certificado es `*.nexotienda.app` y un
comodín cubre **una sola etiqueta**. `santa.rosa` daría error de certificado en
el navegador, que es peor que no existir.

Y hay dos nombres que **no se pueden tomar nunca**: `acme` y `acme-ns`. Son la
delegación del certificado comodín, y perderlos rompe la renovación de todas las
tiendas a la vez. La lista completa de reservados está en `src/lib/slug.ts` del
repo de NexoTienda, junto con la validación —conviene copiar esa función y no
reescribirla.

---

## Para el piloto no hace falta esperar el admin

Morrison son un puñado de comercios. **Alcanza con sembrar los datos a mano** y
construir las pantallas cuando aparezca el segundo o tercer pueblo.

Una sola advertencia si van por ahí: sembrar la región en la base de B2B no
alcanza, porque quien la sirve es NexoPOS. O se siembra también del lado nuestro,
o se expone el endpoint del punto 2 aunque la pantalla de alta todavía no exista.

---

## Lo que necesitamos que contesten

1. **¿Va el endpoint de verificación de slug?** Es el que evita la colisión. Si
   prefieren otro mecanismo, lo charlamos, pero alguno tiene que haber.
2. **¿Dónde exponen las regiones?** Endpoint propio o colgado del comercio.
3. **¿Para el piloto siembran ustedes o sembramos nosotros?**

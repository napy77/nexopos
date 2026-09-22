# Decisiones

Por qué el sistema es como es. No es una cronología: son las decisiones que hay
que conocer para no deshacerlas sin querer.

Las fechas son aproximadas. Cuando una decisión nació de un error concreto, el
error está contado: es lo que hace que la decisión se entienda.

---

## DEC-001 · El alta y el login son de NexoB2B

**Fecha:** temprano · **Estado:** vigente

**Decisión.** NexoPOS no tiene registro propio. `POST /api/auth/login` valida
contra NexoB2B y, si pasa, emite nuestro JWT y guarda el de B2B.

**Motivo.** *"Nunca tendremos comercios sin NexoB2B: la única manera de darse de
alta en NexoPOS es darse de alta en NexoB2B."* Una segunda identidad tendría que
mantenerse sincronizada con la primera para siempre.

**Consecuencias.** Sin cuenta en B2B no hay POS. Si la sesión de B2B vence, lo
que dependa de B2B deja de andar hasta que el comerciante vuelva a entrar. La
ficha del comercio se copia pero no se edita acá.

**Sistemas:** NexoPOS, NexoB2B.

---

## DEC-002 · SQL a mano, sin ORM

**Fecha:** desde el inicio · **Estado:** vigente

**Decisión.** `pg` y SQL escrito. Migraciones `.sql` numeradas que corren al
arrancar; si una falla, el proceso termina.

**Motivo.** El esquema tiene que poder migrar a Odoo sin traducciones, y las
consultas del POS son de reporte más que de CRUD. Un ORM ahí esconde más de lo
que ahorra.

**Consecuencias.** TypeScript no valida el SQL. Un `tsc --noEmit` limpio no
prueba nada de la base — ver DEC-012.

---

## DEC-003 · Multi-tenancy por fila, con el `commerce_id` del JWT

**Estado:** vigente

**Decisión.** Casi toda tabla lleva `commerce_id`, y ese valor sale **siempre**
del token.

**Motivo.** Es lo único que separa los datos de un comercio de los de otro. Un
`commerce_id` que venga del body es un comercio leyendo el de al lado.

---

## DEC-004 · El precio de NexoB2B es el costo, nunca el de venta

**Estado:** vigente

**Decisión.** El `precio` que llega de B2B entra como `cost`. El precio de venta
lo pone el comerciante, o lo calculan los márgenes.

**Motivo.** Es lo que el mayorista le cobra a los almacenes. Usarlo como precio
de mostrador haría vender a costo miles de productos de una vez, y el comerciante
se enteraría al cerrar la caja.

**Consecuencias.** Un catálogo importado entra sin precio y no sale a la tienda
—no aparecer es un problema visible; venderse a cero, no—. De ahí nacieron la
pantalla de Márgenes y el contador de "sin precio".

---

## DEC-005 · Los avisos se encolan en la transacción y se mandan después

**Estado:** vigente · **Sistemas:** ClubPay, NexoTienda, NexoB2B

**Decisión.** Toda cola saliente escribe su fila **dentro de la misma
transacción** que el cambio de estado. La llamada por red ocurre después, con
reintentos a 1, 5, 15, 60 minutos y luego cada 6 horas, hasta 12 intentos.

**Motivo.** Que un sistema externo no conteste no puede frenar al cajero. Pero
el aviso tampoco puede perderse: si se pierde, el comprador mira una pantalla
que dice algo que ya no es cierto, o al mayorista le sobra mercadería vendida.

**Consecuencias.** Con la URL sin configurar los avisos **se acumulan**, no se
descartan.

---

## DEC-006 · ClubPay decide el importe del descuento

**Estado:** vigente

**Decisión.** El descuento se recalcula al registrar la transacción, aunque el
QR se haya validado segundos antes. Si ClubPay rechaza, la venta no se hace y el
cajero ve el motivo tal como ClubPay lo escribió.

**Motivo.** Entre validar y cobrar pudo pasar la medianoche, o el socio pudo
usar el beneficio en otra caja.

---

## DEC-007 · El vínculo con ClubPay nace como propuesta

**Estado:** vigente

**Decisión.** Al cargar un documento se **propone** la vinculación; la persona
la acepta desde su app. Hasta entonces no ve nada.

**Motivo.** En el mostrador se tipean documentos mal. Un dígito de más hace que
el match caiga en otra persona, que abre la app y ve la deuda de un desconocido.

**Consecuencias.** Sólo `vinculada`/`aceptada` tiene `account_id`, y sin
`account_id` no hay libreta online. El documento viaja **una sola vez** en la
vida de la relación: para consultar el estado hay una ruta de sólo lectura.

**Nota:** ClubPay usa `vinculada` en su base y `aceptada` en su documentación.
Comparar con `vinculacionAceptada()`, nunca con `=== "vinculada"`.

---

## DEC-008 · Los cursores de sincronización llevan fecha **e** id

**Fecha:** septiembre · **Estado:** vigente · **Sistemas:** NexoB2B

**Decisión.** El sync de fichas pagina con `(fecha, id)`, y el objeto
`siguiente` se reenvía tal cual vino, sin rearmarlo.

**Motivo.** Propusimos paginar sólo por fecha. NexoB2B lo midió: un UPDATE
masivo deja varias filas con la marca idéntica —las filas se procesan más rápido
que la resolución del reloj— y con 7.000 productos los empates son la norma. Con
fecha sola, `>` saltea y `>=` se estanca, los dos en silencio.

**Consecuencias.** Vale como criterio general para cualquier paginación por
tiempo en el ecosistema.

---

## DEC-009 · La clave de idempotencia se fija antes de salir

**Estado:** vigente

**Decisión.** El lote del outbox de stock se asigna cuando el aviso sale por
primera vez y no se mueve. Se reintenta siempre el mismo lote.

**Motivo.** Si se armara con lo que esté pendiente en cada vuelta, una venta que
entra entre el intento fallido y el siguiente cambiaría el conjunto, cambiaría la
clave, y lo ya aplicado se aplicaría de nuevo — justo lo que la clave venía a
evitar.

---

## DEC-010 · Los clientes duplicados se detectan, no se fusionan

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** Hay un detector que avisa en el alta y lista los sospechosos.
**No fusiona nada.** No hay índice único por documento ni por teléfono.

**Motivo.** Fusionar es sumar saldos y mover movimientos: si está mal, alguien
queda debiendo lo que no debe. Y exigir documento rompería el alta de mostrador,
que tiene que seguir siendo escribir un nombre y listo — la mayoría de las
libretas son "Doña Rosa" y nada más.

**El hallazgo que definió el cómo.** Dos fichas reales del mismo señor:

```
documento 2698535    teléfono 0351155630140   $850,00
documento 26098535   teléfono 3515630140      $27.519,20
```

El documento tiene un dígito comido **en el medio**: no son iguales ni uno es
prefijo del otro, así que **ningún cruce por documento los junta**. El teléfono
sí, normalizado. Por eso el detector va **por teléfono primero**.

**Consecuencias.** El QR de vinculación en el mostrador —pedido a ClubPay— es la
solución de fondo: ata **una ficha** a una persona, no un documento.

---

## DEC-011 · Las campañas cambian el precio de la tienda, no el del mostrador

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** El descuento de campaña sólo afecta `/v1`. El cajero sigue
cobrando el precio de lista. La pantalla lo dice con los dos números.

**Motivo.** Cambiar lo que cobra la caja es tocar el camino del dinero y nadie
lo pidió. El comerciante que quiere las dos cosas tiene que poder decirlo, no
descubrirlo.

**Consecuencias.** Un cliente que ve la oferta online y viene al local va a
notar la diferencia. En un pueblo eso se cuenta, no se completa en una encuesta:
por eso la pantalla muestra "En el mostrador $8.500 / En la tienda $6.375" por
producto, en vez de enunciar la regla arriba.

---

## DEC-012 · Verificar contra la base o la API, no contra el compilador

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** Un cambio en una consulta SQL no está verificado hasta que se
ejecutó contra una base.

**Motivo.** `precio_manual` agregó `$5 IS NOT NULL` a cuatro consultas del camino
de la plata. Un parámetro que sólo aparece dentro de `IS NOT NULL` no le dice a
Postgres de qué tipo es y Postgres rechaza la consulta entera. Compiló perfecto
y **`/api/stock/adjust` y `/api/stock/add-from-catalog` estuvieron rotos cinco
días en producción**.

**Consecuencias.** Es la regla 7 de `CLAUDE.md`. Y explica por qué la falta de
tests automatizados es la deuda más grande del proyecto.

---

## DEC-013 · Una ruta literal va siempre antes que un comodín

**Estado:** vigente

**Decisión.** `/orden` antes que `/:id`; `/productos/orden` antes que
`/productos/:productId`.

**Motivo.** Express le pasa `"orden"` como id y el 404 no explica nada. Pasó tres
veces: con `/:id/:paso` comiéndose `/:id/cancelar`, y dos veces en campañas.

---

## DEC-014 · Un fallo del sistema de atrás nunca sale con nuestro código

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** Un error del salto a ClubPay o a NexoB2B sale como **502**, con un
mensaje que dice de qué lado está el problema. Nunca se reenvía el status tal
cual.

**Motivo.** Un 404 de ClubPay salía como 404 nuestro, y la tabla de diagnóstico
de NexoTienda lo leía —con razón— como "la ruta de NexoPOS no existe". Dos causas
opuestas, el mismo número, tres equipos señalándose entre sí durante días.

**Corolario más general:** un error que no dice de quién es manda a buscar al
lugar equivocado. Un mensaje que dice "probá de nuevo en un rato" ante una causa
permanente hace que el comerciante apriete el mismo botón toda la semana.

---

## DEC-015 · NexoTienda autentica por capacidad, no por comercio

**Estado:** vigente

**Decisión.** Tres claves: `catalogo`, `pedidos`, `cuentas`.

**Motivo.** NexoTienda es un solo servidor que renderiza la tienda de
cualquiera: no es cliente de un comercio y no puede tener una clave por comercio.
Lo que separa bien ahí es *qué puede hacer*. La sensible va sola: con una única
llave, filtrarla por un log expondría también las libretas del pueblo.

**Consecuencias.** La clave de cuentas **no alcanza sola**: esos endpoints piden
además la sesión del comprador. La clave dice qué endpoint, la sesión dice de
quién.

---

## DEC-016 · La sesión de libreta no tiene autoridad

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** El canje devuelve qué libreta es y nada más. Si se puede comprar,
cuánto hay disponible y si el fiado está pausado se pregunta **en cada
operación**.

**Motivo.** Una sesión con autoridad hay que revocarla, y vive en una cookie de
un navegador ajeno que nadie puede cerrar. Preguntando cada vez, pausar el fiado
tiene efecto en la consulta siguiente sin que nadie recuerde revocar nada.

**Consecuencias.** `linkedAt` es la única revocación que existe, para el caso de
desvinculación o teléfono perdido. NexoTienda compara **el valor**, no la fecha
contra un reloj: no importa cuánto se corrió, importa que se corrió.

---

## DEC-017 · El `account_id` es de la relación, no de la persona

**Estado:** vigente

**Decisión.** No existe ninguna clave que identifique a un comprador a través
del pueblo. El id es de "esta persona en este comercio".

**Motivo.** Que el almacén y la ferretería no puedan descubrir que Juan es el
mismo Juan tiene que ser una **propiedad del modelo**, no una promesa del código:
las promesas se rompen con un `JOIN` distraído.

**Consecuencias.** Un token que lleva un `account_id` no puede abrir otra tienda
porque no hay nada adentro que nombre a otra tienda. La protección sale del
diseño y nadie tiene que prometerla.

---

## DEC-018 · Las dos mitades de una sincronización se prenden juntas

**Fecha:** septiembre · **Estado:** vigente, apagado por comercio

**Decisión.** El stock compartido con NexoB2B tiene un interruptor por comercio,
apagado por defecto, y enciende los dos sentidos a la vez.

**Motivo.** Media sincronización es peor que ninguna: deja el número bajando y
nunca subiendo, y a la semana el comerciante deja de creerle.

**Consecuencias.** Sigue apagado esperando que Rivera Hogar confirme cómo se
comporta su ERP. Hay una ventana conocida entre la venta y su facturación en la
que el stock puede subir solo; se corrige sola y la pantalla lo explica.

---

## DEC-019 · Guardar lo que el comerciante escribió, no lo que se deduce

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** En una campaña, si puso un porcentaje se guarda el porcentaje; si
puso un precio se guarda el precio.

**Motivo.** $8.500 a $5.000 es 41,176470…%. Redondeado a dos decimales y vuelto
a aplicar devuelve **$5.000,30**. El comerciante escribió cinco mil y la góndola
diría otra cosa.

---

## DEC-020 · La taxonomía se agrupa por nombre cuando no hay id

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** Las categorías de la tienda y las reglas de margen se agrupan por
una clave que usa el id si existe y el **nombre** si no.

**Motivo.** La importación de catálogo propio guarda los nombres pero no los ids
—el endpoint de B2B mandaba sólo nombres—, así que todo el catálogo de un
comercio quedaba con el id en NULL. Agrupando por id, **Rivera Hogar tenía todo
el local adentro de una sola categoría**, bautizada con el `MAX()` de los
nombres.

**Consecuencias.** Vale también para las reglas de margen: por id no alcanzarían
a ningún producto del comercio que más lo necesita.

---

## DEC-021 · Un mock más indulgente que la API no prueba nada

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** Los mocks imitan la forma **exacta** de la respuesta real,
incluidos los campos que no usamos.

**Motivo.** El mock de ClubPay devolvía `{...item, ok:true}` — echaba justo el
campo que uno mandaba. Con eso, un cruce de resultados equivocado pasaba todas
las pruebas locales, y la única forma de descubrirlo era leyendo el código.

---

## DEC-022 · La documentación para humanos se despliega, no se deja en un MD

**Fecha:** septiembre · **Estado:** vigente

**Decisión.** La API para ERP tiene documentación HTML en `/docs/api`, fuera del
área con login, enlazada desde donde se administran las claves.

**Motivo.** *"No podemos dejar el documento en un MD... tendremos developers que
lo realizan ellos, otros se apoyarán con IA, pero tiene que ser para humanos."*

---

## DEC-023 · La memoria del proyecto es Git y `docs/`, no el chat

**Fecha:** 21 de septiembre de 2026 · **Estado:** vigente

**Decisión.** `CLAUDE.md` y `docs/` son la memoria permanente. Los chats son
temporales y por tarea. Actualizar la documentación es parte de terminar un
cambio, no una tarea aparte.

**Motivo.** El chat histórico se volvió tan grande que cada modificación costaba
demasiado contexto, y el conocimiento quedaba atado a una conversación que nadie
más puede leer.

**Consecuencias.** Una sesión nueva empieza con *"Lee CLAUDE.md y
docs/CURRENT_STATE.md"*. `CURRENT_STATE.md` se mantiene corto porque se lee
siempre.

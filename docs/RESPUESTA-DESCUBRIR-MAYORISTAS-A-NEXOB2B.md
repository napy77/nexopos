# Respuesta a NexoB2B: Descubrí mayoristas en NexoPOS

**De:** NexoPOS · **Para:** NexoB2B · **Fecha:** 16/11/2026
**Sobre:** `PARA-NEXOPOS-DESCUBRIR-MAYORISTAS.md`

Gracias, estaba muy completo. Ya está hecho de nuestro lado.

## No hace falta `/api/v1/pos/mayoristas`

Tenemos la publishable key y ya la usábamos en `/store/*`. Así que usamos lo
mismo que el portal:

- `GET /store/mayoristas/lista`, con `lat`, `lng`, `radio_km`, `rubros` y
  `busqueda`;
- `GET /store/tipos-comercio`, para las equivalencias;
- `POST /store/solicitudes`, para pedir el alta;
- `GET /store/productos?mayorista_id=`, para «Ver catálogo»;
- `GET /store/comercios/me`, para `lat`, `lng` y `rubros` del comercio.

## Lo que hicimos igual que el portal

- Los rubros sugeridos salen de la unión de las equivalencias de los tipos del
  comercio, comparando sin mayúsculas.
- El resguardo sin rubros, con el mismo aviso. «Ampliar radio» va al siguiente
  de 25, 50, 100, 200 y todo el país.
- Mismos filtros: radio, «Qué vende» (sin «Otros»), «Todos los rubros» y
  «Volver a mis rubros», texto con pausa de 400 ms, y orden por «Más cerca»,
  «Más productos» o «A a Z».
- La misma tarjeta: portada (o color por `id`), logo (o inicial), distancia en
  m o km, «N productos publicados» y tres fotos (o la descripción). El
  separador «Sin ubicación cargada» también.
- Logo y portada absolutos y con `?v=<updated_at>`.

Agregamos una sola cosa que el mostrador necesita: con el alta aceptada, la
tarjeta muestra el vendedor o el contacto, con su WhatsApp.

## Una cosa que conviene saber

Si el comercio no tiene ubicación, el enlace «Configurar ubicación» lo manda a
`https://nexob2b.app/comercio/perfil`. Si esa dirección cambia, avísennos.

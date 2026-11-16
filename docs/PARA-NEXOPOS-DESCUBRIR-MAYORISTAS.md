# Descubrí mayoristas: cómo reutilizarlo en NexoPOS

**De:** Nexo B2B · **Para:** NexoPOS · **Fecha:** 16/11/2026
**Sobre:** la búsqueda de mayoristas que el comercio ve en el portal (`/comercio/mayoristas`), para que NexoPOS pueda mostrar lo mismo desde el mostrador.

## 1. Qué hace la pantalla

El comercio ve los mayoristas de la red, cerca suyo y de los rubros que le sirven. Cada uno aparece en una tarjeta con portada, logo, nombre, rubro, ciudad, distancia, cantidad de productos y tres fotos de su catálogo. Desde ahí puede **ver el catálogo** o **pedir el alta**.

## 2. Dos listas de rubros que no son la misma

Antes de consumir los datos hay que separar estos dos conceptos, porque era la causa de que la búsqueda saliera vacía.

| | Qué describe | Dónde vive | Ejemplos |
|---|---|---|---|
| **Tipo de comercio** | Qué negocio es el comercio | `comercio.rubros` (texto). La lista se administra en Admin → Parámetros → Tipos de comercio | Almacén / Kiosco, Restaurante / Bar, Ferretería |
| **Rubro de mayorista** | Qué vende el mayorista | `mayorista.rubros` (texto). Lista fija | Alimentos y bebidas, Limpieza y hogar, Electrónica |

**No se comparan directo.** Para saber qué mayoristas le sirven a un comercio se usa la **equivalencia** de cada tipo de comercio: la lista de rubros de mayorista a los que les compra. Se edita en Parámetros y viene en `GET /store/tipos-comercio` (punto 4.1). Un tipo sin equivalencias quiere decir «no filtrar, mostrar todos».

Rubros de mayorista vigentes:

```
Alimentos y bebidas · Limpieza y hogar · Electrónica · Indumentaria y calzado ·
Ferretería y construcción · Farmacia y perfumería · Librería y papelería ·
Juguetes y entretenimiento · Automotor · Otros
```

## 3. Autenticación

Los endpoints de abajo son de la API `store` de B2B. Llevan:

- `Authorization: Bearer <token del comercio>`, el mismo token que ya usan en `/api/v1/pos/*`.
- `x-publishable-api-key: <publishable key de B2B>`. Todo `/store/*` la exige.

Si NexoPOS no tiene la publishable key, avísennos: o se la pasamos, o les abrimos el mismo dato en `/api/v1/pos/mayoristas` (ver punto 7).

Permisos del equipo del comercio: listar mayoristas y pedir altas piden el permiso **`contactos`**. Sin él, la respuesta es `403 { codigo: "sin_permiso", permiso: "contactos" }`.

## 4. Endpoints

### 4.1 `GET /store/tipos-comercio`: equivalencias

Público (solo publishable key).

```json
{
  "tipos": ["Almacén / Kiosco", "Ferretería", "Otro"],
  "equivalencias": {
    "Almacén / Kiosco": ["Alimentos y bebidas", "Limpieza y hogar", "Farmacia y perfumería", "Librería y papelería", "Juguetes y entretenimiento"],
    "Ferretería": ["Ferretería y construcción", "Limpieza y hogar", "Automotor", "Electrónica"],
    "Otro": []
  }
}
```

Rubros sugeridos para un comercio = **unión** de las equivalencias de sus tipos (`comercio.rubros`). La comparación de nombres es sin distinguir mayúsculas.

### 4.2 `GET /store/mayoristas/lista`: la búsqueda

Parámetros de consulta, todos opcionales:

| Parámetro | Ejemplo | Qué hace |
|---|---|---|
| `lat`, `lng` | `-32.6`, `-62.8` | Ubicación del comercio. Sin ellos no se calcula distancia ni se filtra por radio |
| `radio_km` | `50` | Por defecto 50. El portal usa 25, 50, 100, 200 o 9999 («todo el país») |
| `rubros` | `Alimentos y bebidas,Limpieza y hogar` | Rubros de **mayorista**, separados por coma. El mayorista tiene que tener al menos uno |
| `busqueda` | `delfin` | Texto: nombre, ciudad, provincia o rubro |

Reglas del servidor:

- Solo devuelve mayoristas en estado `aprobado`.
- Con `lat`/`lng`, los que están fuera del radio se descartan. Los que **no cargaron ubicación** se incluyen siempre, con `distancia_km: null`.
- Orden: primero los que tienen distancia, de más cerca a más lejos; después los sin ubicación.

Respuesta (un elemento):

```json
{
  "mayoristas": [
    {
      "id": "01K...",
      "nombre": "Supermercado Delfin Morrison",
      "email": "ventas@delfin.com.ar",
      "telefono": "+54 9 3537 ...",
      "ciudad": "Morrison",
      "provincia": "Córdoba",
      "rubros": ["Alimentos y bebidas"],
      "descripcion": "…",
      "visibilidad": "con_precio",
      "logo_url": "/logos/logo_01K....jpg",
      "portada_url": "/logos/portada_01K....jpg",
      "updated_at": "2026-11-12T02:30:00.000Z",
      "distancia_km": 0.8,
      "solicitud": { "id": "…", "estado": "aceptado", "mayorista_id": "01K..." },
      "contacto": { "nombre": "Carlos Garcia", "celular": "+54...", "email": "…", "es_vendedor": true },
      "productos_count": 7764,
      "muestras": [
        { "nombre": "Dulce de leche La Paulina 400 g", "imagen_url": "https://…/dulce.webp" }
      ]
    }
  ],
  "meta": { "total": 4, "lat": -32.6, "lng": -62.8, "radio_km": 50, "rubros_filtro": ["Alimentos y bebidas"], "busqueda": "" }
}
```

Campos que hay que interpretar:

| Campo | Cómo usarlo |
|---|---|
| `solicitud` | `null` = no pidió alta (mostrar «Pedir alta»). `estado`: `pendiente`, `aceptado` (habilitado para comprar) o `rechazado` |
| `contacto` | Si tiene vendedor asignado, es el vendedor (`es_vendedor: true`); si no, el mayorista |
| `productos_count` | Productos aprobados y con precio que publica |
| `muestras` | Hasta 3 fotos, con prioridad para productos con stock. Puede venir vacío |
| `logo_url`, `portada_url` | Pueden venir **relativas** (`/logos/…`): anteponer `https://nexob2b.app`. Las externas ya vienen completas. Pueden ser `null` |
| `updated_at` | Agregarlo como `?v=<timestamp>` a logo y portada. El nombre del archivo no cambia cuando el mayorista sube uno nuevo, y sin esto queda la imagen vieja en caché |

### 4.3 `POST /store/solicitudes`: pedir el alta

```json
{ "mayorista_id": "01K...", "mensaje": "opcional" }
```

- `200`: solicitud creada en `pendiente`; le llega al mayorista.
- `409`: ya existe una solicitud con ese mayorista (viene en `solicitud`).

### 4.4 Ver el catálogo de un mayorista

`GET /store/productos?mayorista_id=<id>` (mismo formato que ya usan en `/api/v1/pos/productos`: precios con la lista del comercio aplicada y `muestra_precio` según DEC-018). `/api/v1/pos/productos` hoy **no** filtra por mayorista.

## 5. Lógica de la pantalla (lo que hace el portal)

1. Leer el comercio (`lat`, `lng`, `rubros`) y `GET /store/tipos-comercio`.
2. Calcular los **rubros sugeridos** con las equivalencias (punto 4.1). Arrancar con esos activos.
3. Llamar a `GET /store/mayoristas/lista` con `lat`, `lng`, `radio_km=50` y `rubros=<sugeridos>`.
4. **Resguardo:** si con rubros vuelve vacío, repetir la llamada **sin** `rubros`. Si eso trae resultados, mostrarlos con el aviso: «No encontramos mayoristas de tus rubros en 50 km. Te mostramos todos los de la zona.». Así la pantalla nunca queda vacía por la equivalencia.
5. Si sigue vacío, ofrecer «Ampliar radio» (al siguiente valor de 25, 50, 100, 200, todo el país).
6. Filtros que puede tocar el usuario: radio, rubros de mayorista (todos los de la lista menos «Otros», con «Todos los rubros» y «Volver a mis rubros»), y texto.
7. Orden en cliente: **Más cerca** (el del servidor), **Más productos** (`productos_count` descendente) o **A a Z** (nombre).
8. Si el comercio no tiene ubicación: no hay radio; mostrar «Configurar ubicación».

## 6. Tarjeta sugerida

| Elemento | Dato |
|---|---|
| Cabecera | `portada_url`. Si no hay, un color fijo por mayorista (el portal usa un degradé elegido por un hash simple del `id`) |
| Logo | `logo_url`; si falta o no carga, la inicial del nombre |
| Distancia | `distancia_km`: menos de 1 km en metros (`800 m`), si no en km. Oculta si es `null` |
| Nombre y subtítulo | `nombre`; `rubros[0] · ciudad, provincia` |
| Productos | «N productos publicados», si `productos_count > 0` |
| Fotos | `muestras` (3 cuadradas); si no hay, `descripcion` cortada a 3 líneas |
| Estado | Etiqueta según `solicitud.estado` |
| Acciones | «Ver catálogo» siempre; «Pedir alta» si `solicitud` es `null` |

## 7. Si prefieren un endpoint propio en `/api/v1/pos`

Si les resulta más cómodo no usar la publishable key, podemos abrir `GET /api/v1/pos/mayoristas` (mismos parámetros y respuesta que 4.2, ya con los rubros sugeridos aplicados y el resguardo hecho en el servidor) y `POST /api/v1/pos/mayoristas/:id/alta`. Avísennos y lo armamos con el permiso `nexopos`.

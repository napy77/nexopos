# El catálogo grande: los tres están

Y las dos formas viejas siguen andando, así que **pueden desplegar cuando
quieran, no hay que coordinar nada**.

## 1. Pedir un pedazo

```
GET /v1/stores/:id/products?pasillo=n:Almacén&sub=r:Aceites&q=girasol&limit=60&offset=0

{ "items": [...], "total": 214 }
```

- `total` cuenta **después** de todos los filtros, el de stock incluido.
- `q` busca sobre nombre, marca y subrubro: es lo que ustedes filtraban en
  memoria, movido al único lugar donde están las siete mil filas.
- `ids=331,412,77` para el puñado suelto.
- `limit` por defecto 60, techo 200.
- `sub` acepta el id del árbol (`r:Aceites`, `s:Girasol`) o el nombre pelado,
  que es lo que tenían a mano hasta ahora.

**Sin ningún parámetro sigue devolviendo el arreglo pelado de siempre.** Las dos
formas conviven a propósito: cambiar la forma de una sola vez les rompe la
portada a todos los comercios hasta que ustedes desplieguen. Cuando confirmen
que migraron, sacamos el arreglo.

## 2. El árbol

`GET /v1/stores/:id/pasillos` ahora trae `children`, con la profundidad que
tenga:

```json
[{
  "id": "n:Almacén", "name": "Almacén", "productCount": 5,
  "subCategories": ["Girasol", "Oliva", "Secas"],
  "children": [{
    "id": "r:Aceites", "name": "Aceites", "productCount": 3,
    "children": [
      { "id": "s:Girasol", "name": "Girasol", "productCount": 2 },
      { "id": "s:Oliva",   "name": "Oliva",   "productCount": 1 }
    ]
  }]
}]
```

**Sale de los productos que el comercio tiene, no del catálogo maestro.** Es lo
que pidieron y tienen razón en el porqué: un subrubro vacío en pantalla no se
lee como "qué raro, está vacío", se lee como que la tienda anda mal. Contando
desde los productos, un nodo sin nada no existe.

Los ids van prefijados por nivel (`r:`, `s:`) porque un rubro y un subrubro
pueden llamarse igual —"Aceites" adentro de "Aceites"— y hay que poder pedir uno
sin traerse el otro.

`subCategories` sigue viajando al lado de `children`, por lo mismo que el
arreglo pelado. Se va cuando digan.

Dos cosas que van a ver y no son errores: un pasillo puede tener un
`productCount` mayor que la suma de sus hijos —son los productos clasificados
en el pasillo pero sin rubro—, y existe un nodo `sin-pasillo` llamado "Otros"
con los que no tienen nada.

## 3. Destacados

```
GET /v1/stores/:id/highlights
{ "bestSellers": ["331", ...], "mostSearched": ["77", ...] }
```

Diez de cada uno, ventana de 60 días.

**El piso, que era el punto más filoso de su documento:** un producto entra con
3 unidades vendidas, y la lista entera se descarta si no llega a 5 productos.
Debajo de eso va `[]`.

Su argumento es el que definió los números: el almacenero sabe de memoria qué es
lo que más vende, y una lista que diga otra cosa le enseña en dos segundos que
la pantalla inventa. Después no le cree ninguna otra.

Los reembolsos entran en negativo y se restan solos. Lo que se vendió y volvió
no es lo que más se vende.

### Lo más buscado no existía, y ahora empieza a existir

No teníamos el dato: la búsqueda se resolvía de su lado, en memoria. Con el
filtro `q` pasa por acá y se empieza a juntar, así que **va a estar vacío para
todos los comercios hasta que haya búsquedas de verdad**, que es exactamente el
estado que ustedes ya contemplaron.

Guardamos el término y nada más. Ni ip, ni sesión, ni quién: para saber qué le
falta a la góndola alcanza con qué se buscó, y lo demás sería juntar datos de
personas porque se puede.

Un detalle que salió de probarlo, por si les sirve el criterio: el piso de "lo
más buscado" lo medimos en **términos**, no en productos. Dos búsquedas
distintas pueden caer en el mismo producto —"oliva" y "zuelo" son el mismo
aceite— y contando productos, cinco búsquedas repetidas se volvían cuatro y
tiraban abajo una lista con evidencia de sobra.

## 4. La que no construimos

De acuerdo con dejar "lo que solés llevar" en el navegador, y el motivo es
bueno: el camino normal de compra es anónimo, así que una lista atada al
`accountId` serviría para la minoría que tiene libreta.

## Lo que queda de nuestro lado

Nada bloqueante. Cuando confirmen que migraron sacamos las dos formas viejas
—el arreglo pelado y `subCategories`— y con eso queda una sola manera de pedir
cada cosa.

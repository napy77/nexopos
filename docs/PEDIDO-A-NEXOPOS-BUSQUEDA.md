# Pedido a NexoPOS: búsqueda de catálogo por palabras (mismo método que Nexo B2B)

**De:** Nexo B2B · **Para:** NexoPOS · **Fecha:** 30/10/2026

En Nexo B2B teníamos los mismos dos problemas en el buscador del catálogo y los
resolvimos el 29 y 30/10. Les pasamos el método y el código para que el
comerciante encuentre lo mismo en los dos sistemas.

## Los dos problemas

1. **La lista «se acomoda» varias veces al escribir.** Cada tecla dispara una
   búsqueda y las respuestas vuelven desordenadas: la de «fe» llega después que
   la de «fernet» y la pisa.
2. **No encuentra si no escribís el nombre exacto.** Era un
   `nombre ILIKE '%texto%'`. «blanco jabon ala» no encontraba «Jabón Ala para
   blancos», por el orden de las palabras y el acento. Y los nombres que vienen
   abreviados de los sistemas de los mayoristas («Jab. liq. ala») no aparecían
   buscando «jabon».

## 1. En la pantalla: esperar a que termine de escribir

- Separar **lo que se ve en la caja** de **lo que se busca**. Se busca 400 ms
  después de la última tecla, o al instante con Enter.
- Numerar cada pedido y **descartar la respuesta si no es la del último**.

```tsx
const [texto, setTexto] = useState("")   // lo que se ve
const [q, setQ] = useState("")           // lo que se busca
useEffect(() => {
  const t = setTimeout(() => setQ(texto.trim()), 400)
  return () => clearTimeout(t)
}, [texto])
const pedidoActual = useRef(0)

// dentro de la función que busca (depende de `q`):
const nro = ++pedidoActual.current
const res = await fetch(`/…/productos?q=${encodeURIComponent(q)}`)
const data = await res.json()
if (nro !== pedidoActual.current) return   // llegó tarde: hay una búsqueda más nueva
setProductos(data.productos)

// la caja:
<input value={texto} onChange={e => setTexto(e.target.value)}
       onKeyDown={e => { if (e.key === "Enter") setQ(texto.trim()) }} />
```

## 2. En el servidor: búsqueda por palabras, ordenada por relevancia

**Qué encuentra:** un producto aparece si contiene **alguna** de las palabras
buscadas (sobre nombre + marca), o si el texto coincide con su EAN o con el EAN
de cualquiera de sus presentaciones.

**Cómo compara:**
- Sin mayúsculas ni acentos («jabon» = «Jabón»). Usamos `translate()` de
  Postgres para no depender de la extensión `unaccent`.
- Ignora palabras vacías: de, del, la, las, el, los, con, sin, para, por, en,
  y, a, al, x, un, una.
- Como mucho 8 palabras.

**Cómo ordena**, de más a menos importante (todo DESC):
1. El EAN coincide exacto.
2. La frase entera aparece tal cual.
3. **Cuántas** de las palabras buscadas aparecen. Primero los que tienen todas,
   después los que tienen algunas.
4. **Puntaje**: cada palabra suma
   - **3** si aparece como palabra entera, en plural (+s / +es) **o abreviada
     con punto** («Jab.» o «Jabo.» para «jabon»; prefijos de 3 letras o más
     seguidos de punto);
   - **2** si es el comienzo de una palabra («ala» en «Alacena»);
   - **1** si está en el medio de una palabra.
5. Alfabético.

Ejemplo real: buscando «blanco jabon ala», «Jab. liq. ala diluir mas blancos»
(3 palabras, todas enteras o abreviadas) sale antes que «Alacena 0 40m Blanco»
(2 palabras, y «ala» sólo como comienzo de «Alacena»).

### El código (Postgres, TypeScript)

Es el que usamos en `apps/backend/src/lib/busqueda.ts`. `ph(valor)` agrega el
parámetro y devuelve su placeholder (`$3`); `p` es el alias de la tabla de
productos. Si sus columnas o la tabla de presentaciones se llaman distinto,
hay que cambiar sólo eso.

```ts
const CON_ACENTO = "áéíóúüñàèìòùâêîôûäëïöÁÉÍÓÚÜÑ"
const SIN_ACENTO = "aeiouunaeiouaeiouaeioAEIOUUN"

/** Expresión SQL que normaliza una columna o expresión */
export const normSql = (expr: string) => `translate(lower(${expr}), '${CON_ACENTO}', '${SIN_ACENTO.toLowerCase()}')`

function normJs(s: string): string {
  let out = s.toLowerCase()
  for (let i = 0; i < CON_ACENTO.length; i++) out = out.split(CON_ACENTO[i].toLowerCase()).join(SIN_ACENTO[i].toLowerCase())
  return out
}

/** Palabras que no ayudan a encontrar nada */
const VACIAS = new Set(["de", "del", "la", "las", "el", "los", "con", "sin", "para", "por", "en", "y", "a", "al", "x", "un", "una"])

const escaparLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c)

/**
 * Arma la condición y el orden para una búsqueda.
 * `ph(valor)` agrega el parámetro y devuelve su placeholder (`$3`).
 * `p` es el alias de `producto_maestro` en la consulta.
 */
export function busquedaProductos(q: string, ph: (v: any) => string, p = "p"): { where: string; orden: string; rangos: string[] } | null {
  const frase = normJs(String(q || "").trim()).replace(/\s+/g, " ")
  if (!frase) return null

  const palabras = [...new Set(frase.split(" ").filter((w) => w && !VACIAS.has(w)))].slice(0, 8)
  const texto = normSql(`${p}.nombre || ' ' || COALESCE(${p}.marca, '')`)
  const crudo = String(q).trim()

  const phCrudo = ph(`%${escaparLike(crudo)}%`)
  const phFrase = ph(`%${escaparLike(frase)}%`)
  const phEan = ph(crudo)

  // EAN del producto o de cualquiera de sus presentaciones (la botella, la caja…)
  const porEan = `(${p}.ean ILIKE ${phCrudo} OR EXISTS (
      SELECT 1 FROM producto_maestro_presentacion ppq
       WHERE ppq.producto_id = ${p}.id AND ppq.deleted_at IS NULL AND ppq.ean_propio ILIKE ${phCrudo}))`

  /**
   * Cada palabra puede aparecer de tres maneras, de mejor a peor:
   *   3 · palabra entera, plural o ABREVIATURA: «ala», «blancos», «Jab.» para
   *       «jabon» (los nombres de Delfín vienen abreviados: «Jab. liq. ala»)
   *   2 · comienzo de una palabra: «ala» en «Alacena»
   *   1 · en el medio de una palabra
   * Primero se ordena por CUÁNTAS palabras aparecen y después por el puntaje:
   * «Jab. liq. ala blancos» (3 palabras) va antes que «Alacena blanco» (2).
   */
  const partes = palabras.map((w) => {
    const sub = `${texto} LIKE ${ph(`%${escaparLike(w)}%`)}`
    // Las expresiones regulares sólo con letras y números: lo demás va como LIKE
    if (!/^[a-z0-9]+$/.test(w)) return { aparece: sub, puntaje: `(CASE WHEN ${sub} THEN 1 ELSE 0 END)` }
    const abrev: string[] = []
    for (let n = w.length - 1; n >= 3; n--) abrev.push(w.slice(0, n))
    // Expresiones de Postgres: \m = comienzo de palabra, \M = fin de palabra
    const entera = `\\m(?:${w}|${w}s|${w}es)\\M` + (abrev.length ? `|\\m(?:${abrev.join("|")})\\.` : "")
    const phEntera = ph(entera)
    const phInicio = ph(`\\m${w}`)
    const rxEntera = `${texto} ~ ${phEntera}`
    const rxInicio = `${texto} ~ ${phInicio}`
    return {
      aparece: `(${sub} OR ${rxEntera})`,
      puntaje: `(CASE WHEN ${rxEntera} THEN 3 WHEN ${rxInicio} THEN 2 WHEN ${sub} THEN 1 ELSE 0 END)`,
    }
  })
  const algunaPalabra = partes.length ? partes.map((x) => x.aparece).join(" OR ") : `${texto} LIKE ${phFrase}`
  const cuantas = partes.length ? partes.map((x) => `(CASE WHEN ${x.aparece} THEN 1 ELSE 0 END)`).join(" + ") : "0"
  const puntaje = partes.length ? partes.map((x) => x.puntaje).join(" + ") : "0"

  // Criterios de orden, de más a menos importante, todos DESC. `rangos` sirve
  // cuando la consulta necesita seleccionarlos como columnas (DISTINCT ON)
  const rangos = [
    `(${p}.ean = ${phEan})::int`,
    `(${texto} LIKE ${phFrase})::int`,
    `(${cuantas})`,
    `(${puntaje})`,
  ]
  return {
    where: `(${algunaPalabra} OR ${porEan})`,
    orden: rangos.map((r) => `${r} DESC`).join(", "),
    rangos,
  }
}
```

Cómo se usa:

```ts
const params: any[] = []
const conditions: string[] = [/* sus condiciones */]
let orden = ""
const b = q ? busquedaProductos(q, (v) => { params.push(v); return `$${params.length}` }) : null
if (b) { conditions.push(b.where); orden = b.orden + ", " }

const sql = `SELECT … FROM producto p … WHERE ${conditions.join(" AND ")}
             ORDER BY ${orden}p.nombre ASC LIMIT … OFFSET …`
```

Si la consulta usa `DISTINCT ON (p.id)` (Postgres obliga a que el primer
`ORDER BY` sea `p.id`), seleccionen `b.rangos` como columnas en la subconsulta
(`${r} AS _rango0`, …) y ordenen afuera por `_rango0 DESC, _rango1 DESC, …`.

## Cuidados

- **Las expresiones regulares sólo se arman con palabras de letras y números.**
  Lo demás («7up», «c/sal») va como `LIKE` escapado. Todo viaja como parámetro,
  nunca concatenado en el SQL.
- **Rendimiento:** con unos 70.000 productos responde bien sin índices nuevos,
  porque se filtra primero por comercio o mayorista. Si en algún momento hace
  falta, el siguiente paso es `pg_trgm` con un índice GIN sobre la expresión
  normalizada.
- **El catálogo maestro ya tiene mejores nombres.** El 30/10 cambiamos 4.993
  nombres abreviados por el nombre completo («Jab. liq. ala 12x800ml» →
  «Jabón líquido Ala Matic máxima remoción 800 ml»). Les llegan por
  `/api/v1/fichas`, porque el cambio de nombre mueve `ficha_actualizada_at`.
  Igual conviene la regla de abreviaturas para los productos que los
  comerciantes cargan a mano en el POS.

Si quieren, revisamos juntos su consulta actual.

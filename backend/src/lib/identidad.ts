/**
 * Normalizar teléfono y documento para encontrar la misma persona cargada dos
 * veces.
 *
 * El caso que originó esto son dos fichas reales del mismo señor en el mismo
 * comercio:
 *
 *     documento 2698535        teléfono 0351155630140    saldo $850,00
 *     documento 26098535       teléfono 3515630140       saldo $27.519,20
 *
 * Y lo que enseñó, que era al revés de lo esperable: **el documento no los
 * junta**. Tiene un dígito comido en el medio, así que no son iguales ni uno es
 * prefijo del otro, y ninguna comparación razonable los va a cruzar. El teléfono
 * sí, apenas se le saca el 0, el 15 y los separadores.
 *
 * Por eso el teléfono manda y el documento queda de refuerzo.
 */

/**
 * Un teléfono argentino a sus diez dígitos: área + abonado, sin 0 y sin 15.
 *
 * El 15 va pegado al código de área, que tiene 2, 3 o 4 dígitos según la
 * ciudad, así que no se puede sacar buscando "15" en cualquier lado: en
 * 3515630140 hay un "15" en el medio que es parte del número y sacarlo daría
 * 35630140, que es otro teléfono. Se prueba en las tres posiciones posibles y
 * se acepta sólo si lo que queda mide diez.
 */
export function telefonoNormalizado(valor: string | null | undefined): string | null {
  let d = (valor ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return d;
  for (const corte of [2, 3, 4]) {
    if (d.slice(corte, corte + 2) === "15") {
      const cand = d.slice(0, corte) + d.slice(corte + 2);
      if (cand.length === 10) return cand;
    }
  }
  // Los que no llegan a diez dígitos se devuelven como están: un fijo viejo sin
  // área sigue sirviendo para cruzar contra otro igual.
  return d.length >= 6 ? d : null;
}

/** Sólo los dígitos. "26.098.535" y "26098535" son el mismo documento. */
export function documentoNormalizado(valor: string | null | undefined): string | null {
  const d = (valor ?? "").replace(/\D/g, "");
  return d.length >= 6 ? d : null;
}

export interface FichaComparable {
  id: number;
  name: string;
  doc_number: string | null;
  phone: string | null;
}

/**
 * Agrupa las fichas que parecen la misma persona.
 *
 * Devuelve sólo los grupos de dos o más, y dice por qué cayeron juntas: al
 * comerciante que va a decidir si son la misma le importa más "tienen el mismo
 * teléfono" que la lista pelada.
 */
export function gruposDuplicados(
  fichas: FichaComparable[]
): { motivo: "telefono" | "documento"; clave: string; fichas: FichaComparable[] }[] {
  const porTelefono = new Map<string, FichaComparable[]>();
  const porDocumento = new Map<string, FichaComparable[]>();

  for (const f of fichas) {
    const tel = telefonoNormalizado(f.phone);
    if (tel) porTelefono.set(tel, [...(porTelefono.get(tel) ?? []), f]);
    const doc = documentoNormalizado(f.doc_number);
    if (doc) porDocumento.set(doc, [...(porDocumento.get(doc) ?? []), f]);
  }

  const grupos: { motivo: "telefono" | "documento"; clave: string; fichas: FichaComparable[] }[] = [];
  const yaAgrupadas = new Set<string>();

  const agregar = (motivo: "telefono" | "documento", mapa: Map<string, FichaComparable[]>) => {
    for (const [clave, lista] of mapa) {
      if (lista.length < 2) continue;
      // Si el mismo conjunto ya salió por teléfono, no se repite por documento:
      // es el mismo hallazgo contado dos veces.
      const firma = lista.map((f) => f.id).sort((a, b) => a - b).join("-");
      if (yaAgrupadas.has(firma)) continue;
      yaAgrupadas.add(firma);
      grupos.push({ motivo, clave, fichas: lista });
    }
  };

  agregar("telefono", porTelefono);
  agregar("documento", porDocumento);
  return grupos;
}

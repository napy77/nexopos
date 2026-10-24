/**
 * Leer el CSV que arma un comerciante, que casi siempre sale de Excel.
 *
 * Tres cosas de Excel en castellano que rompen un lector ingenuo:
 *
 * - **Separa con punto y coma**, porque la coma es el decimal. Se detecta
 *   mirando el encabezado.
 * - **Guarda en Windows-1252**, no en UTF-8: "Limón" llega como "Lim�n".
 *   Se intenta UTF-8 estricto y, si falla, se lee como Windows-1252.
 * - **Los encabezados vienen como los escribió cada uno**: "Precio Venta",
 *   "PRECIO", "precio_venta". Se normalizan y se aceptan sinónimos.
 *
 * Los números NO se interpretan acá: viajan como texto y los lee el backend
 * (`numeroAR` en modules/importacion.ts), para que el CSV y la API del ERP
 * los entiendan de una sola manera.
 */

export type Campo = "ean" | "nombre" | "precio" | "costo" | "stock" | "stock_minimo" | "unidad";

const SINONIMOS: Record<Campo, string[]> = {
  ean: ["ean", "codigo", "codigo_barras", "cod_barras", "codigo_de_barras", "barcode", "gtin"],
  nombre: ["nombre", "producto", "descripcion", "articulo", "detalle"],
  precio: ["precio", "precio_venta", "precio_de_venta", "pvp", "precio_final", "venta"],
  costo: ["costo", "precio_costo", "costo_unitario", "precio_de_costo", "compra"],
  stock: ["stock", "cantidad", "existencia", "existencias", "unidades"],
  stock_minimo: ["stock_minimo", "minimo", "cantidad_minima", "stock_min"],
  unidad: ["unidad", "unidad_base", "presentacion"],
};

/** "Precio Venta" → "precio_venta"; "Código" → "codigo" */
const normalizarEncabezado = (h: string): string =>
  h.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function decodificar(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** Renglones y celdas, respetando comillas ("Vino, tinto" es una celda) */
function partir(texto: string, sep: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else celda += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) { fila.push(celda); celda = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda); celda = "";
      if (fila.some((x) => x.trim() !== "")) filas.push(fila);
      fila = [];
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some((x) => x.trim() !== "")) filas.push(fila);
  return filas;
}

export interface CsvLeido {
  filas: Partial<Record<Campo, string>>[];
  /** Qué columna del archivo se tomó para cada campo */
  columnas: Partial<Record<Campo, string>>;
  /** Columnas del archivo que no se reconocieron: se ignoran, pero se avisan */
  ignoradas: string[];
  problema?: string;
}

export function leerCsv(texto: string): CsvLeido {
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", ",", "\t"].sort(
    (a, b) => primera.split(b).length - primera.split(a).length
  )[0];
  const renglones = partir(texto, sep);
  if (renglones.length < 2) {
    return { filas: [], columnas: {}, ignoradas: [], problema: "El archivo no tiene productos: hace falta el encabezado y al menos un renglón." };
  }

  const encabezado = renglones[0].map((h) => h.trim());
  const columnas: Partial<Record<Campo, string>> = {};
  const indice: Partial<Record<Campo, number>> = {};
  const ignoradas: string[] = [];
  encabezado.forEach((h, i) => {
    const n = normalizarEncabezado(h);
    const campo = (Object.keys(SINONIMOS) as Campo[]).find((c) => SINONIMOS[c].includes(n));
    if (campo && indice[campo] === undefined) { indice[campo] = i; columnas[campo] = h; }
    else if (h) ignoradas.push(h);
  });

  if (indice.ean === undefined && indice.nombre === undefined) {
    return { filas: [], columnas, ignoradas, problema:
      "No encontramos la columna del EAN ni la del nombre. La primera fila tiene que ser el encabezado: ean;nombre;precio;costo;stock;stock_minimo" };
  }

  const filas = renglones.slice(1).map((r) => {
    const f: Partial<Record<Campo, string>> = {};
    for (const [campo, i] of Object.entries(indice) as [Campo, number][]) {
      f[campo] = (r[i] ?? "").trim();
    }
    return f;
  });
  return { filas, columnas, ignoradas };
}

/** El archivo de ejemplo. Con punto y coma y BOM, para que Excel lo abra bien de una. */
export const CSV_EJEMPLO =
  "﻿ean;nombre;precio;costo;stock;stock_minimo\n" +
  "7790070507341;Jugo de Limón Minerva Pet x 500 Cc;3999;1999,50;12;2\n" +
  "7792900000138;Sal Fina Dos Anclas Estuche x 500 Grs;10.000;4999;6;1\n" +
  ";Tarta de verdura;5500;;4;\n";

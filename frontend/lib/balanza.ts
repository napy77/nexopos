"use client";

/**
 * Lectura de etiquetas de balanza.
 *
 * Una balanza etiquetadora imprime un EAN-13 que lleva adentro el código del
 * producto y el peso pesado (o el importe ya calculado):
 *
 *     2 0 | 0 1 2 3 4 | 0 1 5 0 0 | 7
 *     pref   código      valor       verificador
 *
 * → producto 01234, 1500 g = 1,5 kg
 *
 * El prefijo 20-29 lo reserva GS1 para uso interno del comercio, así que
 * nunca choca con un EAN de fábrica. La estructura exacta varía entre marcas
 * de balanza, por eso todo es configurable.
 */

export interface BalanzaConfig {
  habilitado: boolean;
  prefijos: string[];
  contenido: "peso" | "precio";
  digitosCodigo: number;
  digitosValor: number;
  divisor: number;
}

export const BALANZA_DEFAULT: BalanzaConfig = {
  habilitado: false,
  prefijos: ["20"],
  contenido: "peso",
  digitosCodigo: 5,
  digitosValor: 5,
  divisor: 1000,
};

export interface LecturaBalanza {
  plu: string;
  /** kg pesados, cuando la etiqueta trae peso */
  peso?: number;
  /** importe total en pesos, cuando la etiqueta trae precio */
  importe?: number;
}

/**
 * Interpreta un código escaneado. Devuelve null si no es una etiqueta de
 * balanza (entonces el código se trata como un EAN común).
 */
export function leerCodigoBalanza(codigo: string, config: BalanzaConfig): LecturaBalanza | null {
  if (!config.habilitado) return null;
  const limpio = codigo.trim();
  if (!/^\d{12,13}$/.test(limpio)) return null;

  const prefijo = config.prefijos.find((p) => limpio.startsWith(p));
  if (!prefijo) return null;

  const cuerpo = limpio.slice(prefijo.length);
  const { digitosCodigo, digitosValor } = config;
  // El último dígito del EAN-13 es el verificador y no forma parte del dato
  if (cuerpo.length < digitosCodigo + digitosValor) return null;

  const plu = cuerpo.slice(0, digitosCodigo);
  const valorCrudo = cuerpo.slice(digitosCodigo, digitosCodigo + digitosValor);
  const valor = Number(valorCrudo) / config.divisor;
  if (!Number.isFinite(valor) || valor <= 0) return null;

  return config.contenido === "peso" ? { plu, peso: valor } : { plu, importe: valor };
}

/**
 * Busca el producto del stock que corresponde a un PLU. Acepta el PLU con o
 * sin ceros a la izquierda: la balanza rellena a ancho fijo (00123) pero el
 * comercio suele cargarlo como 123.
 */
export function buscarPorPlu<T extends { plu?: string | null }>(items: T[], plu: string): T | undefined {
  const normalizar = (v: string) => v.replace(/^0+/, "") || "0";
  const objetivo = normalizar(plu);
  return items.find((i) => i.plu && normalizar(i.plu) === objetivo);
}

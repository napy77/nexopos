/**
 * Fechas sin hora, en Argentina.
 *
 * Un cierre "del 10" es una fecha sin hora. Si se calcula con el huso del
 * servidor, el día 10 argentino arranca a las 21 del 9 y el resumen se corre un
 * día entero. Por eso acá todo se resuelve sobre strings `YYYY-MM-DD` y la zona
 * está escrita, no heredada.
 */

export const ZONA = "America/Argentina/Cordoba";

/** Hoy en Argentina, como YYYY-MM-DD */
export function hoy(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: ZONA });
}

/** Parte una fecha YYYY-MM-DD sin pasar por Date, que la correría de huso */
export function partes(fecha: string): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return { anio, mes, dia };
}

export const aFecha = (anio: number, mes: number, dia: number): string =>
  `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

/** Días que tiene ese mes (mes 1-12) */
export const diasDelMes = (anio: number, mes: number): number =>
  new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * El día `dia` de ese mes, recortado al último día si no existe.
 *
 * Un comercio que cierra el 31 cierra el 28 en febrero. Si no se recorta, la
 * fecha se desborda al mes siguiente y el período dura dos meses.
 */
export const diaDelMes = (anio: number, mes: number, dia: number): string =>
  aFecha(anio, mes, Math.min(dia, diasDelMes(anio, mes)));

/** Mueve un mes hacia adelante o atrás, sin tocar el día */
export function correrMes(anio: number, mes: number, cuantos: number): { anio: number; mes: number } {
  const total = anio * 12 + (mes - 1) + cuantos;
  return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
}

export const sumarDias = (fecha: string, dias: number): string => {
  const { anio, mes, dia } = partes(fecha);
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
               "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * Cómo se llama el período en la pantalla.
 *
 * Si arranca el día 1 es un mes calendario y se lo llama por su nombre, que es
 * como habla el almacenero: "el resumen de agosto". Si el comercio cierra el 10,
 * el período no es ningún mes y ponerle uno sería mentir: ahí va el rango.
 */
export function etiquetaPeriodo(desde: string, hasta: string): string {
  const d = partes(desde);
  const h = partes(hasta);
  if (d.dia === 1 && h.dia === diasDelMes(h.anio, h.mes) && d.mes === h.mes) {
    return `${MESES[d.mes - 1]} ${d.anio}`;
  }
  const dm = String(d.dia).padStart(2, "0");
  const hm = String(h.dia).padStart(2, "0");
  return `${dm}/${String(d.mes).padStart(2, "0")} al ${hm}/${String(h.mes).padStart(2, "0")}`;
}

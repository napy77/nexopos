/**
 * Base64 a mano: los tres transportes (red, BLE, clásico) aceptan base64, y
 * así no hace falta meter un polyfill de Buffer sólo para esto.
 */
const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function aBase64(bytes: number[] | Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ABC[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ABC[n & 63] : "=";
  }
  return out;
}

export function deBase64(b64: string): Uint8Array {
  const limpio = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((limpio.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < limpio.length; i += 4) {
    const n = (ABC.indexOf(limpio[i]) << 18) | (ABC.indexOf(limpio[i + 1]) << 12)
      | ((ABC.indexOf(limpio[i + 2]) & 63) << 6) | (ABC.indexOf(limpio[i + 3]) & 63);
    out[j++] = (n >> 16) & 255;
    if (limpio[i + 2] !== undefined) out[j++] = (n >> 8) & 255;
    if (limpio[i + 3] !== undefined) out[j++] = n & 255;
  }
  return out.slice(0, j);
}

/*
 * Lo poco que la app imprime por su cuenta: la página de prueba y el QR de un
 * cobro, que vive unos minutos y ya está en la pantalla (lo mismo hace
 * `frontend/lib/print.ts`). El ticket y el cierre los arma el backend
 * (`backend/src/modules/ticket-escpos.ts`) y llegan hechos.
 *
 * Misma página de códigos que el backend: PC850.
 */
const PC850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, "¡": 0xad, "¿": 0xa8, "·": 0xfa,
};

const REEMPLAZOS: Record<string, string> = {
  "—": "-", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", " ": " ",
};

function texto(t: string): number[] {
  return [...t].flatMap((original) => [...(REEMPLAZOS[original] ?? original)]).map((ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c < 0x7f) return c;
    if (PC850[ch] !== undefined) return PC850[ch];
    // Sin el acento antes que como basura
    const base = ch.normalize("NFD").charCodeAt(0);
    return base >= 0x20 && base < 0x7f ? base : 0x3f;
  });
}

export class Documento {
  private b: number[] = [0x1b, 0x40, 0x1b, 0x74, 0x02];
  centro() { this.b.push(0x1b, 0x61, 1); return this; }
  izquierda() { this.b.push(0x1b, 0x61, 0); return this; }
  negrita(on: boolean) { this.b.push(0x1b, 0x45, on ? 1 : 0); return this; }
  grande(on: boolean) { this.b.push(0x1d, 0x21, on ? 0x11 : 0); return this; }
  linea(t = "") { this.b.push(...texto(t), 0x0a); return this; }
  separador(ancho: number) { return this.linea("-".repeat(ancho)); }
  /**
   * QR con el comando de la impresora (GS ( k, modelo 2): sale nítido en
   * cualquier térmica y no hay que mandar una imagen.
   */
  qr(contenido: string, modulo = 6) {
    const datos = texto(contenido);
    const largo = datos.length + 3;
    this.b.push(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00); // modelo 2
    this.b.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, modulo);     // tamaño del módulo
    this.b.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);       // corrección M
    this.b.push(0x1d, 0x28, 0x6b, largo & 0xff, largo >> 8, 0x31, 0x50, 0x30, ...datos);
    this.b.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);       // imprimir
    return this.linea();
  }
  cortar() { this.b.push(0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00); return aBase64(this.b); }
}

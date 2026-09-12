"use client";

/**
 * Achica la foto en el navegador antes de mandarla al servidor.
 *
 * Las fotos de un celular pesan varios MB y en el POS se muestran en un
 * recuadro de ~150px, así que se recortan a cuadrado y se bajan a 400px:
 * quedan en torno a 30-50 KB, que es un tamaño razonable para guardar
 * junto al producto y para que la grilla cargue rápido en el mostrador.
 */
export const MAX_IMAGEN_BYTES = 300 * 1024;

export async function prepararImagen(file: File, lado = 400): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("El archivo no es una imagen");
  }

  const bitmap = await createImageBitmap(file);
  // Recorte cuadrado centrado: las cards del POS son cuadradas
  const corte = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - corte) / 2;
  const sy = (bitmap.height - corte) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(bitmap, sx, sy, corte, corte, 0, 0, lado, lado);
  bitmap.close();

  // Bajar calidad hasta entrar en el límite
  for (const calidad of [0.8, 0.65, 0.5, 0.35]) {
    const dataUrl = canvas.toDataURL("image/jpeg", calidad);
    if (dataUrl.length * 0.75 <= MAX_IMAGEN_BYTES) return dataUrl;
  }
  throw new Error("La imagen es demasiado pesada, probá con otra");
}

/**
 * El banner de la tienda: la foto ancha de arriba de todo.
 *
 * Se recorta apaisado y no cuadrado porque es lo que se ve: una foto de la
 * verdulería metida en un cuadradito no se entiende, y un logo estirado a lo
 * ancho queda deformado. Son dos imágenes distintas por eso, no por capricho.
 *
 * Va a 1200px de ancho: entra bien en una pantalla de escritorio y pesa poco
 * en el teléfono, que es donde la mayoría va a abrir la tienda.
 */
export const MAX_BANNER_BYTES = 500 * 1024;

export async function prepararBanner(file: File, ancho = 1200, alto = 400): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo no es una imagen");

  const bitmap = await createImageBitmap(file);
  // Recorte centrado al alto que corresponde: se queda con la franja del medio
  const ratio = ancho / alto;
  let cw = bitmap.width;
  let ch = cw / ratio;
  if (ch > bitmap.height) { ch = bitmap.height; cw = ch * ratio; }
  const sx = (bitmap.width - cw) / 2;
  const sy = (bitmap.height - ch) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(bitmap, sx, sy, cw, ch, 0, 0, ancho, alto);
  bitmap.close();

  for (const calidad of [0.82, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL("image/jpeg", calidad);
    if (dataUrl.length * 0.75 <= MAX_BANNER_BYTES) return dataUrl;
  }
  throw new Error("La imagen es demasiado pesada, probá con otra");
}

/**
 * Las fotos de la galería de un producto propio.
 *
 * Más grandes que la miniatura del POS —en la tienda se ven a pantalla casi
 * completa— y más livianas que una portada suelta, porque van hasta seis
 * juntas en el mismo request.
 *
 * Cuadradas como el resto: la tira de miniaturas y la ficha de la tienda las
 * muestran así, y recortarlas acá evita que una foto vertical del teléfono
 * aparezca con franjas a los costados.
 */
export const MAX_FOTO_GALERIA_BYTES = 200 * 1024;

export async function prepararFotoGaleria(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo no es una imagen");

  const bitmap = await createImageBitmap(file);
  const corte = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(bitmap, (bitmap.width - corte) / 2, (bitmap.height - corte) / 2,
    corte, corte, 0, 0, 900, 900);
  bitmap.close();

  for (const calidad of [0.8, 0.68, 0.55, 0.42, 0.3]) {
    const dataUrl = canvas.toDataURL("image/jpeg", calidad);
    if (dataUrl.length * 0.75 <= MAX_FOTO_GALERIA_BYTES) return dataUrl;
  }
  throw new Error("La foto es demasiado pesada, probá con otra");
}

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

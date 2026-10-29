import { AVATAR_MAX_BYTES } from "../domain/ownProfile";

export const AVATAR_SIDE = 768;

/** Recorta al centro en cuadrado, reduce a 768 px y re-codifica como JPEG con canvas. */
export function avatarJpeg(uri: string): Promise<string> {
  return squareJpeg(uri, AVATAR_SIDE, AVATAR_MAX_BYTES);
}

/** Reduce sin recortar (lado mayor ≤ maxSide) y re-codifica como JPEG con canvas: fotos de inspección. */
export async function scaledJpeg(uri: string, maxSide: number, maxBytes: number): Promise<string> {
  if (!/^(blob:|data:image\/(png|jpeg|webp);base64,)/.test(uri)) throw new Error("El formato de la foto no está permitido.");
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo leer la foto. Prueba con otra imagen."));
    image.src = uri;
  });
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longest) throw new Error("No se pudo leer la foto.");
  const scale = Math.min(1, maxSide / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la foto.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL("image/jpeg", 0.82);
  if (!result.startsWith("data:image/jpeg;base64,") || (result.length - 23) * 0.75 > maxBytes) throw new Error("La foto es demasiado grande. Prueba con otra imagen.");
  return result;
}

/** En el navegador la vista previa usa la misma imagen ya reducida. */
export async function scaledJpegWithPreview(uri: string, maxSide: number, maxBytes: number): Promise<{ dataUri: string; previewUri: string }> {
  const dataUri = await scaledJpeg(uri, maxSide, maxBytes);
  return { dataUri, previewUri: dataUri };
}

/** Igual que la foto de perfil, con el lado y el peso máximo indicados (por ejemplo, la foto del equipo en el taller). */
export async function squareJpeg(uri: string, maxSide: number, maxBytes: number): Promise<string> {
  if (!/^(blob:|data:image\/(png|jpeg|webp);base64,)/.test(uri)) throw new Error("El formato de la foto no está permitido.");
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo leer la foto. Prueba con otra imagen."));
    image.src = uri;
  });
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (!side) throw new Error("No se pudo leer la foto.");
  const target = Math.min(side, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la foto.");
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, target, target);
  const result = canvas.toDataURL("image/jpeg", 0.85);
  if (!result.startsWith("data:image/jpeg;base64,") || (result.length - 23) * 0.75 > maxBytes) throw new Error("La foto es demasiado grande. Prueba con otra imagen.");
  return result;
}

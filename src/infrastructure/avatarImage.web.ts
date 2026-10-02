import { AVATAR_MAX_BYTES } from "../domain/ownProfile";

export const AVATAR_SIDE = 768;

/** Recorta al centro en cuadrado, reduce a 768 px y re-codifica como JPEG con canvas. */
export async function avatarJpeg(uri: string): Promise<string> {
  if (!/^(blob:|data:image\/(png|jpeg|webp);base64,)/.test(uri)) throw new Error("El formato de la foto no está permitido.");
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo leer la foto. Prueba con otra imagen."));
    image.src = uri;
  });
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (!side) throw new Error("No se pudo leer la foto.");
  const target = Math.min(side, AVATAR_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la foto.");
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, target, target);
  const result = canvas.toDataURL("image/jpeg", 0.85);
  if (!result.startsWith("data:image/jpeg;base64,") || (result.length - 23) * 0.75 > AVATAR_MAX_BYTES) throw new Error("La foto es demasiado grande. Prueba con otra imagen.");
  return result;
}

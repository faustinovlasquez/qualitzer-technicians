import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { AVATAR_MAX_BYTES } from "../domain/ownProfile";

export const AVATAR_SIDE = 768;

/** Recorta al centro en cuadrado, reduce a 768 px y re-codifica como JPEG (sin EXIF ni GPS). */
export function avatarJpeg(uri: string): Promise<string> {
  return squareJpeg(uri, AVATAR_SIDE, AVATAR_MAX_BYTES);
}

/** Reduce sin recortar (lado mayor ≤ maxSide) y re-codifica como JPEG sin EXIF: fotos de inspección. */
export async function scaledJpeg(uri: string, maxSide: number, maxBytes: number): Promise<string> {
  return (await scaledJpegFile(uri, maxSide, maxBytes, false)).dataUri;
}

/**
 * Igual que `scaledJpeg` y además deja el JPEG reducido en un archivo para la vista previa: la foto original de la
 * cámara (50 MP o más) no se alcanza a dibujar en algunos Android y el recuadro queda gris (foto del equipo del ingreso).
 */
export async function scaledJpegWithPreview(uri: string, maxSide: number, maxBytes: number): Promise<{ dataUri: string; previewUri: string }> {
  const { dataUri, fileUri } = await scaledJpegFile(uri, maxSide, maxBytes, true);
  return { dataUri, previewUri: fileUri ?? dataUri };
}

async function scaledJpegFile(uri: string, maxSide: number, maxBytes: number, keepFile: boolean): Promise<{ dataUri: string; fileUri: string | null }> {
  if (!/^(file:\/\/|content:\/\/|ph:\/\/|data:image\/(png|jpeg|webp|heic);base64,)/.test(uri)) throw new Error("El formato de la foto no está permitido.");
  const context = ImageManipulator.manipulate(uri);
  let initial: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let temporary: string | undefined;
  try {
    initial = await context.renderAsync();
    const longest = Math.max(initial.width, initial.height);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error("No se pudo leer la foto.");
    if (longest > maxSide) context.resize(initial.width >= initial.height ? { width: maxSide } : { height: maxSide });
    rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
    temporary = result.uri;
    const encoded = result.base64 ?? "";
    if (!encoded || encoded.length * 0.75 > maxBytes) throw new Error("La foto es demasiado grande. Prueba con otra imagen.");
    const fileUri = keepFile ? result.uri : null;
    // El archivo queda en la caché para la vista previa (el sistema la limpia).
    if (keepFile) temporary = undefined;
    return { dataUri: `data:image/jpeg;base64,${encoded}`, fileUri };
  } finally {
    rendered?.release(); initial?.release(); context.release();
    if (temporary) { try { const file = new File(temporary); if (file.exists) file.delete(); } catch {} }
  }
}

/** Igual que la foto de perfil, con el lado y el peso máximo indicados (por ejemplo, la foto del equipo en el taller). */
export async function squareJpeg(uri: string, maxSide: number, maxBytes: number): Promise<string> {
  if (!/^(file:\/\/|content:\/\/|ph:\/\/|data:image\/(png|jpeg|webp|heic);base64,)/.test(uri)) throw new Error("El formato de la foto no está permitido.");
  const context = ImageManipulator.manipulate(uri);
  let initial: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let temporary: string | undefined;
  try {
    initial = await context.renderAsync();
    const side = Math.min(initial.width, initial.height);
    if (!Number.isFinite(side) || side <= 0) throw new Error("No se pudo leer la foto.");
    context.crop({ originX: Math.floor((initial.width - side) / 2), originY: Math.floor((initial.height - side) / 2), width: side, height: side });
    if (side > maxSide) context.resize({ width: maxSide, height: maxSide });
    rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    temporary = result.uri;
    const encoded = result.base64 ?? "";
    if (!encoded || encoded.length * 0.75 > maxBytes) throw new Error("La foto es demasiado grande. Prueba con otra imagen.");
    return `data:image/jpeg;base64,${encoded}`;
  } finally {
    rendered?.release(); initial?.release(); context.release();
    if (temporary) { try { const file = new File(temporary); if (file.exists) file.delete(); } catch {} }
  }
}

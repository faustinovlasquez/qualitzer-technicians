import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { requireSignaturePng, SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from "../screens/orders/lifecycle/signatureGeometry";

export async function signatureImagePng(uri: string): Promise<string> {
  if (!uri || uri.length > 8 * 1024 * 1024) throw new Error("La imagen de firma no esta disponible o es demasiado grande.");
  if (uri.startsWith("data:image/png;base64,")) {
    try { return requireSignaturePng(uri); } catch {}
  }
  if (!/^(data:image\/(png|jpeg|webp);base64,|https:\/\/|file:\/\/|content:\/\/|blob:)/.test(uri)) throw new Error("El formato de la imagen de firma no esta permitido.");
  const context = ImageManipulator.manipulate(uri);
  let initial: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let temporary: string | undefined;
  try {
    initial = await context.renderAsync();
    const scale = Math.min(1, SIGNATURE_WIDTH / initial.width, SIGNATURE_HEIGHT / initial.height);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("No se pudo leer la imagen de firma.");
    if (scale < 1) context.resize({ width: Math.max(1, Math.round(initial.width * scale)), height: Math.max(1, Math.round(initial.height * scale)) });
    rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
    temporary = result.uri;
    return requireSignaturePng(`data:image/png;base64,${result.base64 ?? ""}`);
  } finally {
    rendered?.release(); initial?.release(); context.release();
    if (temporary) { try { const file = new File(temporary); if (file.exists) file.delete(); } catch {} }
  }
}
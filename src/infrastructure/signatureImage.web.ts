import { requireSignaturePng, SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from "../screens/orders/lifecycle/signatureGeometry";

export async function signatureImagePng(uri: string): Promise<string> {
  if (!uri || uri.length > 8 * 1024 * 1024) throw new Error("La imagen de firma no esta disponible o es demasiado grande.");
  if (uri.startsWith("data:image/png;base64,")) {
    try { return requireSignaturePng(uri); } catch {}
  }
  if (!/^(data:image\/(png|jpeg|webp);base64,|https:\/\/|blob:)/.test(uri)) throw new Error("El formato de la imagen de firma no esta permitido.");
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo cargar la imagen de firma. Revisa la conexion o carga una nueva imagen."));
    image.src = uri;
  });
  const scale = Math.min(1, SIGNATURE_WIDTH / image.naturalWidth, SIGNATURE_HEIGHT / image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la imagen de firma.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return requireSignaturePng(canvas.toDataURL("image/png"));
}
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Descarga un .zip del conector al teléfono y abre el menú del sistema para guardarlo o enviarlo (Archivos, WhatsApp, correo…). */
export async function saveAndShareZip(url: string, headers: Record<string, string>, name: string): Promise<void> {
  const target = new File(Paths.cache, name);
  if (target.exists) target.delete();
  let file: File;
  try { file = await File.downloadFileAsync(url, target, { headers }); }
  catch { throw new Error("No se pudo descargar el comprimido. Revisa tu conexión e inténtalo de nuevo."); }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Este teléfono no permite compartir archivos desde la app.");
  await Sharing.shareAsync(file.uri, { mimeType: "application/zip", dialogTitle: "Guardar o enviar las fotos", UTI: "public.zip-archive" });
}

import * as DocumentPicker from "expo-document-picker";
import { pickPhotos } from "../localPhotos";
import { DOCUMENT_MIME_TYPES, MAX_FILES, type FileSource, type SelectedFile } from "./fileRules";
import type { TrustedNativePicker } from "../../../security/contracts";

export async function pickWorkspaceFiles(source: FileSource, remaining: number, runNativePicker: TrustedNativePicker = operation => operation(), isInteractionAllowed: () => boolean = () => true): Promise<SelectedFile[]> {
  if (remaining <= 0) throw new Error(`Puedes preparar hasta ${MAX_FILES} archivos por destino. Guarda los pendientes antes de añadir más.`);
  if (source === "camera" || source === "library") {
    const result = await pickPhotos(source, remaining, runNativePicker, isInteractionAllowed);
    return result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? asset.file?.name ?? "foto", mimeType: asset.mimeType, size: asset.fileSize, blob: asset.file }));
  }
  const result = await runNativePicker(() => DocumentPicker.getDocumentAsync({ type: source === "pdf" ? "application/pdf" : DOCUMENT_MIME_TYPES, copyToCacheDirectory: true, multiple: true, base64: false }));
  return result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size, blob: asset.file }));
}
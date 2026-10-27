import { Platform, Share } from "react-native";
import * as Sharing from "expo-sharing";
import type { OfflineOperation } from "../domain/offline";

/** Texto legible de lo guardado en una operación, para respaldarlo antes de descartarla. */
export function operationBackupText(operation: OfflineOperation, title: string): string {
  const when = new Date(operation.createdAt).toLocaleString("es-CL");
  const detail = operation.kind === "comment" ? operation.text
    : operation.kind === "create" ? JSON.stringify(operation.input, null, 2)
      : operation.kind === "document" ? `Archivo: ${operation.file.name}${operation.reportText ? `\n${operation.reportText}` : ""}`
        : operation.kind === "answer" ? `Paso ${operation.stepId}: ${JSON.stringify(operation.answer)}`
          : JSON.stringify(operation.payload, null, 2);
  return `Respaldo Qualitzer · ${title}\n${when}\n\n${detail}`;
}

/**
 * Comparte el respaldo con las apps del teléfono (WhatsApp, correo, Drive…): el archivo si lo tiene, o el texto.
 * Devuelve false si el teléfono no permite compartir.
 */
export async function shareOperationBackup(operation: OfflineOperation, title: string, fileUri?: string): Promise<boolean> {
  if (fileUri && Platform.OS !== "web" && await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { dialogTitle: title, mimeType: operation.kind === "document" ? operation.file.mimeType : undefined });
    return true;
  }
  const message = operationBackupText(operation, title);
  if (Platform.OS === "web") {
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;
    if (!clipboard) return false;
    await clipboard.writeText(message);
    return true;
  }
  await Share.share({ message, title });
  return true;
}

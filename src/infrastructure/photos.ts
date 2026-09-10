import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import type { LocalPhoto } from "../domain/models";
import { OfflineUnavailableError } from "../domain/offline";

export async function appendPhoto(form: FormData, photo: LocalPhoto): Promise<void> {
  if (Platform.OS === "web") {
    const response = await fetch(photo.uri);
    if (!response.ok) throw new Error("La foto seleccionada ya no está disponible. Vuelve a seleccionarla.");
    form.append("files", await response.blob(), photo.name);
  } else {
    try {
      const file = new File(photo.uri);
      Object.defineProperties(file, {
        name: { value: photo.name },
        type: { value: photo.mimeType },
      });
      form.append("files", file);
    } catch {
      throw new OfflineUnavailableError("OFFLINE_DOCUMENT_MULTIPART_PREPARATION_FAILED");
    }
  }
}
export const uploadFetch = Platform.OS === "web" ? fetch : expoFetch;

export async function photoDataUri(photo: LocalPhoto): Promise<string> {
  if (/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/]*={0,2}$/i.test(photo.uri)) return photo.uri;
  if (Platform.OS !== "web") return `data:${photo.mimeType};base64,${await new File(photo.uri).base64()}`;
  const blob = await (await fetch(photo.uri)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("No se pudo leer la foto."));
    reader.onerror = () => reject(new Error("No se pudo leer la foto."));
    reader.readAsDataURL(blob);
  });
}

export async function photoSnapshot(photo: LocalPhoto): Promise<{ bytes: Uint8Array; uri: string }> {
  const uri = await photoDataUri(photo);
  const encoded = uri.slice(uri.indexOf(",") + 1);
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return { bytes, uri };
}
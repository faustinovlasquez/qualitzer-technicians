import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import type { LocalPhoto } from "../../domain/models";
import { errorMessage } from "./detailRules";
import type { TrustedNativePicker } from "../../security/contracts";
import { CameraPermissionError, NativeCameraUnavailableError, NativeSelectionError } from "../../domain/cameraErrors";

export const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const activeCopies = new Map<string, Set<Promise<LocalPhoto[]>>>();
const closedScopes = new Set<string>();

export function openLocalPhotoScope(storageKey: string): void {
  closedScopes.delete(storageKey);
}

function photoDirectory(storageKey: string): Directory {
  return new Directory(Paths.document, "qualitzer-work-detail", `session-${encodeURIComponent(storageKey)}`);
}

export function deleteLocalPhoto(storageKey: string, photo: LocalPhoto): void {
  if (Platform.OS === "web") return;
  const directory = photoDirectory(storageKey);
  const file = new File(photo.uri);
  if (file.parentDirectory.uri.replace(/\/$/, "") !== directory.uri.replace(/\/$/, "")) throw new Error("La foto no pertenece a los borradores de esta sesión.");
  if (file.exists) file.delete();
}

export async function deleteLocalPhotoDirectory(storageKey: string): Promise<void> {
  closedScopes.add(storageKey);
  await Promise.allSettled([...(activeCopies.get(storageKey) ?? [])]);
  if (Platform.OS === "web") return;
  const directory = photoDirectory(storageKey);
  if (directory.exists) directory.delete();
}

export async function pickPhotos(source: "camera" | "library", remaining: number, runNativePicker: TrustedNativePicker = operation => operation(), isInteractionAllowed: () => boolean = () => true): Promise<ImagePicker.ImagePickerResult> {
  if (remaining <= 0) throw new Error("Puedes tener hasta 4 fotos pendientes por trabajo.");
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, allowsEditing: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current };
  if (source === "camera") {
    if (Platform.OS !== "web") {
      let permission: ImagePicker.CameraPermissionResponse;
      try {
        permission = await ImagePicker.getCameraPermissionsAsync();
        if (!isInteractionAllowed()) throw new NativeSelectionError();
        if (!permission.granted && permission.canAskAgain) permission = await runNativePicker(() => ImagePicker.requestCameraPermissionsAsync());
      } catch { throw new NativeSelectionError(); }
      if (!isInteractionAllowed()) throw new NativeSelectionError();
      if (!permission.granted) throw new CameraPermissionError(permission.canAskAgain);
    }
    try { return await runNativePicker(() => ImagePicker.launchCameraAsync(options)); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error.code === "ERR_MISSING_ACTIVITY_TO_HANDLE_INTENT" || error.code === "ERR_CAMERA_UNAVAILABLE")) throw new NativeCameraUnavailableError();
      throw new NativeSelectionError();
    }
  }
  try { return await runNativePicker(() => ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: remaining })); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("TRUSTED_NATIVE_")) throw new NativeSelectionError();
    throw new Error(`No se pudo abrir la galería. Revisa los permisos de fotos del dispositivo o vuelve a abrir el selector. ${errorMessage(error)}`);
  }
}

function assetMetadata(asset: ImagePicker.ImagePickerAsset): { size: number; mimeType: string; name: string } {
  const nativeFile = Platform.OS === "web" ? null : new File(asset.uri);
  const size = Platform.OS === "web" ? asset.file?.size ?? asset.fileSize : nativeFile?.size;
  const name = asset.fileName ?? asset.file?.name ?? nativeFile?.name ?? "foto";
  const extension = name.split(".").pop()?.toLowerCase();
  const extensions: { [key: string]: string } = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };
  const detectedMime = asset.mimeType ?? asset.file?.type ?? nativeFile?.type;
  const mimeType = detectedMime?.trim() ? detectedMime.toLowerCase() : extensions[extension ?? ""] ?? "";
  if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(mimeType)) throw new Error("Formato no admitido. Selecciona JPEG, PNG, WebP o HEIC; no se convierten ni comprimen las fotos.");
  if (size === undefined || !Number.isFinite(size) || size <= 0) throw new Error("No se pudo verificar el tamaño de una foto. Vuelve a seleccionarla.");
  if (size > MAX_PHOTO_BYTES) throw new Error("Cada foto debe pesar como máximo 25 MB (25 MiB).");
  return { size, mimeType, name };
}

async function copyPhotos(storageKey: string, assets: ImagePicker.ImagePickerAsset[], existing: LocalPhoto[]): Promise<LocalPhoto[]> {
  if (existing.length + assets.length > MAX_PHOTOS) throw new Error("El máximo es de 4 fotos pendientes en total, incluidos los pasos del checklist.");
  const metadata = assets.map(assetMetadata);
  if (existing.some((photo) => photo.size === undefined) || existing.reduce((sum, photo) => sum + (photo.size ?? 0), 0) + metadata.reduce((sum, photo) => sum + photo.size, 0) > MAX_TOTAL_BYTES) throw new Error("Las fotos pendientes no pueden superar 40 MB (40 MiB) en total.");
  const prepared: LocalPhoto[] = [];
  try {
    for (const [index, asset] of assets.entries()) {
      const info = metadata[index];
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${index}`;
      if (Platform.OS === "web") {
        prepared.push({ id, uri: asset.uri, ...info });
      } else {
        const directory = photoDirectory(storageKey);
        directory.create({ idempotent: true, intermediates: true });
        const extension = info.mimeType === "image/jpeg" ? "jpg" : info.mimeType.slice(6);
        const destination = new File(directory, `${id}.${extension}`);
        const photo: LocalPhoto = { id, uri: destination.uri, ...info };
        prepared.push(photo);
        await new File(asset.uri).copy(destination);
      }
    }
    return prepared;
  } catch (error) {
    for (const photo of prepared) deleteLocalPhoto(storageKey, photo);
    throw error;
  }
}

export function preparePhotos(storageKey: string, assets: ImagePicker.ImagePickerAsset[], existing: LocalPhoto[]): Promise<LocalPhoto[]> {
  if (closedScopes.has(storageKey)) return Promise.reject(new Error("La sesión de fotos está cerrada."));
  const tasks = activeCopies.get(storageKey) ?? new Set<Promise<LocalPhoto[]>>();
  activeCopies.set(storageKey, tasks);
  const operation = copyPhotos(storageKey, assets, existing);
  tasks.add(operation);
  const finished = (): void => { tasks.delete(operation); if (tasks.size === 0) activeCopies.delete(storageKey); };
  void operation.then(finished, finished);
  return operation;
}

export function validateLocalPhotos(storageKey: string, photos: LocalPhoto[]): void {
  if (photos.length === 0 || photos.length > MAX_PHOTOS) throw new Error("Selecciona entre 1 y 4 fotos para subir.");
  let total = 0;
  for (const photo of photos) {
    let size = photo.size;
    if (Platform.OS !== "web") {
      const file = new File(photo.uri);
      if (file.parentDirectory.uri.replace(/\/$/, "") !== photoDirectory(storageKey).uri.replace(/\/$/, "") || !file.exists) throw new Error("Una foto ya no está disponible en el borrador. Quítala y vuelve a seleccionarla.");
      size = file.size;
    }
    if (size === undefined || !Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) throw new Error("No se pudo validar el tamaño de una foto (máximo 25 MB por archivo).");
    total += size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("El envío supera el máximo de 40 MB en total.");
}
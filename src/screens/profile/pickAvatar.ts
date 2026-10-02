import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { CameraPermissionError, NativeCameraUnavailableError, NativeSelectionError } from "../../domain/cameraErrors";
import type { TrustedNativePicker } from "../../security/contracts";

export type AvatarSource = "camera" | "library";

/** Abre la camara frontal o la galeria con recorte cuadrado; devuelve la URI local o null si se cancela. */
export async function pickAvatar(source: AvatarSource, runNativePicker: TrustedNativePicker, isInteractionAllowed: () => boolean): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, allowsEditing: Platform.OS !== "web", aspect: [1, 1], allowsMultipleSelection: false, exif: false };
  let result: ImagePicker.ImagePickerResult;
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
    try { result = await runNativePicker(() => ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front })); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error.code === "ERR_MISSING_ACTIVITY_TO_HANDLE_INTENT" || error.code === "ERR_CAMERA_UNAVAILABLE")) throw new NativeCameraUnavailableError();
      throw new NativeSelectionError();
    }
  } else {
    try { result = await runNativePicker(() => ImagePicker.launchImageLibraryAsync(options)); }
    catch { throw new Error("No se pudo abrir la galería. Revisa los permisos de fotos del dispositivo."); }
  }
  if (!isInteractionAllowed() || result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri) return null;
  if (asset.fileSize !== undefined && asset.fileSize > 25 * 1024 * 1024) throw new Error("La foto debe pesar como máximo 25 MB.");
  return asset.uri;
}

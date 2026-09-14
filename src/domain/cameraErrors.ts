export class CameraPermissionError extends Error {
  readonly code = "CAMERA_PERMISSION_DENIED";

  constructor(readonly canAskAgain: boolean) {
    super("Permite el acceso a la cámara para tomar una foto. Tus borradores se conservan.");
    this.name = "CameraPermissionError";
  }
}

export class NativeCameraUnavailableError extends Error {
  readonly code = "NATIVE_CAMERA_UNAVAILABLE";

  constructor() {
    super("No hay una cámara disponible para tomar la foto. Puedes utilizar la galería.");
    this.name = "NativeCameraUnavailableError";
  }
}

export class NativeSelectionError extends Error {
  readonly code = "NATIVE_SELECTION_FAILED";

  constructor() {
    super("No se pudo completar la selección. Vuelve a intentarlo; tus borradores se conservan.");
    this.name = "NativeSelectionError";
  }
}
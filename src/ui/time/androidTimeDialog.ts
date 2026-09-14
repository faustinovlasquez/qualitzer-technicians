import type { AndroidNativeProps } from "@react-native-community/datetimepicker";
import { clockFromPickerDate, clockPickerDate } from "./timeValues";

export const TIME_PICKER_UNAVAILABLE = "No se pudo abrir el selector de hora. Vuelve a intentarlo; tu hora no ha cambiado.";
export const TIME_PICKER_BUSY = "Cierra el selector de hora anterior antes de abrir otro.";

interface AndroidTimePickerPort {
  open(props: AndroidNativeProps): void;
  dismiss(mode: "time"): Promise<boolean>;
}

interface AndroidTimeRequest {
  value: string;
  isCurrent(): boolean;
  onConfirm(value: string): void;
  onCancel(): void;
  onError(message: string): void;
}

export function createAndroidTimeDialog() {
  let owner: object | null = null;
  return function open(port: AndroidTimePickerPort, request: AndroidTimeRequest): () => void {
    if (!request.isCurrent()) return () => {};
    if (owner) { request.onError(TIME_PICKER_BUSY); return () => {}; }
    const lease = {};
    owner = lease;
    let closing = false;
    let dismissalFailed = false;
    let terminalResult = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => owner === lease && !closing && request.isCurrent();
    const release = () => { clearTimeout(timer); if (owner === lease) owner = null; };
    const settleNative = () => { terminalResult = true; if (!closing || dismissalFailed) release(); };
    const dismissFailed = () => { dismissalFailed = true; if (terminalResult) release(); };
    const cancel = () => {
      if (owner !== lease || closing) return;
      closing = true;
      clearTimeout(timer);
      try { void port.dismiss("time").then(release, dismissFailed); }
      catch { dismissFailed(); }
    };
    const fail = () => { const notify = current(); cancel(); if (notify) request.onError(TIME_PICKER_UNAVAILABLE); };
    timer = setTimeout(fail, 5 * 60 * 1000);
    try {
      port.open({
        value: clockPickerDate(request.value), mode: "time", display: "spinner", is24Hour: true, minuteInterval: 1,
        positiveButton: { label: "Confirmar" }, negativeButton: { label: "Cancelar" },
        onValueChange: (_event, date) => {
          if (closing) { settleNative(); return; }
          if (!current()) { cancel(); return; }
          const value = clockFromPickerDate(date);
          if (!value) { fail(); return; }
          release();
          request.onConfirm(value);
        },
        onDismiss: () => { const notify = current(); settleNative(); if (notify) request.onCancel(); },
        onError: () => { const notify = current(); settleNative(); if (notify) request.onError(TIME_PICKER_UNAVAILABLE); },
      });
    } catch { const notify = current(); release(); if (notify) request.onError(TIME_PICKER_UNAVAILABLE); }
    return cancel;
  };
}
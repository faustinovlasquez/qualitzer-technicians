import { useContext, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { CameraPermissionError } from "../../../domain/cameraErrors";
import { DeviceSecurityContext } from "../../../security/DeviceSecurityContext";

interface CameraPermissionActions {
  onRetry(isCurrent: () => boolean): Promise<void>;
  onGallery?: (isCurrent: () => boolean) => Promise<void>;
}

interface PermissionRequest {
  scope: symbol;
  error: CameraPermissionError;
  actions: CameraPermissionActions;
}

export interface CameraPermissionGuideState {
  visible: boolean;
  canAskAgain: boolean;
  busy: boolean;
  message: string | null;
  hasGallery: boolean;
  retry(): Promise<void>;
  openSettings(): Promise<void>;
  pickGallery(): Promise<void>;
  cancel(): void;
}

export interface CameraPermissionGuideController extends CameraPermissionGuideState {
  handleError(error: unknown, actions: CameraPermissionActions): boolean;
}

export function useCameraPermissionGuide(scopeKey: string, canInteract: () => boolean): CameraPermissionGuideController {
  const security = useContext(DeviceSecurityContext);
  const latest = useRef({ security, canInteract });
  latest.current = { security, canInteract };
  const scope = useRef({ key: scopeKey, identity: Symbol() });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey, identity: Symbol() };
  const identity = scope.current.identity;
  const mounted = useRef(false);
  const request = useRef<PermissionRequest | null>(null);
  const flight = useRef<symbol | null>(null);
  const [state, setState] = useState<PermissionRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current = null; flight.current = null; };
  }, []);

  useEffect(() => {
    request.current = null;
    flight.current = null;
    setState(null);
    setBusy(false);
    setMessage(null);
  }, [identity]);

  function allowed(): boolean {
    return mounted.current && scope.current.identity === identity && (latest.current.security?.isUnlocked() ?? true) && latest.current.canInteract();
  }

  function handleError(error: unknown, actions: CameraPermissionActions): boolean {
    if (!(error instanceof CameraPermissionError)) return false;
    if (!allowed()) return true;
    if (flight.current && request.current === null) return true;
    const next = { scope: identity, error, actions };
    request.current = next;
    setState(next);
    setMessage(null);
    return true;
  }

  function cancel(): void {
    if (!allowed()) return;
    request.current = null;
    setState(null);
    setMessage(null);
  }

  async function act(kind: "settings" | "retry" | "gallery"): Promise<void> {
    const current = request.current;
    if (!allowed() || !current || current.scope !== identity || flight.current || (kind === "settings" && current.error.canAskAgain)) return;
    const callback = kind === "gallery" ? current.actions.onGallery : current.actions.onRetry;
    if (kind !== "settings" && !callback) return;
    const token = Symbol();
    flight.current = token;
    setBusy(true);
    setMessage(null);
    try {
      if (kind === "settings") await Linking.openSettings();
      else await callback?.(() => allowed() && request.current === current && flight.current === token);
      if (allowed() && request.current === current && kind !== "settings") {
        request.current = null;
        setState(null);
      }
    } catch (error) {
      if (allowed() && request.current === current) {
        if (kind !== "settings" && handleError(error, current.actions)) return;
        setMessage(kind === "settings" ? "No se pudieron abrir los ajustes. Ábrelos desde el dispositivo y busca Qualitzer en Aplicaciones. Tus borradores se conservan." : "No se pudo completar la selección. Vuelve a intentarlo; tus borradores se conservan.");
      }
    } finally {
      if (flight.current === token) {
        flight.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  return {
    visible: state !== null && state.scope === identity && (security?.isUnlocked() ?? true),
    canAskAgain: state?.error.canAskAgain ?? true,
    hasGallery: state?.actions.onGallery !== undefined,
    busy,
    message,
    handleError,
    cancel,
    retry: () => act("retry"),
    openSettings: () => act("settings"),
    pickGallery: () => act("gallery"),
  };
}
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import nativeBranding from "../../modules/company-branding";
import { CompanyBrandingController } from "./CompanyBrandingController";
import type { CompanyBrandingInput, CompanyBrandingStatus, CompanyBrandingUi } from "./contracts";

const unavailableMessage = Platform.OS === "android"
  ? "Disponible en la APK que incluya el módulo de personalización; no en Expo Go."
  : "Los accesos de empresa están disponibles en la app Android.";

export function useCompanyBranding(input: CompanyBrandingInput, disabled: boolean, automaticPinEligible = false): CompanyBrandingUi {
  const [controller] = useState(() => nativeBranding ? new CompanyBrandingController(nativeBranding, (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value)) : null);
  const [status, setStatus] = useState<CompanyBrandingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(controller ? "Preparando personalización…" : unavailableMessage);
  const lifecycle = useRef(0);
  const pressLock = useRef(false);
  const confirmedRevision = useRef<number | null>(null);
  const stableInput = useMemo(() => ({
    session: input.session ? { mode: input.session.mode, tenant: {
      id: input.session.tenant.id,
      name: input.session.tenant.name,
      logo: input.session.tenant.logo,
      portalOrigin: input.session.tenant.portalOrigin,
      environment: input.session.tenant.environment,
    } } : null,
    verified: input.verified,
    gatewayUrl: input.gatewayUrl,
    branchName: input.branchName,
  }), [input.session?.mode, input.session?.tenant.id, input.session?.tenant.name, input.session?.tenant.logo, input.session?.tenant.portalOrigin, input.session?.tenant.environment, input.verified, input.gatewayUrl, input.branchName]);

  useEffect(() => {
    if (!controller || !nativeBranding) return;
    let confirmation: { remove(): void } | undefined;
    try {
      confirmation = nativeBranding.addListener("onPinConfirmed", (event) => {
        if (!controller.isCurrentConfirmation(event.shortcutId, event.revision)) return;
        confirmedRevision.current = event.revision;
        setMessage("Android confirmó el acceso de esta empresa en la pantalla de inicio.");
      });
    } catch {
      setMessage("Android no pudo observar la confirmación. Ningún acceso nuevo está confirmado.");
    }
    return () => {
      try { confirmation?.remove(); } catch { /* The optional native module may already be destroyed. */ }
      void controller.clear().catch(() => undefined);
    };
  }, [controller]);

  useEffect(() => {
    if (!controller) return;
    const version = ++lifecycle.current;
    confirmedRevision.current = null;
    setStatus(null);
    setBusy(false);
    setMessage("Preparando personalización…");
    void controller.synchronize(stableInput).then((next) => {
      if (version !== lifecycle.current) return;
      setStatus(next);
      setMessage(next?.ready ? next.pinSupported
        ? "Android solicitará tu confirmación. Este acceso abre la app; nunca inicia sesión ni cambia de empresa."
        : "Este dispositivo o su lanzador no permite añadir accesos. Recientes puede mostrar la empresa actual."
        : "Inicia sesión en una empresa verificada para personalizar su acceso.");
    }).catch(() => {
      if (version === lifecycle.current) {
        setStatus(null);
        setMessage("Android no pudo actualizar la personalización. Vuelve a abrir la app para reintentar.");
      }
    });
    return () => { lifecycle.current += 1; };
  }, [controller, stableInput]);

  useEffect(() => {
    if (automaticPinEligible) void requestPin(true);
  }, [controller, stableInput, status, disabled, automaticPinEligible]);

  async function requestPin(automatic = false): Promise<void> {
    if (!controller || disabled || !input.verified || !status?.ready || !status.pinSupported || pressLock.current) return;
    const version = lifecycle.current;
    pressLock.current = true;
    confirmedRevision.current = null;
    setBusy(true);
    try {
      const result = await controller.requestPin(automatic);
      if (version !== lifecycle.current || confirmedRevision.current !== null) return;
      if (result === "skipped") return;
      setMessage(result === "pending" ? "Confirma en Android. La solicitud enviada todavía no confirma que se haya añadido; si cancelas, puedes volver a intentarlo."
        : result === "updated" ? "Ya existe un acceso confirmado para esta empresa; se conserva actualizado, sin crear otro."
          : result === "unsupported" ? "El lanzador de este dispositivo no permite añadir este acceso."
            : "No se solicitó el acceso. Comprueba la empresa actual y vuelve a intentarlo con la app visible.");
    } catch {
      if (version === lifecycle.current) setMessage("Android no pudo solicitar el acceso. No se confirmó ningún acceso nuevo.");
    } finally {
      pressLock.current = false;
      if (version === lifecycle.current) setBusy(false);
    }
  }

  return {
    available: controller !== null,
    busy,
    canPin: Boolean(!disabled && input.verified && status?.ready && status.pinSupported),
    message,
    logoMessage: status?.logoUsed === "company"
      ? "Se utilizará el logo de la empresa validado en el dispositivo."
      : "Se utilizará el icono instalado de Qualitzer si el logo está ausente, no es compatible o no se pudo descargar de forma segura.",
    onPin: () => { void requestPin(); },
  };
}
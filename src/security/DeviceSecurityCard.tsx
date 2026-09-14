import { Text } from "react-native";
import { Badge, BodyText, Button, Card, SectionTitle } from "../ui/components";
import { palette } from "../ui/theme";
import type { DeviceSecurityUi } from "./DeviceSecurityContext";

export function DeviceSecurityCard({ security, disabled }: { security: DeviceSecurityUi; disabled: boolean }) {
  const { state, controller } = security;
  if (!state.supported) return null;
  return <Card style={{ gap: 14 }}>
    <SectionTitle title="Seguridad del teléfono" subtitle="Acceso rápido con tu huella o bloqueo de pantalla" />
    <Badge label={state.enabled ? "Vinculada a este teléfono" : "Sin vincular"} tone={state.enabled ? "success" : "neutral"} />
    <BodyText>Al abrir la app o volver de segundo plano se solicitará la seguridad configurada en el teléfono. No se guarda tu huella, PIN ni patrón.</BodyText>
    <BodyText>El bloqueo conserva tu sesión y tus borradores, también sin conexión. No reemplaza las credenciales si cierras sesión o el servidor la revoca.</BodyText>
    <BodyText>Puedes hacer capturas mientras la app esté desbloqueada. Al bloquearse, el contenido se oculta y las capturas quedan protegidas. La preferencia se mantiene en este teléfono, incluso al cambiar de cuenta.</BodyText>
    {state.error ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{state.error}</Text> : null}
    <Button title={state.enabled ? "Desvincular seguridad del teléfono" : "Vincular seguridad del teléfono"} variant="secondary" icon="finger-print-outline"
      disabled={disabled || state.busy || security.blocked} onPress={() => { void (state.enabled ? controller.disable() : controller.enable()); }} />
    <BodyText>Activar o desactivar requiere confirmar tu identidad con el sistema. Solo activa esta opción en un teléfono cuyo PIN y huellas conozcas y controles.</BodyText>
  </Card>;
}
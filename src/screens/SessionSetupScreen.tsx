import { ActivityIndicator, Text, View } from "react-native";
import type { Tenant } from "../domain/models";
import { BodyText, Brand, Button, Card, SectionTitle } from "../ui/components";
import { palette } from "../ui/theme";

export function SessionSetupScreen({ tenant, error, busy, onRetry, onCancel }: { tenant: Tenant; error: string | null; busy: boolean; onRetry: () => void; onCancel: () => void }) {
  return <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 20, width: "100%", maxWidth: 560, alignSelf: "center" }}>
    <Brand tenant={tenant} />
    <Card style={{ gap: 18 }}>
      <SectionTitle title="Preparando tu sesión" subtitle={`${tenant.name} · ${tenant.portalOrigin}`} />
      <BodyText>Las credenciales fueron aceptadas. Estamos cargando tu perfil y las sucursales de esta empresa.</BodyText>
      {busy && <ActivityIndicator color={palette.primary} size="large" />}
      {error && <Text accessibilityRole="alert" style={{ color: palette.danger }}>{error}</Text>}
      {!busy && <Button title="Reintentar carga de la sesión" onPress={onRetry} />}
      <Button title="Cerrar sesión y volver al acceso" variant="secondary" disabled={busy} onPress={onCancel} />
    </Card>
  </View>;
}
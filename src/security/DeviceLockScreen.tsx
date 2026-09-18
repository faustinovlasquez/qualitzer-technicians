import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BodyText, Brand, Button, Card, SectionTitle } from "../ui/components";
import { palette } from "../ui/theme";
import type { DeviceSecurityUi } from "./DeviceSecurityContext";

export function DeviceLockScreen({ security, privacyError }: { security: DeviceSecurityUi; privacyError: string | null }) {
  const { state, controller } = security;
  if (!privacyError && (state.nativeInteractionPending || state.ready && (!state.enabled || !state.locked) && !state.offered && !state.error)) return <SafeAreaView style={[styles.screen, styles.picker]}>
    <ActivityIndicator accessibilityLabel={state.nativeInteractionPending ? "Esperando selección" : "Preparando privacidad"} color={palette.primary} size="large" />
    <BodyText>{state.nativeInteractionPending ? "Esperando selección…" : "Preparando privacidad…"}</BodyText>
  </SafeAreaView>;
  const choosing = state.offered && !state.locked;
  const error = privacyError ?? state.error;
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Brand />
      <Card style={styles.card}>
        <View style={styles.symbol}><Ionicons name={choosing ? "finger-print-outline" : "lock-closed-outline"} size={42} color={palette.primary} /></View>
        <SectionTitle title={choosing ? "¿Vincular con la seguridad del teléfono?" : "Tu espacio está protegido"} />
        <BodyText>{choosing ? "Al volver a abrir Qualitzer, podrás usar tu huella o el PIN, patrón o código configurado en el teléfono. El sistema elegirá los métodos disponibles." : "Desbloquea con la huella o la seguridad de tu teléfono para continuar donde estabas."}</BodyText>
        <BodyText>{choosing ? "Es opcional. Qualitzer no recibe ni guarda tu huella, PIN o patrón. Puedes cambiarlo en Mi perfil → Seguridad del teléfono." : "Tu sesión, borradores y operaciones pendientes se conservan. Este bloqueo no reemplaza el inicio de sesión si la cuenta vence."}</BodyText>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!state.ready && !error || state.busy ? <ActivityIndicator accessibilityLabel="Verificando seguridad del teléfono" color={palette.primary} size="large" /> : null}
        {state.foreground && state.ready && !privacyError ? choosing ? <>
          <Button title="Vincular y verificar" icon="finger-print-outline" loading={state.busy} onPress={() => void controller.enable()} />
          <Button title="Ahora no" variant="secondary" disabled={state.busy} onPress={() => void controller.decline()} />
        </> : <Button title={error ? "Reintentar desbloqueo" : "Desbloquear"} icon="lock-open-outline" loading={state.busy} onPress={() => void controller.unlock()} /> : null}
        {!state.ready && error ? <Button title="Reintentar lectura segura" disabled={state.busy} onPress={() => void controller.retry()} /> : null}
        {privacyError ? <BodyText>Cierra y vuelve a abrir la aplicación. No borres sus datos; tus pendientes se conservan.</BodyText> : null}
      </Card>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  picker: { alignItems: "center", justifyContent: "center", gap: 16 },
  content: { flexGrow: 1, justifyContent: "center", width: "100%", maxWidth: 540, alignSelf: "center", padding: 24, gap: 28 },
  card: { gap: 18 },
  symbol: { width: 80, height: 80, borderRadius: 26, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" },
  error: { color: palette.danger, lineHeight: 22 },
});
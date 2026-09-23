import { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Switch, Text, View } from "react-native";
import { defaultLocationSchedule, locationEventLabel } from "../domain/locationTracking";
import { locationTrackingStatus } from "./LocationJournal";
import { LocationHistoryPanel } from "./LocationHistoryPanel";
import type { LocationTrackingUi } from "./useLocationTracking";
import { BodyText, Button, SectionTitle } from "../ui/components";
import { palette } from "../ui/theme";

export function LocationSettingsPanel({ tracking, disabled = false }: { tracking: LocationTrackingUi; disabled?: boolean }) {
  const schedule = tracking.state?.settings.schedule ?? defaultLocationSchedule(tracking.timezone);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => { setHistoryOpen(false); }, [tracking.state?.generation]);
  const enabled = tracking.state?.settings.enabled === true && tracking.state.settings.consentVersion === 2;
  const frozen = disabled || tracking.busy || !tracking.state;
  const toggle = (next: boolean) => {
    if (!next) { void tracking.save(tracking.state?.settings.schedule ?? defaultLocationSchedule(tracking.timezone), false); return; }
    Alert.alert("Ubicación de tus acciones", "Con tu autorización se guardará la ubicación al iniciar, pausar o entregar trabajos, cambiar actividades, checklists, archivos y ubicación de equipos o gestionar órdenes. Solo durante el uso, sin seguimiento continuo. Se enviará a tu empresa y puedes desactivarlo en cualquier momento.", [
      { text: "Cancelar", style: "cancel" }, { text: "Aceptar y permitir", onPress: () => { void tracking.save(schedule, true); } },
    ]);
  };
  return <View style={styles.section}>
    <SectionTitle title="Ubicación laboral" />
    {!tracking.available ? <BodyText>El seguimiento está disponible en la app instalada de Android o iOS.</BodyText> : <>
      <View style={styles.row}><Text style={styles.label}>Registrar mi ubicación</Text><Switch accessibilityLabel="Registrar mi ubicación" value={enabled} disabled={frozen} onValueChange={toggle} /></View>
      <BodyText>Zona horaria: {tracking.timezone}</BodyText>
      <BodyText>{locationTrackingStatus(tracking.state)}</BodyText>
      <BodyText>Solo al realizar acciones. No se registra un recorrido periódico ni en segundo plano.</BodyText>
      <BodyText>{tracking.state?.points.length ?? 0} puntos pendientes · Última sincronización: {tracking.state?.lastSyncedAt ? new Date(tracking.state.lastSyncedAt).toLocaleString("es-CL", { timeZone: tracking.timezone }) : "Sin registros enviados"}</BodyText>
      {tracking.synchronize ? <Button title="Sincronizar ubicaciones" icon="sync-outline" variant="secondary" disabled={frozen} onPress={() => { void tracking.synchronize?.(); }} /> : null}
      <BodyText>Por privacidad, la captura se detiene tras 24 horas sin verificar la sesión. Los puntos pendientes no se eliminan.</BodyText>
      <Button title="Permisos del teléfono" icon="settings-outline" variant="secondary" onPress={() => { void Linking.openSettings(); }} />
      {tracking.state?.points.slice(-5).reverse().map(point => <View key={point.id} style={styles.entry}>
        <Text style={styles.label}>{new Date(point.capturedAt).toLocaleTimeString("es-CL")} · {locationEventLabel(point)}</Text>
        <BodyText>{point.outcome === "located" ? `${point.latitude?.toFixed(5)}, ${point.longitude?.toFixed(5)} · precisión ${Math.round(point.accuracy ?? 0)} m` : "Sin ubicación disponible"}</BodyText>
      </View>)}
      <Button title={historyOpen ? "Cerrar historial" : "Mi historial de ubicación"} icon="time-outline" variant="secondary" disabled={frozen} onPress={() => setHistoryOpen(value => !value)} />
      {historyOpen ? <LocationHistoryPanel key={tracking.state?.generation} tracking={tracking} initialDate={new Intl.DateTimeFormat("en-CA", { timeZone: tracking.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())} /> : null}
      {tracking.error ? <Text accessibilityRole="alert" style={styles.error}>{tracking.error}</Text> : null}
    </>}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12, paddingVertical: 16, borderTopWidth: 1, borderColor: palette.border }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { color: palette.text, fontSize: 16, fontWeight: "700", flexShrink: 1 }, days: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, error: { color: palette.danger, fontSize: 14 }, entry: { gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderColor: palette.border } });
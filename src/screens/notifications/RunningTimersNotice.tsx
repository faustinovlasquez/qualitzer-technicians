import { StyleSheet, Text, View } from "react-native";
import type { Assignments } from "../../domain/models";
import { runningTimersFromSnapshot, type RunningTimerNoticeItem } from "../../notifications/runningTimers";
import { Badge, BodyText, Button, Card } from "../../ui/components";
import { palette, typography } from "../../ui/theme";

export interface RunningTimersNoticeProps {
  data: Assignments | null;
  selectedRangeLabel: string;
  serverRemindersReady: boolean;
  onOpen(item: RunningTimerNoticeItem): void;
}

export function RunningTimersNotice({ data, selectedRangeLabel, serverRemindersReady, onOpen }: RunningTimersNoticeProps) {
  const timers = runningTimersFromSnapshot(data);
  if (!timers.length) return null;
  return <Card style={styles.card}>
    <View style={styles.row}><Text accessibilityRole="header" style={styles.title}>Cronómetros activos</Text><Badge label={String(timers.length)} tone="warning" /></View>
    <BodyText>En el rango cargado: {selectedRangeLabel}. No es un listado exhaustivo de cronómetros fuera de este rango.</BodyText>
    {timers.map((timer) => <View key={`${timer.groupId}:${timer.workId}`} style={styles.timer}>
      <Text style={styles.name}>{timer.title}</Text>
      <Text style={styles.detail}>{Math.floor(timer.elapsedSeconds / 60)} min en la última actualización</Text>
      <Button title="Revisar cronómetro" variant="secondary" onPress={() => onOpen(timer)} />
    </View>)}
    <Text style={styles.detail}>{serverRemindersReady
      ? "Los avisos con la app cerrada los gestiona el servidor según tus preferencias; el sistema operativo puede retrasarlos o impedirlos."
      : "Los avisos con la app cerrada no están confirmados. Este recordatorio solo es visible mientras usas la app."}</Text>
  </Card>;
}

const styles = StyleSheet.create({
  card: { gap: 12, borderColor: palette.amber }, row: { flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" },
  title: { ...typography.heading, color: palette.navy }, timer: { gap: 8 }, name: { ...typography.label, color: palette.navy },
  detail: { ...typography.caption, color: palette.textSecondary },
});
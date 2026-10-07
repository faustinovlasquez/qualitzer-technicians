import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ActiveTimer } from "../../domain/notifications";
import { palette, radius } from "../../ui/theme";
import { activeTimerElapsed, activeTimerReference, type SnapshotActiveTimer } from "../../notifications/runningTimers";

interface BannerRow { key: string; name: string; reference: string; startedAt: string; open: () => void; }

/**
 * Alerta fija de cronómetros en curso. Usa el listado del servidor, que incluye trabajos planificados en otras fechas,
 * y completa con los cronómetros de la jornada cargada que el servidor aún no informa. Tocar "Ver" abre el trabajo.
 */
export function ActiveTimersBanner({ timers, localTimers = [], disabled, onOpen, onOpenLocal }: {
  timers: ActiveTimer[]; localTimers?: SnapshotActiveTimer[]; disabled: boolean;
  onOpen: (timer: ActiveTimer) => void; onOpenLocal?: (timer: SnapshotActiveTimer) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const rows: BannerRow[] = [
    ...timers.map((timer) => ({ key: `${timer.groupType}:${timer.groupId}:${timer.workId}`, name: timer.title || activeTimerReference(timer),
      reference: timer.title ? activeTimerReference(timer) : "", startedAt: timer.startedAt, open: () => onOpen(timer) })),
    ...localTimers.map((timer) => ({ key: `local:${timer.groupId}:${timer.workId}`, name: timer.title || `Trabajo #${timer.workId}`,
      reference: timer.title ? `Trabajo #${timer.workId}` : "", startedAt: timer.startedAt, open: () => onOpenLocal?.(timer) })),
  ];
  useEffect(() => {
    if (rows.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [rows.length]);
  if (rows.length === 0) return null;
  const visible = expanded ? rows : rows.slice(0, 1);
  return <View accessibilityRole="alert" style={styles.banner}>
    {visible.map((row, index) => <View key={row.key} style={[styles.row, index > 0 && styles.divider]}>
      <View style={styles.icon}><Ionicons name="timer-outline" size={20} color={palette.white} accessible={false} /></View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{rows.length > 1 && index === 0 && !expanded ? `${rows.length} cronómetros activos` : "Cronómetro activo"}</Text>
        <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{`${row.reference ? `${row.reference} · ` : ""}${activeTimerElapsed(row.startedAt, now)}`}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Ver cronómetro de ${row.name}`} disabled={disabled} onPress={row.open}
        style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.actionText}>Ver</Text>
      </Pressable>
    </View>)}
    {rows.length > 1 ? <Pressable accessibilityRole="button" onPress={() => setExpanded(value => !value)} style={styles.more}>
      <Text style={styles.moreText}>{expanded ? "Ver menos" : `Ver los ${rows.length}`}</Text>
      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={palette.amber} accessible={false} />
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: 12, marginTop: 8, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.amber, backgroundColor: palette.amberSoft, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderColor: palette.amber },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: palette.amber },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: "800", color: palette.amber, textTransform: "uppercase", letterSpacing: 0.4 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: "800", color: palette.heading },
  meta: { fontSize: 12, lineHeight: 17, color: palette.textSecondary },
  action: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: palette.amber },
  actionText: { fontSize: 14, fontWeight: "800", color: palette.white },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderTopWidth: 1, borderColor: palette.amber },
  moreText: { fontSize: 13, fontWeight: "800", color: palette.amber },
  disabled: { opacity: 0.5 }, pressed: { opacity: 0.8 },
});

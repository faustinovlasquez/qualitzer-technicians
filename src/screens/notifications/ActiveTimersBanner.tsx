import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ActiveTimer } from "../../domain/notifications";
import { palette, radius } from "../../ui/theme";
import { activeTimerElapsed, activeTimerReference } from "../../notifications/runningTimers";

/**
 * Alerta fija de cronómetros en curso. Viene del servidor, así que aparece aunque el trabajo esté planificado
 * en otra fecha y no se vea en la jornada cargada. Tocar "Ver" abre el trabajo para pausarlo o terminarlo.
 */
export function ActiveTimersBanner({ timers, disabled, onOpen }: { timers: ActiveTimer[]; disabled: boolean; onOpen: (timer: ActiveTimer) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (timers.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [timers.length]);
  if (timers.length === 0) return null;
  const visible = expanded ? timers : timers.slice(0, 1);
  return <View accessibilityRole="alert" style={styles.banner}>
    {visible.map((timer, index) => <View key={`${timer.groupType}:${timer.groupId}:${timer.workId}`} style={[styles.row, index > 0 && styles.divider]}>
      <View style={styles.icon}><Ionicons name="timer-outline" size={20} color={palette.white} accessible={false} /></View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{timers.length > 1 && index === 0 && !expanded ? `${timers.length} cronómetros activos` : "Cronómetro activo"}</Text>
        <Text style={styles.name} numberOfLines={1}>{timer.title || activeTimerReference(timer)}</Text>
        <Text style={styles.meta} numberOfLines={1}>{`${timer.title ? `${activeTimerReference(timer)} · ` : ""}${activeTimerElapsed(timer.startedAt, now)}`}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Ver cronómetro de ${timer.title || activeTimerReference(timer)}`} disabled={disabled} onPress={() => onOpen(timer)}
        style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.actionText}>Ver</Text>
      </Pressable>
    </View>)}
    {timers.length > 1 ? <Pressable accessibilityRole="button" onPress={() => setExpanded(value => !value)} style={styles.more}>
      <Text style={styles.moreText}>{expanded ? "Ver menos" : `Ver los ${timers.length}`}</Text>
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

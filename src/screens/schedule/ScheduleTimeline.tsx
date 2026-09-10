import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { duration, plainText, STATUS_LABELS } from "../../domain/format";
import { layoutScheduleBlocks, type ScheduleBlock, type ScheduleClock, type ScheduleDay } from "../../domain/weeklySchedule";
import { palette, typography } from "../../ui/theme";
import { scheduleBlockTime, scheduleDayLabel, scheduleMinuteLabel, scheduleSources } from "./schedulePresentation";
import { isPendingLocalWork } from "../offline/offlineDashboardUi";

export const SCHEDULE_PIXELS_PER_MINUTE = 1.2;
export const SCHEDULE_HEADER_HEIGHT = 64;
const gutterWidth = 52;
const timelineHeight = 1440 * SCHEDULE_PIXELS_PER_MINUTE;
const hours = Array.from({ length: 25 }, (_, hour) => hour);

interface ScheduleTimelineProps {
  days: ScheduleDay[];
  availableDates: readonly string[];
  unavailableDates?: readonly string[];
  clock: ScheduleClock | null;
  busy: boolean;
  onOpen: (block: ScheduleBlock) => void;
}

export function ScheduleTimeline({ days, availableDates, unavailableDates = [], clock, busy, onOpen }: ScheduleTimelineProps) {
  const [width, setWidth] = useState(320);
  const columns = useMemo(() => days.map((day) => {
    const placements = layoutScheduleBlocks(day.blocks, 64 / SCHEDULE_PIXELS_PER_MINUTE);
    const maxColumns = placements.reduce((max, item) => Math.max(max, item.columns), 1);
    return { day, placements, width: Math.max(days.length === 1 ? width - gutterWidth : 158, maxColumns * 116) };
  }), [days, width]);

  return (
    <View style={styles.row} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={{ width: gutterWidth }} accessible={false} importantForAccessibility="no-hide-descendants">
        <View style={styles.timeHeading}><Text style={styles.hour}>Hora</Text></View>
        <View style={{ height: timelineHeight + 20 }}>
          {hours.map((hour) => <Text key={hour} style={[styles.hour, styles.hourLabel, { top: hour * 60 * SCHEDULE_PIXELS_PER_MINUTE - (hour === 0 ? 0 : 8) }]}>{scheduleMinuteLabel(hour * 60)}</Text>)}
        </View>
      </View>
      <ScrollView horizontal directionalLockEnabled showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" style={styles.horizontal} contentContainerStyle={styles.columns}>
        {columns.map(({ day, placements, width: columnWidth }) => {
          const available = availableDates.includes(day.date);
          const missing = unavailableDates.includes(day.date);
          const localOnly = day.blocks.length > 0 && day.blocks.every((block) => isPendingLocalWork(block.work));
          return <View key={day.date} style={{ width: columnWidth }}>
            <View style={[styles.dayHeading, clock?.day === day.date && styles.todayHeading]}>
              <Text accessibilityRole="header" style={styles.dayTitle}>{scheduleDayLabel(day.date, true)}{clock?.day === day.date ? " · Hoy" : ""}</Text>
              <Text style={styles.caption}>{!available ? "Fuera del rango" : missing ? day.blocks.length === 0 ? "Sin copia · no disponible" : `${duration(day.plannedMinutes)} · ${localOnly ? "solo local" : "parcial"}` : `${duration(day.plannedMinutes)} planificadas`}</Text>
            </View>
            <View style={[styles.day, { height: timelineHeight + 20 }, (!available || missing) && styles.unavailable]}>
              {hours.map((hour) => <View key={hour} pointerEvents="none" style={[styles.hourLine, { top: hour * 60 * SCHEDULE_PIXELS_PER_MINUTE }]} />)}
              {available && day.blocks.length === 0 ? <Text style={styles.noBlocks}>{missing ? "Día no descargado · no es carga cero" : "Sin bloques planificados"}</Text> : null}
              {placements.map(({ block, column, columns: count, startMinute, endMinute }) => {
                const source = scheduleSources[block.source];
                const title = plainText(block.work.title) || "Trabajo sin título";
                const time = scheduleBlockTime(block);
                const targetHeight = (endMinute - startMinute) * SCHEDULE_PIXELS_PER_MINUTE;
                return <Pressable
                  key={block.key}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel={`${title}. ${scheduleDayLabel(day.date)}. ${time}. ${source.label}. ${STATUS_LABELS[block.work.status]}. ${duration(block.plannedMinutes)} planificadas.${block.work.isOverdue ? " Vencido." : ""}${block.continuesBefore ? ` Continúa desde ${scheduleDayLabel(block.scheduledDay)}.` : ""}${block.continuesAfter ? " Continúa al día siguiente." : ""}`}
                  accessibilityHint="Abre el trabajo en su fecha de planificación original."
                  disabled={busy}
                  onPress={() => { if (!busy) onOpen(block); }}
                  style={({ pressed }) => [styles.block, {
                    left: column * columnWidth / count + 2,
                    width: columnWidth / count - 4,
                    top: startMinute * SCHEDULE_PIXELS_PER_MINUTE,
                    height: targetHeight,
                    backgroundColor: source.background,
                    borderColor: source.color,
                  }, pressed && styles.pressed, busy && styles.busy]}
                >
                  <View pointerEvents="none" style={[styles.durationMark, { backgroundColor: source.color, top: (block.startMinute - startMinute) * SCHEDULE_PIXELS_PER_MINUTE, height: Math.max(1, (block.endMinute - block.startMinute) * SCHEDULE_PIXELS_PER_MINUTE - 2) }]} />
                  <Text numberOfLines={1} style={[styles.blockTime, { color: source.color }]}>{time}</Text>
                  <Text numberOfLines={1} style={styles.blockTitle}>{title}</Text>
                  <Text numberOfLines={1} style={styles.caption}>{isPendingLocalWork(block.work) ? "Guardado local · pendiente" : STATUS_LABELS[block.work.status]}{block.work.isOverdue ? " · Vencido" : ""}</Text>
                  {targetHeight >= 94 ? <Text numberOfLines={1} style={styles.caption}>{source.label}{!isPendingLocalWork(block.work) ? ` · ${block.group.code}` : ""}</Text> : null}
                </Pressable>;
              })}
              {clock?.day === day.date && available ? <View pointerEvents="none" accessible={false} style={[styles.now, { top: clock.minute * SCHEDULE_PIXELS_PER_MINUTE }]}><View style={styles.nowDot} /></View> : null}
            </View>
          </View>;
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  horizontal: { flex: 1 },
  columns: { flexDirection: "row" },
  timeHeading: { height: SCHEDULE_HEADER_HEIGHT, justifyContent: "center" },
  hour: { fontSize: 11, color: palette.textSecondary, fontVariant: ["tabular-nums"] },
  hourLabel: { position: "absolute", right: 8 },
  dayHeading: { height: SCHEDULE_HEADER_HEIGHT, padding: 8, justifyContent: "center", backgroundColor: palette.surface, borderLeftWidth: 1, borderColor: palette.border },
  todayHeading: { backgroundColor: palette.primarySoft },
  dayTitle: { ...typography.label, color: palette.text },
  caption: { ...typography.caption, color: palette.textSecondary },
  day: { borderLeftWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  unavailable: { backgroundColor: palette.track },
  hourLine: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderColor: palette.border },
  noBlocks: { ...typography.caption, color: palette.textMuted, padding: 12 },
  block: { position: "absolute", minWidth: 44, minHeight: 64, borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden" },
  durationMark: { position: "absolute", left: 0, width: 3 },
  blockTime: { fontSize: 11, lineHeight: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  blockTitle: { ...typography.caption, fontWeight: "700", color: palette.text },
  pressed: { opacity: 0.75 },
  busy: { opacity: 0.55 },
  now: { position: "absolute", left: 0, right: 0, borderTopWidth: 2, borderColor: palette.danger },
  nowDot: { position: "absolute", top: -5, left: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: palette.danger },
});
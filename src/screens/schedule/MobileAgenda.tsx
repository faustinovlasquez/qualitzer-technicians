import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { duration, plainText, STATUS_LABELS } from "../../domain/format";
import type { ScheduleBlock, ScheduleClock, ScheduleDay, ScheduleEntry, UnscheduledEntry } from "../../domain/weeklySchedule";
import { palette } from "../../ui/theme";
import { isPendingLocalWork } from "../offline/offlineDashboardUi";
import { agendaDaySummary, agendaEmptyMessage, scheduleBlockTime, scheduleDayLabel, scheduleMinuteLabel, scheduleSources } from "./schedulePresentation";

interface MobileAgendaProps {
  days: ScheduleDay[];
  selectedDay: string;
  mode: "day" | "week";
  clock: ScheduleClock | null;
  unavailableDates: readonly string[];
  unscheduled: UnscheduledEntry[];
  busy: boolean;
  onMode: (mode: "day" | "week") => void;
  onSelect: (day: string) => void;
  onOpen: (entry: ScheduleEntry, day: string) => void;
}

function AgendaCard({ entry, block, busy, onOpen }: { entry: ScheduleEntry; block?: ScheduleBlock; busy: boolean; onOpen: () => void }) {
  const source = scheduleSources[entry.source];
  const day = block?.day ?? entry.scheduledDay;
  const equipment = entry.work.workEquipment ?? entry.group.equipment;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${plainText(entry.work.title) || "Trabajo sin título"}. ${block ? scheduleBlockTime(block) : "Sin bloque horario"}. ${STATUS_LABELS[entry.work.status]}. ${day ? scheduleDayLabel(day) : "Sin fecha válida"}`}
    accessibilityHint="Abre el trabajo en su fecha de planificación original." accessibilityState={{ disabled: busy }} disabled={busy} onPress={onOpen}
    style={({ pressed }) => [styles.card, { borderLeftColor: source.color }, pressed && styles.pressed, busy && styles.disabled]}>
    {block ? <View style={styles.cardTop}><Text style={styles.time}>{scheduleBlockTime(block)}</Text><Text style={styles.caption}>{duration(block.plannedMinutes)} plan.</Text></View> : null}
    <Text style={styles.cardTitle}>{plainText(entry.work.title) || "Trabajo sin título"}</Text>
    <Text style={styles.status}>{isPendingLocalWork(entry.work) ? "Guardado local · pendiente de sincronizar" : STATUS_LABELS[entry.work.status]}{entry.work.isOverdue ? " · Atrasado" : ""}</Text>
    <Text style={styles.caption}>{source.label}{!isPendingLocalWork(entry.work) ? ` · ${entry.group.code}` : ""}</Text>
    {equipment ? <Text style={styles.caption}>{plainText(equipment.label)} · {equipment.identifier}</Text> : null}
    {block?.continuesBefore ? <Text style={styles.caption}>Continúa desde {scheduleDayLabel(entry.scheduledDay)}</Text> : null}
    {block?.continuesAfter ? <Text style={styles.caption}>Continúa al día siguiente</Text> : null}
  </Pressable>;
}

export function MobileAgenda({ days, selectedDay, mode, clock, unavailableDates, unscheduled, busy, onMode, onSelect, onOpen }: MobileAgendaProps) {
  const [showOther, setShowOther] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const visibleDays = mode === "day" ? days.filter((day) => day.date === selectedDay) : days;
  const overdue = unscheduled.filter((entry) => entry.reason === "overdue").length;
  const otherLabel = `${overdue} ${overdue === 1 ? "atrasado" : "atrasados"} · ${unscheduled.length - overdue} sin horario`;
  return <View style={styles.root} testID="mobile-agenda" accessibilityState={{ busy }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll} contentContainerStyle={styles.days} testID="agenda-day-strip">
      {days.map((day) => {
        const selected = day.date === selectedDay;
        const missing = unavailableDates.includes(day.date);
        const local = missing && (day.blocks.some((block) => isPendingLocalWork(block.work)) || unscheduled.some((entry) => entry.scheduledDay === day.date && isPendingLocalWork(entry.work)));
        const label = new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`)).replace(".", "");
        return <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`${scheduleDayLabel(day.date)} de ${day.date.slice(0, 4)}. ${agendaDaySummary(day, missing)}${local ? ". Solo local, sin copia completa del servidor" : ""}${day.overlapMinutes > 0 ? ". Con solapamientos" : ""}${clock?.day === day.date ? ". Hoy" : ""}${selected ? ". Seleccionado" : ""}`} accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => { if (busy) return; onSelect(day.date); onMode("day"); }} style={[styles.day, clock?.day === day.date && styles.today, (missing || day.overlapMinutes > 0) && styles.dayWarning, selected && styles.active, busy && styles.disabled]}>
          <Text style={[styles.weekday, selected && styles.white]}>{label}</Text>
          <Text style={[styles.dayNumber, selected && styles.white]}>{Number(day.date.slice(-2))}</Text>
          {missing ? <Text style={[styles.dayCoverage, selected && styles.white]}>{local ? "solo local" : day.blocks.length ? "Parcial" : "Sin copia"}</Text> : null}
        </Pressable>;
      })}
    </ScrollView>
    <View style={styles.heading}>
      {unscheduled.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={otherLabel} accessibilityHint="Muestra los trabajos fuera de los bloques horarios." accessibilityState={{ expanded: showOther }} onPress={() => setShowOther(!showOther)} style={styles.other}><Text style={styles.otherLabel}>{otherLabel}</Text><Text style={styles.label}>{showOther ? "Ocultar" : "Ver"}</Text></Pressable> : <Text style={styles.title}>Agenda</Text>}
      <View style={styles.toggle} accessibilityRole="tablist" accessibilityLabel="Vista de agenda">
        {(["day", "week"] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === "day" ? "Agenda del día" : "Agenda de la semana"} accessibilityState={{ selected: mode === value, disabled: busy }} disabled={busy} onPress={() => onMode(value)} style={[styles.mode, mode === value && styles.active]}><Text style={[styles.label, mode === value && styles.white]}>{value === "day" ? "Día" : "Semana"}</Text></Pressable>)}
      </View>
    </View>
    {showOther ? <View style={styles.section}>
      <Text style={styles.caption}>De toda la semana consultada y pendientes anteriores. No se incluyen en las horas planificadas.</Text>
      {unscheduled.map((entry) => <View key={entry.key} style={styles.section}>
        <Text style={styles.caption}>{entry.reason === "overdue" ? "Atrasado" : "Sin horario válido"} · {entry.scheduledDay ? scheduleDayLabel(entry.scheduledDay) : "Sin fecha válida"}</Text>
        <AgendaCard entry={entry} busy={busy} onOpen={() => onOpen(entry, selectedDay)} />
      </View>)}
    </View> : null}
    {visibleDays.map((day) => {
      const missing = unavailableDates.includes(day.date);
      const withoutTime = unscheduled.filter((entry) => entry.scheduledDay === day.date && entry.reason === "invalid_time").length;
      return <View key={day.date} style={styles.section} testID={`agenda-day-${day.date}`}>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.dateTitle}>{scheduleDayLabel(day.date)}{clock?.day === day.date ? " · Hoy" : ""}</Text>
          <Text style={styles.caption}>{agendaDaySummary(day, missing)}</Text>
        </View>
        {missing ? <Text accessibilityRole="alert" style={styles.warning}>Día no descargado por completo. La copia visible no confirma todas las asignaciones.</Text> : null}
        {day.overlapMinutes > 0 ? <Text style={styles.overlap}>{duration(day.overlapMinutes)} con horarios solapados</Text> : null}
        {day.blocks.length === 0 ? <View style={styles.empty}><Text style={styles.cardTitle}>{missing ? "Sin planificación completa" : "Sin bloques con horario"}</Text><Text style={styles.caption}>{agendaEmptyMessage(missing, withoutTime, unscheduled.length)}</Text></View> : day.blocks.map((block) => <AgendaCard key={block.key} entry={block} block={block} busy={busy} onOpen={() => onOpen(block, day.date)} />)}
      </View>;
    })}
    <Pressable accessibilityRole="button" accessibilityLabel="Información de horas y carga" accessibilityState={{ expanded: showInfo }} onPress={() => setShowInfo(!showInfo)} style={styles.info}>
      <Text style={styles.caption}>{clock ? `${scheduleMinuteLabel(clock.minute)} · hora de sucursal` : "Hora de sucursal no disponible"}</Text><Text style={styles.label}>{showInfo ? "Ocultar información" : "Sobre estas horas"}</Text>
    </Pressable>
    {showInfo ? <Text style={styles.caption}>{clock ? `Zona: ${clock.timezone}. ` : "La zona horaria no está informada o no es válida. "}El reloj se actualiza cada minuto. Las horas son planificación, no ejecución ni capacidad disponible. Los trabajos nocturnos reparten su carga entre días. El estado mostrado procede de la última información recibida; el reloj no cambia estados.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingBottom: 88 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 20, fontWeight: "700", color: palette.navy, flexShrink: 1 },
  toggle: { flexDirection: "row", backgroundColor: palette.track, borderRadius: 10, padding: 2 },
  mode: { minHeight: 44, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  active: { backgroundColor: palette.primary }, white: { color: palette.white },
  label: { fontSize: 13, fontWeight: "700", color: palette.primary },
  dayScroll: { flexGrow: 0 },
  days: { flexGrow: 1 },
  day: { flexGrow: 1, flexShrink: 0, flexBasis: "auto", minWidth: 44, minHeight: 52, borderRadius: 8, borderWidth: 1, borderColor: "transparent", alignItems: "center", justifyContent: "center", paddingVertical: 4, paddingHorizontal: 2 },
  today: { backgroundColor: palette.primarySoft, borderColor: "#C4E1DC" },
  dayWarning: { borderColor: palette.amber, backgroundColor: palette.amberSoft },
  dayCoverage: { fontSize: 10, lineHeight: 14, color: palette.amber, textAlign: "center", alignSelf: "stretch" },
  weekday: { fontSize: 12, lineHeight: 16, color: palette.textSecondary }, dayNumber: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: palette.text },
  section: { gap: 8 }, dateTitle: { fontSize: 16, lineHeight: 22, fontWeight: "700", color: palette.navy },
  caption: { fontSize: 13, lineHeight: 19, color: palette.textSecondary, flexShrink: 1 },
  card: { padding: 12, gap: 6, borderRadius: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderLeftWidth: 4 },
  cardTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 },
  time: { fontSize: 16, lineHeight: 22, fontWeight: "700", color: palette.navy, fontVariant: ["tabular-nums"] },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: palette.text },
  status: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: palette.primary },
  other: { flex: 1, minHeight: 44, gap: 2, padding: 8, borderRadius: 10, backgroundColor: palette.amberSoft },
  otherLabel: { fontSize: 13, fontWeight: "600", color: palette.text, flexShrink: 1 },
  warning: { fontSize: 13, lineHeight: 19, padding: 10, borderRadius: 10, color: palette.amber, backgroundColor: palette.amberSoft },
  overlap: { fontSize: 13, lineHeight: 19, color: palette.amber },
  empty: { padding: 16, borderRadius: 12, backgroundColor: palette.surface, gap: 8 },
  info: { minHeight: 44, gap: 4, paddingVertical: 8 },
  pressed: { opacity: 0.75 }, disabled: { opacity: 0.55 },
});
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { duration, plainText, STATUS_LABELS, weekRange } from "../../domain/format";
import { assignmentDay } from "../../domain/assignmentSchedule";
import type { AssignmentGroup, Assignments, AssignmentWork, DateRange, WorkOpenOptions } from "../../domain/models";
import { buildWeeklySchedule, scheduleClock, scheduleDateOffset, type ScheduleDay, type ScheduleEntry, type ScheduleSource } from "../../domain/weeklySchedule";
import { palette, radius, typography } from "../../ui/theme";
import { ScheduleTimeline, SCHEDULE_HEADER_HEIGHT, SCHEDULE_PIXELS_PER_MINUTE } from "./ScheduleTimeline";
import { scheduleDayLabel, scheduleSources } from "./schedulePresentation";
import { isPendingLocalWork } from "../offline/offlineDashboardUi";
import { AgendaOrderCard, MobileAgenda } from "./MobileAgenda";

export interface WeeklyScheduleProps {
  data: Assignments;
  range: DateRange;
  onOpenWork: (group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions) => void;
  onOpenGroup?: (group: AssignmentGroup) => void;
  busy?: boolean;
  timezone?: string;
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
  unavailableDates?: string[];
  viewMode?: "day" | "week" | "month";
  onViewModeChange?: (mode: "day" | "week" | "month", date?: string) => void;
}

export function WeeklySchedule({ data, range, onOpenWork, onOpenGroup, busy = false, timezone, selectedDate, onSelectDate, unavailableDates = [], viewMode, onViewModeChange }: WeeklyScheduleProps) {
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const [localMode, setLocalMode] = useState<"day" | "week" | "month">("week");
  const mode = viewMode ?? localMode;
  function setMode(next: "day" | "week" | "month", date = selectedDay): void {
    if (busy) return;
    if (onViewModeChange) onViewModeChange(next, date); else setLocalMode(next);
  }
  const lastCompact = useRef(compact);
  const [selection, setSelection] = useState<{ scope: string; day: string } | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const scroll = useRef<ScrollView>(null);
  const timelineTop = useRef(0);
  const initialScroll = useRef({ viewport: false, content: false, timeline: false, done: false });
  const model = useMemo(() => buildWeeklySchedule(data, range), [data, range.startDate, range.endDate]);
  const clock = useMemo(() => scheduleClock(timezone, now), [timezone, now]);
  const scope = `${range.startDate}:${range.endDate}`;
  const dates = model.days.map((day) => day.date);
  const missing = new Set(unavailableDates.filter((date) => dates.includes(date)));
  const localDates = new Set(model.unscheduled.filter((entry) => isPendingLocalWork(entry.work)).map((entry) => entry.scheduledDay));
  const initialDay = clock && dates.includes(clock.day) ? clock.day : range.startDate;
  const localDay = selection?.scope === scope ? selection.day : null;
  const requestedDay = selectedDate === undefined ? localDay : selectedDate;
  const candidateDay = requestedDay && dates.includes(requestedDay) ? requestedDay : initialDay;
  const selectedDay = candidateDay;
  const selectedIndex = Math.max(0, dates.indexOf(selectedDay));
  const selectedWeek = weekRange(selectedDay);
  const pageStart = Math.max(0, dates.indexOf(selectedWeek.startDate));
  const weekDays: ScheduleDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = scheduleDateOffset(selectedWeek.startDate, index);
    return model.days.find(day => day.date === date) ?? { date, blocks: [], plannedMinutes: 0, overlapMinutes: 0 };
  });
  const orders = data.groups.filter(group => group.type !== "direct_assignment" && group.works.length === 0);
  const focusedDay = model.days[selectedIndex]!;
  const visibleDays = mode === "day" ? [focusedDay] : weekDays;
  const weekMinutes = weekDays.reduce((total, day) => total + day.plannedMinutes, 0);
  const partial = weekDays.some((day) => missing.has(day.date));
  const weekLoad = partial && weekMinutes === 0 ? "Carga no disponible · parcial" : `${duration(weekMinutes)}${partial ? " · parcial" : ""}`;
  const overlapMinutes = visibleDays.reduce((total, day) => total + day.overlapMinutes, 0);
  const peakMinutes = Math.max(1, ...weekDays.map((day) => day.plannedMinutes));
  const overdueCount = model.unscheduled.filter((entry) => entry.reason === "overdue").length;
  const sources: ScheduleSource[] = ["external_ot", "internal_maintenance", "direct_assignment", "non_productive"];

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (lastCompact.current === compact) return;
    lastCompact.current = compact;
    setLocalMode("week");
  }, [compact]);

  function selectDay(day: string): void {
    if (busy) return;
    setSelection({ scope, day });
    onSelectDate?.(day);
  }
  function jumpToMinute(minute: number): void {
    scroll.current?.scrollTo({ y: timelineTop.current + SCHEDULE_HEADER_HEIGHT + Math.max(0, minute - 30) * SCHEDULE_PIXELS_PER_MINUTE, animated: true });
  }
  function scrollInitially(): void {
    const layout = initialScroll.current;
    if (layout.done || !layout.viewport || !layout.content || !layout.timeline || !scroll.current) return;
    layout.done = true;
    const starts = visibleDays.flatMap((day) => day.blocks.map((block) => block.startMinute));
    const minute = starts.length ? Math.max(0, Math.min(...starts) - 30) : 480;
    scroll.current.scrollTo({ y: timelineTop.current + SCHEDULE_HEADER_HEIGHT + minute * SCHEDULE_PIXELS_PER_MINUTE, animated: false });
  }
  function open(entry: ScheduleEntry): void {
    if (busy) return;
    selectDay(selectedDay);
    onOpenWork(entry.group, entry.work);
  }

  const legend = <View style={styles.legend}>
    {sources.map((source) => <View key={source} style={styles.legendItem}><View style={[styles.dot, { backgroundColor: scheduleSources[source].color }]} /><Text style={styles.caption}>{scheduleSources[source].label}</Text></View>)}
  </View>;
  const clockLabel = clock ? `Hora de sucursal · ${clock.timezone}` : timezone ? `Zona no válida: ${timezone} · sin línea de hora actual` : "Hora de sucursal · zona no informada; sin línea de hora actual";
  const footnote = <Text style={styles.footnote}>Horas planificadas del día, no tiempo ejecutado ni porcentaje de capacidad. Las barras comparan la carga entre estos días. Los trabajos nocturnos reparten su planificación entre las fechas cubiertas. Los bloques breves amplían sólo el área táctil; sus etiquetas indican las horas exactas.</Text>;

  function dayLoad(day: ScheduleDay): string {
    if (!missing.has(day.date)) return duration(day.plannedMinutes);
    if (day.blocks.length === 0) return localDates.has(day.date) ? "solo local" : "Sin copia";
    return day.blocks.every((block) => isPendingLocalWork(block.work)) ? "solo local" : "parcial";
  }

  const mobileAgenda = <MobileAgenda days={mode === "month" ? model.days : weekDays.filter((day) => dates.includes(day.date))} orders={orders} onOpenGroup={onOpenGroup} selectedDay={selectedDay} mode={mode} clock={clock} unavailableDates={unavailableDates} unscheduled={model.unscheduled} busy={busy} onMode={setMode} onSelect={selectDay} onOpen={(entry, day) => {
    if (busy) return;
    selectDay(day);
    onOpenWork(entry.group, entry.work);
  }} />;
  if (compact) return mobileAgenda;
  if (mode === "month") return <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>{mobileAgenda}</ScrollView>;

  return (
    <View style={[styles.root, compact && styles.compactRoot]} accessibilityState={{ busy }}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle]}>Horario de trabajo</Text>
          <Text accessibilityLabel={`${weekLoad} en siete días. ${clockLabel}`} style={[styles.total, compact && styles.caption]}>{weekLoad} <Text style={styles.muted}>{compact ? "· 7 días" : "planificadas · 7 días"}{compact && clock ? ` · ${String(Math.floor(clock.minute / 60)).padStart(2, "0")}:${String(clock.minute % 60).padStart(2, "0")}` : ""}</Text></Text>
        </View>
        <View accessibilityRole="tablist" accessibilityLabel="Vista del horario" style={styles.toggle}>
          {(["day", "week", "month"] as const).map((value) => <Pressable key={value} accessibilityRole="tab" aria-selected={mode === value} accessibilityLabel={value === "day" ? "Agenda del día" : value === "week" ? "Agenda de la semana" : "Agenda del mes"} accessibilityState={{ selected: mode === value, disabled: busy }} disabled={busy} onPress={() => setMode(value)} style={[styles.toggleButton, mode === value && styles.selected]}>
            <Text style={[styles.label, mode === value && styles.selectedText]}>{value === "day" ? "Día" : value === "week" ? "Semana" : "Mes"}</Text>
          </Pressable>)}
        </View>
      </View>
      {missing.size > 0 ? <Text accessibilityRole="alert" style={styles.coverageWarning}>{missing.size} días no descargados · no es carga cero</Text> : null}
      {!compact ? <Text style={styles.caption}>{clockLabel}</Text> : null}
      {model.days.length > 7 ? <View style={styles.navigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="Ver siete días anteriores del rango" disabled={pageStart === 0} onPress={() => selectDay(dates[Math.max(0, pageStart - 7)]!)} style={[styles.navButton, pageStart === 0 && styles.disabled]}><Text style={styles.label}>‹ Anteriores</Text></Pressable>
        <Text style={styles.caption}>{pageStart + 1}–{Math.min(pageStart + 7, dates.length)} de {dates.length} días</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Ver siete días siguientes del rango" disabled={pageStart + 7 >= dates.length} onPress={() => selectDay(dates[Math.min(dates.length - 1, pageStart + 7)]!)} style={[styles.navButton, pageStart + 7 >= dates.length && styles.disabled]}><Text style={styles.label}>Siguientes ›</Text></Pressable>
      </View> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripScroll} contentContainerStyle={styles.strip}>
        {weekDays.map((day) => {
          const available = dates.includes(day.date);
          const selected = selectedDay === day.date;
          const disabled = !available || busy;
          return <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`${scheduleDayLabel(day.date)}. ${available ? `${dayLoad(day)}${missing.has(day.date) ? ", sin copia completa del servidor" : " planificadas"}${day.overlapMinutes > 0 ? ", con solapamientos" : ""}${clock?.day === day.date ? ", hoy" : ""}` : "Fuera del rango consultado"}`} accessibilityHint="Muestra el horario ampliado de este día." accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => { selectDay(day.date); setMode("day"); }} style={[styles.dayChoice, compact && styles.compactDayChoice, selected && styles.daySelected, disabled && styles.disabled]}>
            <Text style={[styles.dayLabel, selected && styles.activeText]}>{scheduleDayLabel(day.date, true)}</Text>
            <Text style={[styles.dayLoad, selected && styles.activeText]}>{available ? dayLoad(day) : "—"}</Text>
            <View style={[styles.loadTrack, missing.has(day.date) && styles.unknownTrack]}>{!missing.has(day.date) || day.blocks.length > 0 ? <View style={[styles.loadBar, { width: `${day.plannedMinutes / peakMinutes * 100}%` }, day.overlapMinutes > 0 && styles.overlapBar]} /> : null}</View>
            <Text style={[styles.dayNote, compact && styles.compactDayNote]}>{day.overlapMinutes > 0 ? "Cruce" : clock?.day === day.date ? "Hoy" : " "}</Text>
          </Pressable>;
        })}
      </ScrollView>
      {!compact ? legend : null}
      <View style={styles.actions}>
        <Text style={[styles.caption, styles.headingCopy]}>{mode === "day" ? `${scheduleDayLabel(selectedDay)} · ${dayLoad(focusedDay)}` : "Desliza para ver los siete días"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Desplazar horario a las ocho de la mañana" onPress={() => jumpToMinute(480)} style={styles.jump}><Text style={styles.label}>08:00</Text></Pressable>
        {clock && visibleDays.some((day) => day.date === clock.day) ? <Pressable accessibilityRole="button" accessibilityLabel="Desplazar a la hora actual de la sucursal" onPress={() => jumpToMinute(clock.minute)} style={styles.jump}><Text style={styles.label}>Ahora</Text></Pressable> : null}
        {compact ? <Pressable accessibilityRole="button" accessibilityLabel="Cómo leer horario" accessibilityState={{ expanded: showHelp }} onPress={() => { setShowHelp(!showHelp); scroll.current?.scrollTo({ y: 0, animated: true }); }} style={styles.jump}><Text style={styles.label}>ⓘ</Text></Pressable> : null}
      </View>
      <ScrollView ref={scroll} style={styles.body} contentContainerStyle={styles.bodyContent} directionalLockEnabled keyboardShouldPersistTaps="handled"
        onLayout={(event) => { initialScroll.current.viewport = event.nativeEvent.layout.height > 0; scrollInitially(); }}
        onContentSizeChange={(_width, height) => { initialScroll.current.content = height > 0; scrollInitially(); }}>
        {compact && showHelp ? <View style={styles.help}>
          <Text accessibilityRole="header" style={styles.label}>Cómo leer horario</Text>
          <Text style={styles.caption}>{clockLabel}</Text>
          {legend}
          {footnote}
        </View> : null}
        {overlapMinutes > 0 ? <Text accessibilityRole="alert" style={styles.warning}>{duration(overlapMinutes)} con trabajos simultáneos. Revisa los cruces; no equivalen a disponibilidad.</Text> : null}
        {model.unscheduled.length ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: showUnscheduled }} onPress={() => { setShowUnscheduled(!showUnscheduled); scroll.current?.scrollTo({ y: 0, animated: true }); }} style={styles.unscheduledToggle}><Text style={styles.label}>{overdueCount} vencidos · {model.unscheduled.length - overdueCount} sin horario · {showUnscheduled ? "Ocultar" : "Ver"}</Text></Pressable> : null}
        {showUnscheduled ? <View style={styles.unscheduled}>
          <Text style={styles.caption}>Fuera de los bloques y del total planificado mostrado. No se asignan horas a pendientes anteriores ni a horarios inválidos.</Text>
          {model.unscheduled.map((entry) => <Pressable key={entry.key} accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => open(entry)} style={[styles.unplannedCard, busy && styles.disabled]}>
            <Text style={styles.unplannedTitle}>{plainText(entry.work.title) || "Trabajo sin título"}</Text>
            <Text style={styles.caption}>{entry.reason === "overdue" ? "Vencido" : "Sin horario"} · {entry.scheduledDay ? scheduleDayLabel(entry.scheduledDay) : "Sin fecha válida"} · {STATUS_LABELS[entry.work.status]}</Text>
            <Text style={styles.caption}>{scheduleSources[entry.source].label} · {isPendingLocalWork(entry.work) ? "Guardado local · pendiente" : entry.group.code}{entry.reason === "invalid_time" ? " · Horas ausentes o inválidas" : ""}</Text>
          </Pressable>)}
        </View> : null}
        <View onLayout={(event) => { timelineTop.current = event.nativeEvent.layout.y; initialScroll.current.timeline = true; scrollInitially(); }}>
          {!showUnscheduled ? model.unscheduled.filter(entry => entry.reason === "invalid_time" && visibleDays.some(day => day.date === entry.scheduledDay)).map(entry => <Pressable key={entry.key} accessibilityRole="button" disabled={busy} onPress={() => open(entry)} style={styles.unplannedCard}>
            <Text style={styles.unplannedTitle}>{plainText(entry.work.title)}</Text><Text style={styles.caption}>{scheduleDayLabel(entry.scheduledDay)} · Sin hora asignada</Text>
          </Pressable>) : null}
          {orders.filter(group => visibleDays.some(day => day.date === assignmentDay(group.scheduledDate))).map(group => <AgendaOrderCard key={group.id} group={group} busy={busy} onOpenGroup={onOpenGroup} />)}
          <ScheduleTimeline days={visibleDays} availableDates={dates} unavailableDates={unavailableDates} clock={clock} busy={busy} onOpen={open} />
        </View>
        {!compact ? footnote : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: palette.background, gap: 8 },
  compactRoot: { gap: 4 },
  compactTitle: { fontSize: 16, lineHeight: 20 },
  compactDayChoice: { minHeight: 62, paddingVertical: 3 },
  compactDayNote: { marginTop: 1 },
  help: { paddingVertical: 8, gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  headingCopy: { flex: 1 },
  title: { ...typography.heading, color: palette.text },
  total: { ...typography.label, color: palette.primary },
  muted: { color: palette.textSecondary, fontWeight: "400" },
  caption: { ...typography.caption, color: palette.textSecondary },
  toggle: { flexDirection: "row", padding: 3, backgroundColor: palette.track, borderRadius: radius.sm },
  toggleButton: { minHeight: 44, minWidth: 52, paddingHorizontal: 10, justifyContent: "center", alignItems: "center", borderRadius: 8 },
  selected: { backgroundColor: palette.primary },
  selectedText: { color: palette.white },
  label: { ...typography.label, color: palette.primary },
  navigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  disabled: { opacity: 0.5 },
  stripScroll: { flexGrow: 0, flexShrink: 0 },
  strip: { gap: 4, paddingVertical: 2, flexGrow: 1 },
  dayChoice: { flex: 1, minWidth: 48, minHeight: 80, borderWidth: 1, borderColor: palette.border, borderRadius: 10, padding: 5, alignItems: "center", backgroundColor: palette.surface },
  daySelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  dayLabel: { fontSize: 11, fontWeight: "600", color: palette.textSecondary },
  dayLoad: { fontSize: 11, fontWeight: "700", color: palette.text, marginVertical: 4 },
  activeText: { color: palette.primary },
  loadTrack: { height: 4, width: "100%", borderRadius: 2, backgroundColor: palette.track },
  unknownTrack: { backgroundColor: palette.amberSoft },
  loadBar: { height: 4, borderRadius: 2, backgroundColor: palette.primary },
  overlapBar: { backgroundColor: palette.danger },
  dayNote: { fontSize: 10, color: palette.danger, marginTop: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { height: 8, width: 8, borderRadius: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  jump: { minHeight: 44, minWidth: 48, paddingHorizontal: 8, justifyContent: "center", alignItems: "center", borderRadius: 8, backgroundColor: palette.surface },
  warning: { ...typography.caption, color: palette.danger, backgroundColor: palette.dangerSoft, padding: 8, borderRadius: 8 },
  coverageWarning: { ...typography.caption, color: palette.amber, backgroundColor: palette.amberSoft, padding: 6, borderRadius: 8 },
  unscheduledToggle: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 8, backgroundColor: palette.amberSoft },
  body: { flex: 1, minHeight: 0 },
  bodyContent: { paddingBottom: 88 },
  unscheduled: { paddingVertical: 10, gap: 8 },
  unplannedCard: { minHeight: 64, padding: 12, gap: 3, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  unplannedTitle: { ...typography.label, color: palette.text },
  footnote: { ...typography.caption, color: palette.textMuted, paddingVertical: 14 },
});
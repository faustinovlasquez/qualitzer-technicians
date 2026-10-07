import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { buildAgenda, type AgendaWorkItem } from "../../domain/agendaTimeline";
import { assignmentCodes } from "../../domain/assignmentCodes";
import { assignmentDays, dailyRange, manHours } from "../../domain/assignmentSchedule";
import { isFinished, monthRange, plainText, shiftDate, shortDate, weekRange } from "../../domain/format";
import type { AssignmentGroup, Assignments, AssignmentWork, DateRange } from "../../domain/models";
import { EmptyState, IconButton, type IconName } from "../../ui/components";
import { palette, radius } from "../../ui/theme";
import { groupTypes } from "../orders/assignmentPresentation";

export interface AgendaTimelineProps {
  data: Assignments | null;
  range: DateRange;
  today: string;
  busy: boolean;
  loading: boolean;
  /** Descarga por días en segundo plano: la agenda sigue navegable y lo descargado queda guardado. */
  downloading?: boolean;
  query: string;
  onRangeChange(range: DateRange): void;
  onOpenWork(group: AssignmentGroup, work: AssignmentWork): void;
  onOpenCalendar(): void;
  onOpenFilters(): void;
}

type AgendaMode = "day" | "week" | "month";
type Status = { label: string; color: string; background: string; icon?: IconName };

const SCHEDULED: Status = { label: "Programada", color: palette.info, background: palette.infoSoft };
const PENDING: Status = { label: "Pendiente", color: "#C2410C", background: "#FFF1E6" };
const ACTIVE: Status = { label: "En curso", color: palette.primary, background: palette.primarySoft, icon: "play-circle" };
const PAUSED: Status = { label: "Pausada", color: palette.amber, background: palette.amberSoft, icon: "pause-circle" };
const DONE: Status = { label: "Completada", color: palette.success, background: palette.successSoft, icon: "checkmark-circle" };
const NO_TIME = palette.textMuted;
const hours = (value: number): string => `${manHours(value)} h`;
const weekDays = (start: string): string[] => assignmentDays({ startDate: start, endDate: shiftDate(start, 6) });

/** Programada: pendiente en un día futuro; Pendiente: hoy o atrasada; luego En curso, Pausada y Completada. */
function statusOf(item: AgendaWorkItem, today: string): Status {
  if (isFinished(item.work)) return DONE;
  if (item.work.status === "in_progress") return ACTIVE;
  if (item.work.status === "paused") return PAUSED;
  return item.day > today ? SCHEDULED : PENDING;
}

function HoursTile({ icon, value, label, color, background }: { icon: IconName; value: string; label: string; color: string; background: string }) {
  return <View style={[styles.tile, { backgroundColor: background }]} accessible accessibilityLabel={`${label}: ${value}`}>
    <View style={styles.tileIcon}><Ionicons name={icon} size={16} color={color} accessible={false} /></View>
    <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
    <Text style={[styles.tileLabel, { color }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{label.replace(/^HH /, "HH\n")}</Text>
  </View>;
}

function AgendaRow({ item, today, onOpen, disabled }: { item: AgendaWorkItem; today: string; onOpen(group: AssignmentGroup, work: AssignmentWork): void; disabled: boolean }) {
  const { group, work } = item;
  const status = statusOf(item, today);
  const accent = item.start || isFinished(work) ? status.color : NO_TIME;
  const codes = assignmentCodes(group, work);
  const code = codes.workOrderCode ?? codes.workCode ?? (group.code.trim() ? plainText(group.code) : groupTypes[group.type].label);
  const equipment = (work.workEquipment ?? group.equipment)?.label?.trim();
  const title = plainText(work.title) || "Trabajo sin título";
  const planned = Math.max(0, work.plannedMinutes);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.start ? `${item.start} a ${item.end ?? ""}. ` : "Sin hora asignada. "}${title}. ${status.label}. ${hours(planned)} planificadas. ${[code, equipment].filter(Boolean).join(", ")}`}
    accessibilityHint="Abre el detalle del trabajo." disabled={disabled} onPress={() => onOpen(group, work)}
    style={({ pressed }) => [styles.card, { borderLeftColor: accent }, pressed && styles.pressed]}>
    <View style={styles.timeColumn}>
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <View style={styles.times}>
        {item.start ? <><Text style={styles.time}>{item.start}</Text>{item.end ? <Text style={styles.time}>{item.end}</Text> : null}</> : null}
      </View>
    </View>
    <View style={styles.divider} />
    <View style={styles.body}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {planned > 0 ? <Text style={styles.planned}>{hours(planned)} plan.</Text> : null}
      </View>
      <View style={styles.pills}>
        {!item.start && !isFinished(work) ? <Text style={[styles.pill, styles.pillNoTime]}>Sin hora asignada</Text> : null}
        <View style={[styles.pillBox, { backgroundColor: status.background }]}>
          {status.icon ? <Ionicons name={status.icon} size={14} color={status.color} accessible={false} /> : null}
          <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.meta} numberOfLines={1}>{[code, equipment].filter(Boolean).join(" · ")}</Text>
        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} accessible={false} />
      </View>
    </View>
  </Pressable>;
}

/** Agenda con días de la semana, modos Día/Semana/Mes, horas por estado y lista de trabajos. */
export function AgendaTimeline({ data, range, today, busy, loading, downloading = false, query, onRangeChange, onOpenWork, onOpenCalendar, onOpenFilters }: AgendaTimelineProps) {
  const isMonthRange = range.startDate === monthRange(range.startDate).startDate && range.endDate === monthRange(range.startDate).endDate;
  const [mode, setMode] = useState<AgendaMode>(isMonthRange ? "month" : "week");
  const week = weekRange(mode === "month" ? (today >= range.startDate && today <= range.endDate ? today : range.startDate) : range.startDate);
  const [selected, setSelected] = useState(() => today >= week.startDate && today <= week.endDate ? today : week.startDate);
  useEffect(() => { if (selected < week.startDate || selected > week.endDate) setSelected(today >= week.startDate && today <= week.endDate ? today : week.startDate); }, [week.startDate, week.endDate]);
  const visible: DateRange = mode === "day" ? dailyRange(selected) : mode === "month" ? monthRange(selected) : week;
  const summary = useMemo(() => buildAgenda(data?.groups ?? [], visible, query), [data, visible.startDate, visible.endDate, query]);
  const days = weekDays(week.startDate);
  const locked = busy || (loading && !downloading);
  const heading = mode === "day" ? "Trabajos del día" : mode === "month" ? "Trabajos del mes" : "Trabajos de la semana";
  const groupedByDay = mode !== "day" && new Set(summary.items.map(item => item.day)).size > 1;

  function changeMode(next: AgendaMode): void {
    if (locked) return;
    setMode(next);
    if (next === "month") onRangeChange(monthRange(selected));
    else if (mode === "month") onRangeChange(weekRange(selected));
  }
  function goToday(): void {
    if (locked) return;
    setSelected(today);
    if (mode === "month") onRangeChange(monthRange(today));
    else if (today < week.startDate || today > week.endDate) onRangeChange(weekRange(today));
  }
  function moveWeek(offset: number): void {
    if (locked) return;
    const start = shiftDate(week.startDate, offset * 7);
    setSelected(start);
    onRangeChange(mode === "month" ? monthRange(start) : weekRange(start));
  }

  return <View style={styles.root} testID="agenda-timeline">
    <View style={styles.weekRow}>
      <IconButton name="chevron-back-outline" label="Semana anterior" disabled={locked} onPress={() => moveWeek(-1)} />
      <Text style={styles.weekLabel} accessibilityRole="header">{shortDate(week.startDate)} – {shortDate(week.endDate)}</Text>
      <IconButton name="chevron-forward-outline" label="Semana siguiente" disabled={locked} onPress={() => moveWeek(1)} />
      <View style={styles.grow} />
      <IconButton name="calendar-outline" label="Calendario semanal" disabled={busy} onPress={onOpenCalendar} />
      <IconButton name="options-outline" label="Filtros y OTs de agenda" disabled={busy} onPress={onOpenFilters} />
    </View>

    <View style={styles.days} accessibilityRole="tablist">
      {days.map(day => {
        const active = day === selected;
        const date = new Date(`${day}T12:00:00Z`);
        return <Pressable key={day} accessibilityRole="tab" accessibilityState={{ selected: active }} aria-selected={active} accessibilityLabel={new Intl.DateTimeFormat("es-CL", { dateStyle: "full", timeZone: "UTC" }).format(date)}
          disabled={locked} onPress={() => { setSelected(day); if (mode === "week") setMode("day"); }} style={[styles.day, active && styles.dayActive]}>
          <Text style={[styles.dayName, active && styles.dayTextActive]}>{new Intl.DateTimeFormat("es-CL", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "")}</Text>
          <Text style={[styles.dayNumber, active && styles.dayTextActive, day === today && !active && styles.dayToday]}>{date.getUTCDate()}</Text>
        </Pressable>;
      })}
    </View>

    <View style={styles.modes}>
      <Pressable accessibilityRole="button" accessibilityLabel="Ir a hoy" disabled={locked} onPress={goToday} style={styles.todayButton}><Text style={styles.todayText}>Hoy</Text></Pressable>
      <View style={styles.segment} accessibilityRole="tablist">
        {(["day", "week", "month"] as const).map(id => {
          const active = mode === id;
          return <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: active }} aria-selected={active} disabled={locked} onPress={() => changeMode(id)} style={[styles.segmentItem, active && styles.segmentActive]}>
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{id === "day" ? "Día" : id === "week" ? "Semana" : "Mes"}</Text>
          </Pressable>;
        })}
      </View>
    </View>

    <View style={styles.tiles}>
      <HoursTile icon="hourglass-outline" value={hours(summary.hours.pending)} label="HH pendientes" color={palette.amber} background={palette.amberSoft} />
      <HoursTile icon="pulse-outline" value={hours(summary.hours.active)} label="HH en curso" color={palette.primary} background={palette.primarySoft} />
      <HoursTile icon="checkmark-done-outline" value={hours(summary.hours.completed)} label="HH completadas" color={palette.success} background={palette.successSoft} />
      <HoursTile icon="time-outline" value={hours(summary.hours.planned)} label="HH planificadas" color="#6D4AB4" background="#F1ECFA" />
      <HoursTile icon="stats-chart" value={hours(summary.hours.reported)} label="HH reportadas" color={palette.info} background={palette.infoSoft} />
    </View>

    <View style={styles.heading}>
      <Text style={styles.headingTitle} accessibilityRole="header">{heading}</Text>
      <Text style={styles.headingCount}>{summary.items.length} OT · {summary.counts.unscheduled} sin hora</Text>
    </View>

    {summary.items.length === 0 ? <EmptyState icon="calendar-clear-outline" title={loading || downloading ? "Cargando agenda…" : "Sin trabajos"}
      message={query.trim() ? "Ningún trabajo coincide con la búsqueda." : mode === "day" ? "No hay trabajos para este día." : "No hay trabajos en este período."} />
      : summary.items.map((item, index) => <View key={item.key} style={styles.item}>
        {groupedByDay && item.day !== summary.items[index - 1]?.day ? <Text style={[styles.dayHeader, item.day === today && styles.dayHeaderToday]}>
          {new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${item.day}T12:00:00Z`))}{item.day === today ? " · Hoy" : ""}
        </Text> : null}
        <AgendaRow item={item} today={today} onOpen={onOpenWork} disabled={busy} />
      </View>)}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  weekRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  weekLabel: { fontSize: 15, fontWeight: "700", color: palette.heading, minWidth: 0, flexShrink: 1 },
  grow: { flex: 1 },
  days: { flexDirection: "row", justifyContent: "space-between", gap: 4 },
  day: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: radius.md },
  dayActive: { backgroundColor: palette.primary },
  dayName: { fontSize: 12, color: palette.textSecondary },
  dayNumber: { fontSize: 18, lineHeight: 24, fontWeight: "800", color: palette.heading },
  dayToday: { color: palette.primary },
  dayTextActive: { color: palette.white },
  modes: { flexDirection: "row", alignItems: "center", gap: 8 },
  todayButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  todayText: { fontSize: 13, fontWeight: "800", color: palette.heading },
  segment: { flex: 1, flexDirection: "row", padding: 3, borderRadius: radius.md, backgroundColor: palette.track },
  segmentItem: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: radius.sm },
  segmentActive: { backgroundColor: palette.primary },
  segmentText: { fontSize: 13, fontWeight: "600", color: palette.textSecondary },
  segmentTextActive: { color: palette.white, fontWeight: "800" },
  tiles: { flexDirection: "row", gap: 4 },
  tile: { flex: 1, minWidth: 0, borderRadius: radius.md, paddingHorizontal: 5, paddingVertical: 8, gap: 3, borderWidth: 1, borderColor: palette.border },
  tileIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  tileValue: { fontSize: 15, lineHeight: 20, fontWeight: "800", color: palette.heading, fontVariant: ["tabular-nums"] },
  tileLabel: { fontSize: 9.5, lineHeight: 12, fontWeight: "600" },
  heading: { gap: 2, marginTop: 4 },
  headingTitle: { fontSize: 18, lineHeight: 24, fontWeight: "800", color: palette.heading },
  headingCount: { fontSize: 13, color: palette.textSecondary },
  item: { gap: 6 },
  dayHeader: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, color: palette.textSecondary, textTransform: "uppercase", marginTop: 4 },
  dayHeaderToday: { color: palette.primary },
  card: { flexDirection: "row", alignItems: "stretch", minHeight: 84, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderLeftWidth: 4, overflow: "hidden" },
  timeColumn: { width: 64, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  times: { gap: 2 },
  time: { fontSize: 13, color: palette.textSecondary, fontVariant: ["tabular-nums"] },
  divider: { width: 1, backgroundColor: palette.border, marginVertical: 10 },
  body: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 9, gap: 5 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: "800", color: palette.heading },
  planned: { fontSize: 12, color: palette.textSecondary, fontVariant: ["tabular-nums"] },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  pill: { fontSize: 12, fontWeight: "600", paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, overflow: "hidden" },
  pillNoTime: { color: palette.textSecondary, backgroundColor: palette.track },
  pillBox: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontSize: 12, fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { flex: 1, minWidth: 0, fontSize: 12, color: palette.textSecondary },
  pressed: { opacity: 0.75 },
});

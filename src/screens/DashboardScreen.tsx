import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { matchesAssignmentSearch, matchesOrderSearch } from "../domain/assignmentCodes";
import { assignmentDay, assignmentIncludesDay, assignmentPlannedMinutes, assignmentWorkForDay, assignmentWorkQueryRange, dailyRange } from "../domain/assignmentSchedule";
import { dateKey, duration, isFinished, shiftDate, shortDate, weekRange } from "../domain/format";
import type { AssignmentGroup, Assignments, AssignmentWork, DateRange, StatusInput, User, WorkOpenOptions } from "../domain/models";
import type { OfflineSnapshot } from "../domain/offline";
import { Badge, Button, Card, EmptyState, IconButton, SectionTitle, type IconName } from "../ui/components";
import { palette, radius, theme, typography } from "../ui/theme";
import { AssignmentOrderCard } from "./orders/AssignmentOrderCard";
import { AssignmentWorkCard } from "./orders/AssignmentWorkCard";
import { fullDate } from "./orders/assignmentPresentation";
import { WeeklySchedule } from "./schedule/WeeklySchedule";
import { RunningTimersNotice } from "./notifications/RunningTimersNotice";
import { runningTimersFromSnapshot, type RunningTimerNoticeItem } from "../notifications/runningTimers";
import { isPendingLocalWork, unavailableCoverageDates } from "./offline/offlineDashboardUi";

export interface DashboardScreenProps {
  data: Assignments | null;
  user: User;
  range: DateRange;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onRangeChange: (range: DateRange) => void;
  onOpenWork: (group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions) => void;
  onOpenGroup: (group: AssignmentGroup, initialTab?: "works" | "files") => void;
  onWorkStatus: (group: AssignmentGroup, work: AssignmentWork, input: StatusInput) => Promise<void>;
  busy?: boolean;
  serverRemindersReady?: boolean;
  offline?: OfflineSnapshot | null;
  companyBranchId?: number;
  focusDate?: string | null;
  onFocusDate?: (date: string) => void;
  view: "today" | "agenda";
}

type StatusFilter = "all" | "pending" | "in_progress" | "completed";
type AssignmentListView = "works" | "maintenances" | "orders";
interface WorkEntry { group: AssignmentGroup; work: AssignmentWork; }
interface WorkSection { key: string; date: string | null; entries: WorkEntry[]; }
interface DaySelection { scope: string; date: string; }

const listViewStorageKey = "@qualitzer/ui/assignment-list-view/v1";
const listViews: { value: AssignmentListView; label: string; icon: IconName }[] = [
  { value: "works", label: "Trabajos", icon: "construct-outline" },
  { value: "maintenances", label: "Mantenimientos", icon: "build-outline" },
  { value: "orders", label: "OTs", icon: "albums-outline" },
];

const filters: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "in_progress", label: "En curso" },
  { value: "completed", label: "Completados" },
];

function scheduledDay(work: AssignmentWork): string {
  return assignmentDay(work.scheduledDate);
}

function groupKey(group: AssignmentGroup): string {
  return JSON.stringify([group.type, group.id]);
}

function matchesStatus(work: Pick<AssignmentWork, "status">, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return work.status === "completed" || work.status === "delivered";
  if (filter === "in_progress") return work.status === "in_progress" || work.status === "paused";
  return work.status === "pending";
}

function buildSections(entries: WorkEntry[], agenda: boolean): WorkSection[] {
  const sections = new Map<string, WorkEntry[]>();
  const ordered = [...entries].sort((left, right) => {
    const dateOrder = (scheduledDay(left.work) || "9999").localeCompare(scheduledDay(right.work) || "9999");
    return dateOrder || left.work.scheduledStartTime.localeCompare(right.work.scheduledStartTime) || left.work.title.localeCompare(right.work.title, "es");
  });

  for (const { group, work } of ordered) {
    const key = agenda ? scheduledDay(work) : "day";
    const sectionEntries = sections.get(key) ?? [];
    sectionEntries.push({ group, work });
    sections.set(key, sectionEntries);
  }

  return Array.from(sections, ([key, sectionEntries]) => ({ key, date: agenda ? key : null, entries: sectionEntries }));
}

function Kpi({ title, value, note, icon, tone }: { title: string; value: number | null; note: string | null; icon: IconName; tone: "warning" | "teal" | "success" }) {
  const color = tone === "warning" ? palette.amber : tone === "success" ? palette.success : palette.primary;
  const background = tone === "warning" ? palette.amberSoft : tone === "success" ? palette.successSoft : palette.primarySoft;
  return (
    <Card style={styles.kpi}>
      <View style={styles.kpiTop}>
        <View style={[styles.kpiIcon, { backgroundColor: background }]}><Ionicons name={icon} size={15} color={color} accessible={false} /></View>
        <Text style={styles.kpiValue}>{value ?? "—"}</Text>
      </View>
      <Text style={styles.kpiTitle}>{title}</Text>
      {note ? <Text style={styles.kpiNote}>{note}</Text> : null}
    </Card>
  );
}

export function DashboardScreen({ data, user, range, loading, error, onRefresh, onRangeChange, onOpenWork, onOpenGroup, onWorkStatus, busy = false, serverRemindersReady = false, offline, companyBranchId, focusDate, onFocusDate, view }: DashboardScreenProps) {
  const compact = useWindowDimensions().width < 600;
  const [agendaLayout, setAgendaLayout] = useState<"schedule" | "list">("schedule");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [daySelection, setDaySelection] = useState<DaySelection | null>(null);
  const [weekSelection, setWeekSelection] = useState<DaySelection | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [listView, setListView] = useState<AssignmentListView>("works");
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const preferenceChanged = useRef(false);
  const preferenceWrites = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const today = dateKey();
  const scopeKey = `${view}:${range.startDate}:${range.endDate}`;
  const selectedDay = view === "today" ? range.startDate : daySelection?.scope === scopeKey ? daySelection.date : null;
  const displayedWeek = weekRange(view === "today" && weekSelection?.scope === scopeKey ? weekSelection.date : range.startDate);
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(displayedWeek.startDate, index));
  const firstName = user.name.trim().split(/\s+/)[0] ?? "";
  const rangeLabel = range.startDate === range.endDate ? fullDate(range.startDate) : `${shortDate(range.startDate)} – ${shortDate(range.endDate)} · ${range.endDate.slice(0, 4)}`;
  const weekLabel = `${shortDate(displayedWeek.startDate)} – ${shortDate(displayedWeek.endDate)} · ${displayedWeek.endDate.slice(0, 4)}`;
  const sameWeekMonth = displayedWeek.startDate.slice(0, 7) === displayedWeek.endDate.slice(0, 7);
  const crossYearWeek = displayedWeek.startDate.slice(0, 4) !== displayedWeek.endDate.slice(0, 4);
  const compactWeekLabel = `${sameWeekMonth ? Number(displayedWeek.startDate.slice(-2)) : shortDate(displayedWeek.startDate)}${crossYearWeek ? ` ${displayedWeek.startDate.slice(0, 4)}` : ""}–${shortDate(displayedWeek.endDate)}${crossYearWeek || displayedWeek.endDate.slice(0, 4) !== range.endDate.slice(0, 4) ? ` ${displayedWeek.endDate.slice(0, 4)}` : ""}`;
  const unavailableDates = unavailableCoverageDates(offline, range, companyBranchId);
  const unavailableWeekDates = unavailableCoverageDates(offline, displayedWeek, companyBranchId);
  const partial = (selectedDay ? unavailableWeekDates.includes(selectedDay) : unavailableDates.length > 0);
  const coveragePending = offline === null;
  const coverageNotice = unavailableDates.length > 0
    ? <Text accessibilityRole="alert" style={styles.coverageWarning}>{unavailableDates.length} días no descargados · no es carga cero</Text>
    : coveragePending ? <Text style={styles.preferenceError}>Verificando copia local…</Text> : null;

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void AsyncStorage.getItem(listViewStorageKey).then((saved) => {
      if (active && !preferenceChanged.current && (saved === "works" || saved === "orders" || saved === "maintenances")) setListView(saved);
    }).catch(() => {
      if (active && !preferenceChanged.current) setPreferenceError("No se pudo recuperar la vista guardada. Puedes elegir Trabajos u OTs.");
    });
    return () => { active = false; mounted.current = false; };
  }, []);

  const scopedEntries = useMemo<WorkEntry[]>(() => (data?.groups ?? []).flatMap((group) => group.works
    .filter((work) => view === "today" || !selectedDay || assignmentIncludesDay(work, selectedDay))
    .map((work) => ({ group, work: view === "agenda" && selectedDay ? assignmentWorkForDay(work, selectedDay) : work }))), [data, view, selectedDay]);

  const counts = useMemo(() => {
    const works = scopedEntries.map(({ work }) => work);
    return {
      total: works.length,
      pending: works.filter((work) => work.status === "pending").length,
      active: works.filter((work) => work.status === "in_progress" || work.status === "paused").length,
      paused: works.filter((work) => work.status === "paused").length,
      completed: works.filter(isFinished).length,
      delivered: works.filter((work) => work.status === "delivered").length,
      minutes: works.reduce((sum, work) => sum + (selectedDay ? Math.max(0, work.plannedMinutes) : assignmentPlannedMinutes(work)), 0),
    };
  }, [scopedEntries, selectedDay]);

  const filteredEntries = useMemo(() => scopedEntries.filter(({ group, work }) => matchesStatus(work, filter) && matchesAssignmentSearch(group, work, query)), [scopedEntries, query, filter]);
  const scopedOrders = (data?.groups ?? []).filter((group) => {
    if (group.type === "direct_assignment") return false;
    if (scopedEntries.some((entry) => groupKey(entry.group) === groupKey(group))) return true;
    const day = assignmentDay(group.scheduledDate);
    const start = selectedDay ?? range.startDate;
    const end = selectedDay ?? range.endDate;
    const open = group.status !== "completed" && group.status !== "delivered";
    return !day || (day >= start && day <= end) || (day < start && open);
  });
  const emptyOrders = scopedOrders.filter((group) => group.works.length === 0);
  const filteredOrders = scopedOrders.filter((group) => matchesStatus(group, filter) && matchesOrderSearch(group, query));
  const filteredMaintenances = filteredOrders.filter((group) => group.type === "internal_maintenance");
  const filteredWorkOrders = filteredOrders.filter((group) => group.type === "external_ot");
  const visibleOrders = listView === "maintenances" ? filteredMaintenances : filteredWorkOrders;
  const viewCounts = { works: filteredEntries.length, maintenances: filteredMaintenances.length, orders: filteredWorkOrders.length };
  const visibleCount = viewCounts[listView];
  const entityTabs = <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel="Tipo de asignación" style={{ flexGrow: 0 }} contentContainerStyle={styles.entityTabs}>
    {listViews.map((item) => <Pressable key={item.value} accessibilityRole="tab"
      accessibilityLabel={`${item.label}${hasDataCount() ? `, ${viewCounts[item.value]} coincidencias` : ""}`}
      accessibilityState={{ selected: listView === item.value, disabled: busy }} disabled={busy}
      onPress={() => selectListView(item.value)} style={[styles.entityTab, listView === item.value && styles.segmentSelected]}>
      <Text style={[styles.entityTabText, listView === item.value && styles.segmentTextSelected]}>{item.label}</Text>
    </Pressable>)}
  </ScrollView>;
  function hasDataCount(): boolean { return data !== null && !coveragePending && !partial; }

  const sections = useMemo(() => buildSections(filteredEntries, view === "agenda"), [filteredEntries, view]);
  const remaining = counts.total - counts.completed;
  const hasData = data !== null;
  const isFiltered = query.trim().length > 0 || filter !== "all";
  const heroTitle = coveragePending ? "Verificando datos locales" : partial ? "Cobertura parcial" : !hasData
    ? loading ? "Preparando tu jornada" : "Tu jornada, en un solo lugar"
    : counts.total === 0 ? emptyOrders.length > 0 ? `${emptyOrders.length} ${emptyOrders.length === 1 ? "orden asignada" : "órdenes asignadas"}` : "Todo listo para tu próxima tarea"
      : remaining === 0 ? emptyOrders.some((group) => group.status !== "completed" && group.status !== "delivered") ? "Órdenes pendientes de trabajos" : "Buen trabajo. Todo completado."
        : `${remaining} ${remaining === 1 ? "tarea por completar" : "tareas por completar"}`;
  const heroDescription = coveragePending ? "La cobertura y los pendientes aún no están verificados."
    : partial ? "Faltan días por descargar; no significan cero tareas."
    : !hasData
    ? "Consulta tus asignaciones y organiza tu trabajo en campo."
    : counts.total === 0 ? emptyOrders.length > 0 ? "Pendientes de incorporar trabajos." : "No hay tareas asignadas para el período seleccionado."
      : `${counts.completed} de ${counts.total} ${counts.total === 1 ? "tarea completada" : "tareas completadas"}.`;

  function navigateWeek(offset: number): void {
    if (busy || loading) return;
    setDaySelection(null);
    const date = shiftDate(displayedWeek.startDate, offset * 7);
    if (view === "today") setWeekSelection({ scope: scopeKey, date });
    else onRangeChange(weekRange(date));
  }

  function selectDay(day: string): void {
    if (busy || loading) return;
    if (view === "today") onRangeChange(dailyRange(day));
    else {
      setDaySelection(selectedDay === day ? null : { scope: scopeKey, date: day });
      onFocusDate?.(day);
    }
  }

  function clearFilters(): void {
    setQuery("");
    setFilter("all");
  }

  function selectListView(value: AssignmentListView): void {
    preferenceChanged.current = true;
    setListView(value);
    setPreferenceError(null);
    preferenceWrites.current = preferenceWrites.current.then(() => AsyncStorage.setItem(listViewStorageKey, value)).catch(() => {
      if (mounted.current) setPreferenceError("La vista cambió, pero no se pudo guardar la preferencia en este dispositivo.");
    });
  }

  function openTimer(timer: RunningTimerNoticeItem): void {
    if (busy || loading) return;
    const group = data?.groups.find((item) => item.id === timer.groupId);
    const work = group?.works.find((item) => item.id === timer.workId);
    if (group && work) onOpenWork(group, work);
  }

  const layoutSelector = view === "agenda" ? <View testID="agenda-layout-selector" style={[styles.segmented, compact && styles.compactSegments]} accessibilityRole="tablist" accessibilityLabel="Presentación de agenda">
    {(["schedule", "list"] as const).map((layout) => <Pressable key={layout} accessibilityRole="tab" accessibilityLabel={layout === "schedule" ? compact ? "Agenda cronológica" : "Horario semanal" : "Lista de agenda"} accessibilityState={{ selected: agendaLayout === layout, disabled: busy }} aria-selected={agendaLayout === layout} disabled={busy} onPress={() => setAgendaLayout(layout)} style={[styles.segment, compact && styles.compactSegment, agendaLayout === layout && styles.segmentSelected]}>
      <Ionicons name={layout === "schedule" ? "calendar-outline" : "list-outline"} size={18} color={agendaLayout === layout ? palette.white : palette.textSecondary} />
      <Text style={[styles.segmentText, agendaLayout === layout && styles.segmentTextSelected]}>{layout === "schedule" ? compact ? "Agenda" : "Horario" : compact ? "Filtros / OTs" : "Lista"}</Text>
    </Pressable>)}
  </View> : null;

  if (view === "agenda" && agendaLayout === "schedule" && listView === "works") {
    const content = <>
    {entityTabs}
    {!compact ? layoutSelector : null}
    <View style={styles.weekNavigation}>
      <IconButton name="chevron-back-outline" label="Semana anterior" disabled={busy || loading} onPress={() => navigateWeek(-1)} />
      <Text style={[styles.weekRange, { flex: 1 }]}>{compact ? `${shortDate(displayedWeek.startDate)} – ${shortDate(displayedWeek.endDate)}` : weekLabel}</Text>
      <IconButton name="chevron-forward-outline" label="Semana siguiente" disabled={busy || loading} onPress={() => navigateWeek(1)} />
      {compact ? <IconButton name="options-outline" label="Filtros y OTs de agenda" disabled={busy} onPress={() => setAgendaLayout("list")} /> : null}
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.preferenceError}>{error} La carga visible puede no estar actualizada.</Text> : null}
    {!data || coveragePending ? coverageNotice : null}
    {loading ? <View style={styles.loading}><ActivityIndicator color={palette.primary} /><Text style={styles.loadingText}>Actualizando agenda…</Text></View> : null}
    {runningTimersFromSnapshot(data).length > 0 ? <Pressable accessibilityRole="button" onPress={() => setAgendaLayout("list")} style={styles.textButton}><Text style={styles.textButtonLabel}>Hay cronómetros activos · revisar en Lista</Text></Pressable> : null}
    {data && !coveragePending ? <WeeklySchedule data={data} range={range} unavailableDates={unavailableDates} selectedDate={focusDate} onSelectDate={onFocusDate} onOpenWork={onOpenWork} busy={busy || loading} timezone={user.system.timezone} /> : !loading && !coveragePending ? <EmptyState title="Horario no disponible" message="Actualiza para cargar tus trabajos planificados de la semana." /> : null}
    </>;
    return compact ? <ScrollView style={styles.screen} contentContainerStyle={styles.mobileSchedule} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={palette.primary} colors={[palette.primary]} progressBackgroundColor={palette.surface} />}>{content}</ScrollView> : <View style={styles.desktopSchedule}>{content}</View>;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={palette.primary} colors={[palette.primary]} progressBackgroundColor={palette.surface} />}
    >
      {layoutSelector}
      {coverageNotice}
      <View testID="day-overview-heading" style={styles.heading}>
        <Text accessibilityRole="header" style={styles.pageTitle}>{view === "today" ? "Mi jornada" : "Mi agenda"}</Text>
        <Text style={styles.greeting}>{firstName ? `Hola, ${firstName}.` : "Hola."}</Text>
      </View>

      <LinearGradient testID="day-summary" colors={[palette.navy, "#174C57"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <Text style={styles.heroTitle}>{heroTitle}</Text>
        <Text style={styles.heroDescription}>{heroDescription}</Text>
        <View style={styles.heroBottom}>
          <View style={styles.heroStat}>
            <Ionicons name="calendar-outline" size={14} color={palette.onDark} accessible={false} />
            <Text accessibilityLabel={selectedDay ? fullDate(selectedDay) : rangeLabel} style={styles.heroStatText}>{selectedDay ? `${shortDate(selectedDay)} · ${selectedDay.slice(0, 4)}` : rangeLabel}</Text>
          </View>
          {hasData && !coveragePending ? <View style={styles.heroStat}><Ionicons name="time-outline" size={14} color={palette.onDark} accessible={false} /><Text style={styles.heroStatText}>{partial && counts.total === 0 ? "Carga no disponible" : `${duration(counts.minutes)} planificadas${partial ? " · parcial" : ""}`}</Text></View> : null}
        </View>
      </LinearGradient>

      <View testID="day-kpis" style={styles.kpiRow}>
        <Kpi title="Pendientes" value={hasData && !coveragePending && (!partial || counts.pending > 0) ? counts.pending : null} note={partial ? "Parcial" : null} icon="hourglass-outline" tone="warning" />
        <Kpi title="En curso" value={hasData && !coveragePending && (!partial || counts.active > 0) ? counts.active : null} note={partial ? "Parcial" : counts.paused > 0 ? `${counts.paused} en pausa` : null} icon="pulse-outline" tone="teal" />
        <Kpi title="Completadas" value={hasData && !coveragePending && (!partial || counts.completed > 0) ? counts.completed : null} note={partial ? "Parcial" : counts.delivered > 0 ? `${counts.delivered} entregadas` : null} icon="checkmark-done-outline" tone="success" />
      </View>

      <RunningTimersNotice data={data} selectedRangeLabel={rangeLabel} serverRemindersReady={serverRemindersReady} onOpen={openTimer} />

      <View testID="week-selector">
      <Card style={styles.weekCard}>
        <View style={styles.weekNavigation}>
          <Pressable accessibilityRole="button" accessibilityLabel="Semana anterior" accessibilityState={{ disabled: busy || loading }} disabled={busy || loading} onPress={() => navigateWeek(-1)} style={({ pressed }) => [styles.weekButton, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}>
            <Ionicons name="chevron-back-outline" size={22} color={palette.primary} accessible={false} />
          </Pressable>
          <View style={styles.weekHeaderContent}>
          <Text accessibilityLabel={`${fullDate(displayedWeek.startDate)} – ${fullDate(displayedWeek.endDate)}`} style={[styles.weekRange, styles.weekCaption]}>{compactWeekLabel}</Text>
          {view === "agenda" ? <Pressable accessibilityRole="button" accessibilityLabel="Mostrar todas las tareas de la semana" accessibilityState={{ selected: selectedDay === null, disabled: busy || loading }} disabled={busy || loading} onPress={() => { if (!busy && !loading) setDaySelection(null); }} style={({ pressed }) => [styles.weekButton, styles.allWeekButton, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}>
            <Text style={styles.weekActionLabel}>{"Toda\nsemana"}</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={view === "today" ? "Ir a hoy" : "Ir a la semana actual"} accessibilityState={{ disabled: busy || loading }} disabled={busy || loading} onPress={() => { if (busy || loading) return; setDaySelection(null); setWeekSelection(null); onRangeChange(view === "today" ? dailyRange(today) : weekRange(today)); }} style={({ pressed }) => [styles.weekButton, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}>
            <Text style={styles.weekActionLabel}>Hoy</Text>
          </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Semana siguiente" accessibilityState={{ disabled: busy || loading }} disabled={busy || loading} onPress={() => navigateWeek(1)} style={({ pressed }) => [styles.weekButton, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}>
            <Ionicons name="chevron-forward-outline" size={22} color={palette.primary} accessible={false} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekScroll} contentContainerStyle={styles.weekDays}>
          {days.map((day) => {
            const selected = selectedDay === day;
            const isToday = day === today;
            const unavailable = unavailableWeekDates.includes(day);
            const local = unavailable && (data?.groups ?? []).some((group) => group.works.some((work) => isPendingLocalWork(work) && assignmentIncludesDay(work, day)));
            const disabled = busy || loading || (unavailable && !local);
            const date = new Date(`${day}T12:00:00`);
            return (
              <Pressable
                key={day}
                onPress={() => selectDay(day)}
                accessibilityRole="button"
                accessibilityLabel={`${fullDate(day)}${isToday ? ", hoy" : ""}${unavailable ? local ? ", solo local, sin copia del servidor" : ", sin copia" : ""}`}
                accessibilityHint={view === "today" ? "Consulta este día y sus pendientes anteriores." : "Muestra este día y sus pendientes anteriores. Pulsa de nuevo para ver la semana."}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                style={({ pressed }) => [styles.day, isToday && styles.dayToday, unavailable && styles.dayUnavailable, selected && styles.daySelected, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}
              >
                <Text style={[styles.dayName, selected && styles.dayTextSelected]}>{date.toLocaleDateString("es-CL", { weekday: "short" }).replace(".", "")}</Text>
                <Text style={[styles.dayNumber, isToday && styles.dayNumberToday, selected && styles.dayTextSelected]}>{date.getDate()}</Text>
                {unavailable ? <Text style={[styles.dayCoverage, selected && styles.dayTextSelected]}>{local ? "solo local" : "Sin copia"}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Card>
      </View>

      <View style={styles.taskHeading}>
        <SectionTitle title={view === "agenda" ? "Agenda de trabajo" : "Mis asignaciones"} />
        {hasData && !coveragePending ? <Text style={styles.listCount}>{visibleCount} {listView === "works" ? "trabajos" : listView === "maintenances" ? "mantenimientos" : "OTs"}{partial ? " · parcial" : ""}</Text> : null}
      </View>

      {entityTabs}
      {preferenceError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.preferenceError}>{preferenceError}</Text> : null}

      <View style={[styles.search, searchFocused && styles.searchFocused]}>
        <Ionicons name="search-outline" size={21} color={palette.textMuted} accessible={false} />
        <TextInput
          accessibilityLabel="Buscar tareas"
          accessibilityHint="Busca por tarea, código, equipo, ubicación o cliente."
          placeholder="Buscar tarea, código o equipo"
          placeholderTextColor={palette.textMuted}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          selectionColor={palette.primary}
          style={styles.searchInput}
        />
        {query ? <IconButton name="close-outline" label="Borrar búsqueda" onPress={() => setQuery("")} /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
        {filters.map((item) => (
          <Pressable key={item.value} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: filter === item.value }} onPress={() => setFilter(item.value)} style={({ pressed }) => [styles.filter, filter === item.value && styles.filterSelected, pressed && styles.pressed]}>
            <Text style={[styles.filterText, filter === item.value && styles.filterTextSelected]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {filter === "in_progress" ? <Text style={styles.filterNote}>Incluye tareas en pausa; cada tarjeta muestra su estado real.</Text> : filter === "completed" ? <Text style={styles.filterNote}>Incluye tareas completadas y entregadas.</Text> : null}

      {error ? (
        <Card style={styles.errorCard}>
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorContent}>
            <Ionicons name="cloud-offline-outline" size={24} color={palette.danger} accessible={false} />
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>{hasData ? "No se pudo actualizar la jornada" : "No se pudieron cargar tus tareas"}</Text>
              <Text style={styles.errorMessage}>{error}</Text>
              {hasData ? <Text style={styles.errorMessage}>La información visible puede no estar actualizada.</Text> : null}
            </View>
          </View>
          <Button title="Reintentar" variant="secondary" icon="refresh-outline" onPress={onRefresh} loading={loading} />
        </Card>
      ) : null}
      {loading ? (
        <View accessibilityLiveRegion="polite" accessibilityState={{ busy: true }} style={[styles.loading, !hasData && styles.initialLoading]}>
          <ActivityIndicator color={palette.primary} size={hasData ? "small" : "large"} />
          <Text style={styles.loadingText}>{hasData ? "Actualizando asignaciones…" : "Cargando tus asignaciones…"}</Text>
        </View>
      ) : null}

      {hasData && visibleCount > 0 ? listView !== "works" ? <View style={styles.section}>
        {visibleOrders.map((group) => <AssignmentOrderCard key={groupKey(group)} group={group} matchingWorkCount={group.works.length} busy={busy} onOpenGroup={onOpenGroup} />)}
      </View> : sections.map((section) => (
        <View key={section.key} style={styles.section}>
          {section.date !== null ? (
            <View style={styles.agendaDate}>
              <View style={styles.agendaDateIcon}><Ionicons name="calendar-outline" size={18} color={palette.primary} accessible={false} /></View>
              <Text accessibilityRole="header" style={styles.agendaDateText}>{fullDate(section.date)}</Text>
              {section.date === today ? <Badge label="Hoy" tone="teal" /> : null}
            </View>
          ) : null}
          {section.entries.map(({ group, work }) => <AssignmentWorkCard key={JSON.stringify([group.type, group.id, work.workType, work.id, work.scheduledDate])} group={group} work={work} queryDate={assignmentWorkQueryRange(work, range).startDate} companyBranchId={companyBranchId} onOpenWork={onOpenWork} onWorkStatus={onWorkStatus} busy={busy} generatedAt={data.generatedAt} offline={offline} online={offline?.online ?? !coveragePending} staleReadOnly={coveragePending || offline?.authBlocked === true || isPendingLocalWork(work)} />)}
        </View>
      )) : hasData && !loading && !error ? (
        <Card>
          <EmptyState title={coveragePending ? "Verificando copia local" : partial ? "Sin tareas en la copia disponible" : isFiltered ? "No encontramos coincidencias" : "Sin tareas para este período"} message={coveragePending ? "Espera a recuperar el estado local; no se presume vacío." : partial ? "Cobertura parcial: faltan días por descargar. No se puede confirmar que no haya asignaciones." : isFiltered ? "Prueba otro estado o busca por código, equipo o cliente." : selectedDay ? "No tienes asignaciones para este día. Puedes consultar el resto de la semana." : "Aquí aparecerán tus próximas asignaciones. Puedes revisar otra semana o actualizar la información."} icon={isFiltered ? "search-outline" : "calendar-clear-outline"} />
          {isFiltered ? <Button title="Limpiar filtros" variant="secondary" onPress={clearFilters} /> : selectedDay && view === "agenda" ? <Button title="Ver toda la semana" variant="secondary" onPress={() => setDaySelection(null)} /> : <Button title="Actualizar" variant="secondary" icon="refresh-outline" onPress={onRefresh} />}
        </Card>
      ) : !hasData && !loading && !error ? (
        <Card><EmptyState title="Consulta tus asignaciones" message="Carga tu jornada para ver las tareas programadas y su avance." /><Button title="Cargar tareas" onPress={onRefresh} icon="refresh-outline" /></Card>
      ) : null}
      <Text style={styles.footerNote}>Desliza hacia abajo para actualizar tu jornada</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  entityTabs: { flexGrow: 1, padding: 3, gap: 3, borderRadius: 6, backgroundColor: palette.surface },
  entityTab: { flexGrow: 1, minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 7, paddingVertical: 8, borderRadius: 6 },
  entityTabText: { fontSize: 13, lineHeight: 18, fontWeight: "700", color: palette.textSecondary, textAlign: "center" },
  mobileSchedule: { padding: 12, gap: 8 },
  desktopSchedule: { flex: 1, minHeight: 0, padding: 14, gap: 8 },
  compactSegments: { padding: 2, gap: 2, alignSelf: "stretch", width: "100%", flexGrow: 0, flexShrink: 0 },
  compactSegment: { minHeight: 44, paddingVertical: 6, paddingHorizontal: 12, gap: 6 },
  screen: { flex: 1, backgroundColor: palette.background },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 96, gap: 12 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 6 },
  pageTitle: { fontSize: 24, lineHeight: 30, fontWeight: "800", color: palette.navy },
  greeting: { fontSize: 13, lineHeight: 19, color: palette.textSecondary },
  hero: { borderRadius: radius.md, padding: 14, gap: 4 },
  heroTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: palette.white },
  heroDescription: { fontSize: 13, lineHeight: 18, color: palette.onDark },
  heroBottom: { marginTop: 4, gap: 6, flexDirection: "row", flexWrap: "wrap", columnGap: 14 },
  heroStat: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  heroStatText: { ...typography.caption, color: palette.onDark, flexShrink: 1 },
  kpiRow: { flexDirection: "row", gap: 8 },
  kpi: { flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 6, gap: 2, borderRadius: radius.md },
  kpiTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  kpiIcon: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  kpiValue: { fontSize: 22, lineHeight: 27, fontWeight: "800", color: palette.navy, fontVariant: ["tabular-nums"] },
  kpiTitle: { fontSize: 12, lineHeight: 18, fontWeight: "700", color: palette.text },
  kpiNote: { fontSize: 11, lineHeight: 16, color: palette.textMuted },
  weekCard: { padding: 8, gap: 4 },
  weekNavigation: { flexDirection: "row", alignItems: "center", gap: 4 },
  weekHeaderContent: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 4 },
  weekCaption: { flexGrow: 1, flexShrink: 1, flexBasis: 64, minWidth: 64 },
  weekRange: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  weekButton: { minWidth: 44, minHeight: 44, padding: 4, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  allWeekButton: { flexShrink: 0 },
  weekActionLabel: { ...typography.caption, fontWeight: "700", color: palette.primary, textAlign: "center", flexShrink: 1 },
  weekScroll: { flexGrow: 0 },
  weekDays: { flexGrow: 1 },
  day: { minWidth: 44, minHeight: 52, flexGrow: 1, flexShrink: 0, flexBasis: "auto", alignItems: "center", justifyContent: "center", paddingHorizontal: 2, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: "transparent" },
  dayToday: { borderColor: "#C4E1DC", backgroundColor: palette.primarySoft },
  dayUnavailable: { borderColor: palette.amber, backgroundColor: palette.amberSoft },
  dayDisabled: { opacity: 0.55 },
  daySelected: { backgroundColor: palette.primary, borderColor: palette.primary },
  dayName: { ...typography.caption, color: palette.textSecondary },
  dayCoverage: { fontSize: 10, lineHeight: 14, color: palette.amber, textAlign: "center", alignSelf: "stretch" },
  dayNumber: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: palette.text },
  dayNumberToday: { color: palette.primary },
  dayTextSelected: { color: palette.white },
  textButton: { minHeight: 44, paddingHorizontal: 9, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.sm },
  textButtonLabel: { ...typography.caption, fontWeight: "700", color: palette.primary },
  taskHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 4 },
  listCount: { ...typography.caption, color: palette.textSecondary, flexShrink: 1 },
  segmented: { flexDirection: "row", padding: 4, gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.track },
  segment: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 48, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  segmentSelected: { backgroundColor: palette.navy },
  segmentText: { ...typography.label, fontWeight: "700", color: palette.textSecondary, flexShrink: 1 },
  segmentTextSelected: { color: palette.white },
  preferenceError: { ...typography.caption, color: palette.amber },
  coverageWarning: { ...typography.caption, color: palette.amber, backgroundColor: palette.amberSoft, borderRadius: radius.sm, padding: 8 },
  search: { minHeight: 56, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 4, gap: 10 },
  searchFocused: { borderColor: palette.primary },
  searchInput: { flex: 1, minWidth: 0, minHeight: 54, paddingVertical: 14, fontSize: 15, color: palette.text },
  filters: { gap: 8, paddingVertical: 2 },
  filter: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 17, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  filterSelected: { borderColor: palette.navy, backgroundColor: palette.navy },
  filterText: { ...typography.label, fontSize: 13, color: palette.textSecondary },
  filterTextSelected: { color: palette.white },
  filterNote: { ...typography.caption, color: palette.textSecondary, marginTop: -10 },
  section: { gap: 20 },
  agendaDate: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingTop: 8 },
  agendaDateIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" },
  agendaDateText: { ...typography.label, color: palette.text, flex: 1, textTransform: "capitalize" },
  errorCard: { borderColor: "#F2CBCF", gap: 16 },
  errorContent: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  errorCopy: { flex: 1, gap: 6 },
  errorTitle: { ...typography.label, color: palette.danger, fontWeight: "700" },
  errorMessage: { ...typography.body, fontSize: 13, lineHeight: 20, color: palette.textSecondary },
  loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 8 },
  initialLoading: { minHeight: 180, flexDirection: "column", borderRadius: radius.lg, backgroundColor: palette.surface },
  loadingText: { ...typography.label, color: palette.textSecondary },
  pressed: { opacity: 0.72 },
  footerNote: { ...typography.caption, color: palette.textMuted, textAlign: "center", paddingTop: 8 },
});
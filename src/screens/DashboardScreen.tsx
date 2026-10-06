import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { matchesAssignmentSearch, matchesOrderSearch } from "../domain/assignmentCodes";
import { assignmentDay, assignmentDays, assignmentExecutedMinutes, assignmentIncludesDay, assignmentPlannedMinutes, assignmentWorkForDay, manHours, assignmentWorkQueryRange, dailyRange } from "../domain/assignmentSchedule";
import { dateKey, isFinished, monthRange, shiftDate, shortDate, weekRange } from "../domain/format";
import type { AssignmentGroup, Assignments, AssignmentWork, DateRange, StatusInput, User, WorkOpenOptions } from "../domain/models";
import type { OfflineSnapshot } from "../domain/offline";
import { Badge, Button, Card, EmptyState, IconButton, SectionTitle, type IconName } from "../ui/components";
import { palette, radius, theme, typography } from "../ui/theme";
import { AssignmentOrderCard } from "./orders/AssignmentOrderCard";
import { AssignmentWorkCard } from "./orders/AssignmentWorkCard";
import { fullDate } from "./orders/assignmentPresentation";
import { WeeklySchedule } from "./schedule/WeeklySchedule";
import { AgendaTimeline } from "./schedule/AgendaTimeline";
import { RunningTimersNotice } from "./notifications/RunningTimersNotice";
import { runningTimersFromSnapshot, type RunningTimerNoticeItem } from "../notifications/runningTimers";
import { isPendingLocalWork, unavailableCoverageDates } from "./offline/offlineDashboardUi";

export interface DashboardScreenProps {
  data: Assignments | null;
  user: User;
  range: DateRange;
  loading: boolean;
  pendingDates?: string[];
  error: string | null;
  onRefresh: () => void;
  onRangeChange: (range: DateRange) => void;
  onOpenWork: (group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions) => void;
  onOpenGroup: (group: AssignmentGroup, initialTab?: "works" | "files" | "deliver") => void;
  onWorkStatus: (group: AssignmentGroup, work: AssignmentWork, input: StatusInput) => Promise<void>;
  busy?: boolean;
  serverRemindersReady?: boolean;
  offline?: OfflineSnapshot | null;
  companyBranchId?: number;
  focusDate?: string | null;
  onFocusDate?: (date: string) => void;
  view: "today" | "agenda";
  /** El buscador se despliega desde la lupa de la cabecera; con texto escrito sigue visible. */
  searchOpen?: boolean;
  /** Búsqueda controlada desde la cabecera: si se entrega, la pantalla no muestra su propio buscador. */
  query?: string;
  onQueryChange?: (query: string) => void;
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

function Kpi({ title, value, note, icon, tone, inline = false }: { title: string; value: number | string | null; note: string | null; icon: IconName; tone: "warning" | "teal" | "success" | "violet" | "info"; inline?: boolean }) {
  const color = tone === "warning" ? palette.amber : tone === "success" ? palette.success : tone === "violet" ? palette.violet : tone === "info" ? palette.info : palette.primary;
  const background = tone === "warning" ? palette.amberSoft : tone === "success" ? palette.successSoft : tone === "violet" ? palette.violetSoft : tone === "info" ? palette.infoSoft : palette.primarySoft;
  // En una sola línea: ícono, cantidad y texto (para las HH).
  if (inline) return <Card style={styles.kpiInline}>
    <View style={[styles.kpiIcon, { backgroundColor: background }]}><Ionicons name={icon} size={15} color={color} accessible={false} /></View>
    <Text style={styles.kpiInlineValue}>{value ?? "—"}</Text>
    <Text numberOfLines={1} style={styles.kpiInlineTitle}>{title}{note ? ` · ${note}` : ""}</Text>
  </Card>;
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

export function DashboardScreen({ data, user, range, loading, pendingDates, error, onRefresh, onRangeChange, onOpenWork, onOpenGroup, onWorkStatus, busy = false, serverRemindersReady = false, offline, companyBranchId, focusDate, onFocusDate, view, searchOpen = false, query: externalQuery, onQueryChange }: DashboardScreenProps) {
  const compact = useWindowDimensions().width < 600;
  const [agendaLayout, setAgendaLayout] = useState<"timeline" | "schedule" | "list">("timeline");
  const [agendaMode, setAgendaMode] = useState<"day" | "week" | "month">(() => range.startDate === monthRange(range.startDate).startDate && range.endDate === monthRange(range.startDate).endDate ? "month" : "week");
  const [localQuery, setLocalQuery] = useState("");
  const query = externalQuery ?? localQuery;
  const setQuery = onQueryChange ?? setLocalQuery;
  const headerSearch = onQueryChange !== undefined;
  const [filter, setFilter] = useState<StatusFilter[]>(() => view === "today" ? ["pending", "in_progress"] : ["all"]);
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
  const unavailableDates = [...new Set([...unavailableCoverageDates(offline, range, companyBranchId), ...(view === "agenda" ? pendingDates ?? (!data ? assignmentDays(range) : []) : [])])];
  const unavailableWeekDates = unavailableCoverageDates(offline, displayedWeek, companyBranchId);
  const partial = (selectedDay ? unavailableWeekDates.includes(selectedDay) : unavailableDates.length > 0);
  const coveragePending = offline === null;
  const coverageNotice = unavailableDates.length > 0
    ? <Text accessibilityRole="alert" style={styles.coverageWarning}>{unavailableDates.length} días no descargados · no es carga cero</Text>
    : coveragePending ? <Text style={styles.preferenceError}>Verificando copia local…</Text> : null;

  useEffect(() => {
    setFilter(view === "today" ? ["pending", "in_progress"] : ["all"]);
    if (view === "agenda") {
      setAgendaLayout("timeline");
      if (range.startDate !== monthRange(range.startDate).startDate || range.endDate !== monthRange(range.startDate).endDate) setAgendaMode("week");
    }
  }, [view]);

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
      executedMinutes: works.reduce((sum, work) => sum + (selectedDay ? Math.max(0, work.executedMinutes) : assignmentExecutedMinutes(work)), 0),
    };
  }, [scopedEntries, selectedDay]);

  const searchedEntries = useMemo(() => scopedEntries.filter(({ group, work }) => matchesAssignmentSearch(group, work, query)), [scopedEntries, query]);
  const filteredEntries = useMemo(() => searchedEntries.filter(({ work }) => filter.some(status => matchesStatus(work, status))), [searchedEntries, filter]);
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
  const searchedOrders = scopedOrders.filter((group) => matchesOrderSearch(group, query));
  const filteredOrders = searchedOrders.filter((group) => filter.some(status => matchesStatus(group, status)));
  const filteredMaintenances = filteredOrders.filter((group) => group.type === "internal_maintenance");
  const filteredWorkOrders = filteredOrders.filter((group) => group.type === "external_ot");
  const visibleOrders = listView === "maintenances" ? filteredMaintenances : filteredWorkOrders;
  const viewCounts = { works: filteredEntries.length, maintenances: filteredMaintenances.length, orders: filteredWorkOrders.length };
  const statusItems = listView === "works" ? searchedEntries.map(entry => entry.work)
    : searchedOrders.filter(group => group.type === (listView === "maintenances" ? "internal_maintenance" : "external_ot"));
  const statusCounts = {
    all: statusItems.length,
    pending: statusItems.filter(item => matchesStatus(item, "pending")).length,
    in_progress: statusItems.filter(item => matchesStatus(item, "in_progress")).length,
    completed: statusItems.filter(item => matchesStatus(item, "completed")).length,
  };
  function countLabel(count: number): string {
    if (data === null || coveragePending || (partial && count === 0)) return "—";
    return `${count}${partial ? "+" : ""}`;
  }
  function countHint(count: number): string {
    if (data === null || coveragePending) return "Cantidad no disponible";
    if (partial) return count > 0 ? `Al menos ${count} coincidencias; cobertura parcial` : "Cantidad no confirmada; cobertura parcial";
    return `${count} coincidencias`;
  }
  const visibleCount = viewCounts[listView];
  const entityTabs = <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel="Tipo de asignación" style={{ flexGrow: 0 }} contentContainerStyle={styles.entityTabs}>
    {listViews.map((item) => <Pressable key={item.value} accessibilityRole="tab"
      accessibilityLabel={`${item.label}${hasDataCount() ? `, ${viewCounts[item.value]} coincidencias` : ""}`}
      accessibilityHint={countHint(viewCounts[item.value])}
      accessibilityState={{ selected: listView === item.value, disabled: busy }} disabled={busy}
      onPress={() => selectListView(item.value)} style={[styles.entityTab, listView === item.value && styles.segmentSelected]}>
      <Text style={[styles.entityTabText, listView === item.value && styles.segmentTextSelected]}>{item.label}</Text>
      <Text testID={`assignment-type-count-${item.value}`} style={[styles.countBadge, listView === item.value && styles.countBadgeSelected]}>{countLabel(viewCounts[item.value])}</Text>
    </Pressable>)}
  </ScrollView>;
  function hasDataCount(): boolean { return data !== null && !coveragePending && !partial; }

  const sections = useMemo(() => buildSections(filteredEntries, view === "agenda"), [filteredEntries, view]);
  const hasData = data !== null;
  const isFiltered = query.trim().length > 0 || !filter.includes("all");

  function navigateWeek(offset: number): void {
    if (busy || (view !== "agenda" && loading)) return;
    setDaySelection(null);
    if (view === "agenda" && agendaMode === "month") {
      onRangeChange(monthRange(shiftDate(offset < 0 ? range.startDate : range.endDate, offset < 0 ? -1 : 1)));
      return;
    }
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

  function changeAgendaMode(mode: "day" | "week" | "month", selectedDate?: string): void {
    if (busy) return;
    const day = selectedDate ?? focusDate ?? (today >= range.startDate && today <= range.endDate ? today : range.startDate);
    setAgendaMode(mode);
    setDaySelection(null);
    const next = mode === "month" ? monthRange(day) : weekRange(day);
    if (next.startDate < range.startDate || next.endDate > range.endDate) onRangeChange(next);
  }

  function clearFilters(): void {
    setQuery("");
    setFilter(["all"]);
  }

  function toggleFilter(value: StatusFilter): void {
    if (busy) return;
    setFilter(current => {
      if (value === "all") return ["all"];
      const selected = current.filter(status => status !== "all");
      const next = selected.includes(value) ? selected.filter(status => status !== value) : [...selected, value];
      return next.length === 0 || next.length === 3 ? ["all"] : next;
    });
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

  if (view === "agenda" && agendaLayout === "timeline") {
    return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={palette.primary} colors={[palette.primary]} progressBackgroundColor={palette.surface} />}>
      {coverageNotice}
      {error ? <Text accessibilityRole="alert" style={styles.preferenceError}>{error} La carga visible puede no estar actualizada.</Text> : null}
      <AgendaTimeline data={data} range={range} today={today} busy={busy} loading={loading} query={query} onRangeChange={onRangeChange}
        onOpenWork={(group, work) => onOpenWork(group, work)} onOpenCalendar={() => setAgendaLayout("schedule")} onOpenFilters={() => setAgendaLayout("list")} />
    </ScrollView>;
  }

  if (view === "agenda" && agendaLayout === "schedule") {
    const calendarData: Assignments = data ?? { generatedAt: "", technician: { id: user.workerId, name: user.name, allowEditExecutionTime: false }, groups: [], summary: { totalGroups: 0, totalWorks: 0, activeWorks: 0, overdueWorks: 0, plannedMinutes: 0 } };
    const calendarWeek = weekRange(focusDate && focusDate >= range.startDate && focusDate <= range.endDate ? focusDate : today >= range.startDate && today <= range.endDate ? today : range.startDate);
    const content = <>
    {!compact ? layoutSelector : null}
    <View style={styles.weekNavigation}>
      <IconButton name="list-circle-outline" label="Volver a la agenda" disabled={busy} onPress={() => setAgendaLayout("timeline")} />
      <IconButton name="chevron-back-outline" label={agendaMode === "month" ? "Mes anterior" : "Semana anterior"} disabled={busy} onPress={() => agendaMode === "month" ? navigateWeek(-1) : onRangeChange(weekRange(shiftDate(calendarWeek.startDate, -7)))} />
      <Text style={[styles.weekRange, { flex: 1 }]}>{agendaMode === "month" ? new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${range.startDate}T12:00:00Z`)) : `${shortDate(calendarWeek.startDate)} – ${shortDate(calendarWeek.endDate)}`}</Text>
      <IconButton name="chevron-forward-outline" label={agendaMode === "month" ? "Mes siguiente" : "Semana siguiente"} disabled={busy} onPress={() => agendaMode === "month" ? navigateWeek(1) : onRangeChange(weekRange(shiftDate(calendarWeek.startDate, 7)))} />
      <IconButton name="today-outline" label="Volver a hoy" disabled={busy} onPress={() => { const next = agendaMode === "month" ? monthRange(today) : weekRange(today); if (next.startDate < range.startDate || next.endDate > range.endDate) onRangeChange(next); else onFocusDate?.(today); }} />
      {compact ? <IconButton name="options-outline" label="Filtros y OTs de agenda" disabled={busy} onPress={() => setAgendaLayout("list")} /> : null}
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.preferenceError}>{error} La carga visible puede no estar actualizada.</Text> : null}
    {!data || coveragePending ? coverageNotice : null}
    {loading ? <View style={styles.loading}><ActivityIndicator color={palette.primary} /><Text style={styles.loadingText}>Actualizando agenda…</Text></View> : null}
    {runningTimersFromSnapshot(data).length > 0 ? <Pressable accessibilityRole="button" onPress={() => setAgendaLayout("list")} style={styles.textButton}><Text style={styles.textButtonLabel}>Hay cronómetros activos · revisar en Lista</Text></Pressable> : null}
    {!coveragePending ? <WeeklySchedule data={calendarData} range={range} viewMode={agendaMode} onViewModeChange={changeAgendaMode} unavailableDates={unavailableDates} selectedDate={focusDate} onSelectDate={onFocusDate} onOpenWork={onOpenWork} onOpenGroup={onOpenGroup} busy={busy} timezone={user.system.timezone} /> : null}
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
      {view === "agenda" ? <Button title="Volver a la agenda" icon="arrow-back-outline" variant="ghost" disabled={busy} onPress={() => setAgendaLayout("timeline")} style={styles.agendaBack} /> : null}
      {layoutSelector}
      {coverageNotice}
      {!headerSearch && (searchOpen || query) ? <View style={[styles.search, searchFocused && styles.searchFocused]}>
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
          autoFocus={searchOpen && !query}
          selectionColor={palette.primary}
          style={styles.searchInput}
        />
        {query ? <IconButton name="close-outline" label="Borrar búsqueda" onPress={() => setQuery("")} /> : null}
      </View> : null}

      <View testID="day-hours" style={styles.kpiRow}>
        <Kpi inline title="HH asignadas" value={hasData && !coveragePending && (!partial || counts.minutes > 0) ? manHours(counts.minutes) : null} note={partial ? "Parcial" : null} icon="time-outline" tone="violet" />
        <Kpi inline title="HH reportadas" value={hasData && !coveragePending && (!partial || counts.executedMinutes > 0) ? manHours(counts.executedMinutes) : null} note={partial ? "Parcial" : null} icon="stats-chart" tone="info" />
      </View>

      <RunningTimersNotice data={data} selectedRangeLabel={rangeLabel} serverRemindersReady={serverRemindersReady} onOpen={openTimer} />

      <View testID="week-selector">
      <Card style={styles.weekCard}>
        <View style={styles.weekNavigation}>
          <Pressable accessibilityRole="button" accessibilityLabel="Semana anterior" accessibilityState={{ disabled: busy || loading }} disabled={busy || loading} onPress={() => navigateWeek(-1)} hitSlop={6} style={({ pressed }) => [styles.weekButton, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}>
            <Ionicons name="chevron-back-outline" size={22} color={palette.primary} accessible={false} />
          </Pressable>
          <View style={styles.weekHeaderContent}>
          <Text accessibilityLabel={`${fullDate(displayedWeek.startDate)} – ${fullDate(displayedWeek.endDate)}`} style={[styles.weekRange, styles.weekCaption]}>{compactWeekLabel}</Text>
          {view === "agenda" ? <Pressable accessibilityRole="button" accessibilityLabel="Mostrar todas las tareas de la semana" accessibilityState={{ selected: selectedDay === null, disabled: busy || loading }} disabled={busy || loading} onPress={() => { if (!busy && !loading) setDaySelection(null); }} hitSlop={6} style={({ pressed }) => [styles.weekButton, styles.allWeekButton, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}>
            <Text style={styles.weekActionLabel}>{"Toda\nsemana"}</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={view === "today" ? "Ir a hoy" : "Ir a la semana actual"} accessibilityState={{ disabled: busy || loading }} disabled={busy || loading} onPress={() => { if (busy || loading) return; setDaySelection(null); setWeekSelection(null); onRangeChange(view === "today" ? dailyRange(today) : weekRange(today)); }} hitSlop={6} style={({ pressed }) => [styles.weekButton, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}>
            <Text style={styles.weekActionLabel}>Hoy</Text>
          </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Semana siguiente" accessibilityState={{ disabled: busy || loading }} disabled={busy || loading} onPress={() => navigateWeek(1)} hitSlop={6} style={({ pressed }) => [styles.weekButton, pressed && styles.pressed, (busy || loading) && styles.dayDisabled]}>
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

      {entityTabs}
      {preferenceError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.preferenceError}>{preferenceError}</Text> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
        {filters.map((item) => (
          <Pressable key={item.value} accessibilityRole="button" accessibilityLabel={item.label} accessibilityHint={countHint(statusCounts[item.value])} accessibilityState={{ selected: filter.includes(item.value), disabled: busy }} aria-pressed={filter.includes(item.value)} disabled={busy} onPress={() => toggleFilter(item.value)} style={({ pressed }) => [styles.filter, filter.includes(item.value) && styles.filterSelected, pressed && styles.pressed]}>
            <Text style={[styles.filterText, filter.includes(item.value) && styles.filterTextSelected]}>{item.label}</Text>
            <Text testID={`assignment-status-count-${item.value}`} style={[styles.countBadge, filter.includes(item.value) && styles.countBadgeSelected]}>{countLabel(statusCounts[item.value])}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {filter.length === 1 && filter.includes("in_progress") ? <Text style={styles.filterNote}>Incluye tareas en pausa; cada tarjeta muestra su estado real.</Text> : filter.length === 1 && filter.includes("completed") ? <Text style={styles.filterNote}>Incluye tareas completadas y entregadas.</Text> : null}

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
          {section.entries.map(({ group, work }) => <AssignmentWorkCard key={JSON.stringify([group.type, group.id, work.workType, work.id, work.scheduledDate])} currentWorkerId={user.workerId} group={group} work={work} queryDate={assignmentWorkQueryRange(work, range).startDate} companyBranchId={companyBranchId} onOpenWork={onOpenWork} onWorkStatus={onWorkStatus} busy={busy} generatedAt={data.generatedAt} offline={offline} online={offline?.online ?? !coveragePending} staleReadOnly={coveragePending || offline?.authBlocked === true || isPendingLocalWork(work)} />)}
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
  entityTab: { flexGrow: 1, minHeight: 44, flexDirection: "row", gap: 6, justifyContent: "center", alignItems: "center", paddingHorizontal: 7, paddingVertical: 8, borderRadius: 6 },
  entityTabText: { fontSize: 13, lineHeight: 18, fontWeight: "700", color: palette.textSecondary, textAlign: "center" },
  countBadge: { minWidth: 24, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 10, fontSize: 12, lineHeight: 18, fontWeight: "700", fontVariant: ["tabular-nums"], color: palette.primary, backgroundColor: palette.primarySoft, textAlign: "center", flexShrink: 0 },
  countBadgeSelected: { color: palette.navy, backgroundColor: palette.white },
  mobileSchedule: { padding: 12, gap: 8 },
  desktopSchedule: { flex: 1, minHeight: 0, padding: 14, gap: 8 },
  compactSegments: { padding: 2, gap: 2, alignSelf: "stretch", width: "100%", flexGrow: 0, flexShrink: 0 },
  compactSegment: { minHeight: 44, paddingVertical: 6, paddingHorizontal: 12, gap: 6 },
  screen: { flex: 1, backgroundColor: palette.background },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 96, gap: 12 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 6 },
  pageTitle: { fontSize: 24, lineHeight: 30, fontWeight: "800", color: palette.heading },
  greeting: { fontSize: 13, lineHeight: 19, color: palette.textSecondary },
  kpiRow: { flexDirection: "row", gap: 8 },
  agendaBack: { alignSelf: "flex-start", minHeight: 40, paddingVertical: 6, paddingHorizontal: 4 },
  kpiInline: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 7, paddingHorizontal: 8, borderRadius: radius.md },
  kpiInlineValue: { fontSize: 15, lineHeight: 20, fontWeight: "800", color: palette.heading, fontVariant: ["tabular-nums"] },
  kpiInlineTitle: { fontSize: 11, lineHeight: 15, fontWeight: "700", color: palette.text, flexShrink: 1, minWidth: 0 },
  kpi: { flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 6, gap: 2, borderRadius: radius.md },
  kpiTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  kpiIcon: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  kpiValue: { fontSize: 22, lineHeight: 27, fontWeight: "800", color: palette.heading, fontVariant: ["tabular-nums"] },
  kpiTitle: { fontSize: 12, lineHeight: 18, fontWeight: "700", color: palette.text },
  kpiNote: { fontSize: 11, lineHeight: 16, color: palette.textMuted },
  weekCard: { paddingHorizontal: 6, paddingVertical: 4, gap: 0 },
  weekNavigation: { flexDirection: "row", alignItems: "center", gap: 4 },
  weekHeaderContent: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 4 },
  weekCaption: { flexGrow: 1, flexShrink: 1, flexBasis: 64, minWidth: 64 },
  weekRange: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  weekButton: { minWidth: 40, minHeight: 32, paddingHorizontal: 4, paddingVertical: 2, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  allWeekButton: { flexShrink: 0 },
  weekActionLabel: { ...typography.caption, fontWeight: "700", color: palette.primary, textAlign: "center", flexShrink: 1 },
  weekScroll: { flexGrow: 0 },
  weekDays: { flexGrow: 1 },
  day: { minWidth: 40, minHeight: 44, flexGrow: 1, flexShrink: 0, flexBasis: "auto", alignItems: "center", justifyContent: "center", paddingHorizontal: 2, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: "transparent" },
  dayToday: { borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  dayUnavailable: { borderColor: palette.amber, backgroundColor: palette.amberSoft },
  dayDisabled: { opacity: 0.55 },
  daySelected: { backgroundColor: palette.primary, borderColor: palette.primary },
  dayName: { fontSize: 11, lineHeight: 15, fontWeight: "500", color: palette.textSecondary },
  dayCoverage: { fontSize: 10, lineHeight: 14, color: palette.amber, textAlign: "center", alignSelf: "stretch" },
  dayNumber: { fontSize: 17, lineHeight: 22, fontWeight: "700", color: palette.text },
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
  filter: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  filterSelected: { borderColor: palette.navy, backgroundColor: palette.navy },
  filterText: { ...typography.label, fontSize: 13, color: palette.textSecondary },
  filterTextSelected: { color: palette.white },
  filterNote: { ...typography.caption, color: palette.textSecondary, marginTop: -10 },
  section: { gap: 20 },
  agendaDate: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingTop: 8 },
  agendaDateIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" },
  agendaDateText: { ...typography.label, color: palette.text, flex: 1, textTransform: "capitalize" },
  errorCard: { borderColor: palette.dangerBorder, gap: 16 },
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
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import { clock, duration, shiftDate, shortDate } from "../../domain/format";
import type { AssignmentWork, DateRange, StatusInput } from "../../domain/models";
import { automaticExecutionTiming, availableExecutionDates, canTransitionExecution, executionDatesAllowed, executionElapsedSeconds, executionIntervalCovered, executionStartTime, MAX_EXECUTION_DATES, workedDatesAllowed } from "../../domain/workExecution";
import { BodyText, Button, SectionTitle } from "../../ui/components";
import { palette, radius, spacing, typography } from "../../ui/theme";
import { TimeField } from "../../ui/time/TimeField";
import { DayOffsetField, NumericSelectField } from "../../ui/time/NumericSelectField";
import { ChoiceButton, Notice, SegmentOption } from "./DetailUi";
import { manualCompletion } from "./detailRules";
import { manualDurationCompletion } from "./completionTiming";
import { assignmentWorkSnapshotForQueryDate } from "../../domain/assignmentSchedule";
import { styles } from "./detailStyles";
import { CreationDatePicker } from "../creation/CreationDatePicker";

export interface CompletionDialogProps {
  maintenance: boolean;
  durable?: boolean;
  work: AssignmentWork;
  allowEditExecutionTime: boolean;
  /** En false la sucursal registra horas manuales: la entrega pide las horas directamente, sin cronómetro. */
  timerEnabled?: boolean;
  generatedAt: string;
  status?: "delivered" | "completed";
  initialDate: string;
  range: DateRange;
  reasons: string[];
  canSubmit: boolean;
  onRefresh?: () => void;
  error: string | null;
  busy: boolean;
  mode: "live" | "demo";
  onClose: () => void;
  onSubmit: (input: StatusInput) => void;
}

export function CompletionDialog({ maintenance, durable = false, work, allowEditExecutionTime, timerEnabled = true, generatedAt, status = "delivered", initialDate, range, reasons, canSubmit: submitAllowed, onRefresh, error, busy, mode, onClose, onSubmit }: CompletionDialogProps) {
  const dates = durable ? [range.startDate] : availableExecutionDates(work, range);
  const plannedDates = dates.filter((day) => work.plannedDates?.includes(day));
  const [selectedDates, setSelectedDates] = useState<string[]>([dates.includes(initialDate) ? initialDate : range.startDate]);
  const [multipleWorkedDays, setMultipleWorkedDays] = useState(Boolean(work.workedDates?.length));
  const [workedDates, setWorkedDates] = useState<string[]>(work.workedDates ?? [initialDate]);
  const [choosingWorkedDates, setChoosingWorkedDates] = useState(false);
  const date = [...selectedDates].sort()[0] ?? range.startDate;
  const manualOnly = !timerEnabled && allowEditExecutionTime;
  const [manual, setManual] = useState(manualOnly);
  const [start, setStart] = useState(() => executionStartTime(work));
  const [end, setEnd] = useState(() => automaticExecutionTiming(work)?.executionEndTime ?? "");
  const [offset, setOffset] = useState(() => String(automaticExecutionTiming(work)?.endDateOffset ?? 0));
  const [editMode, setEditMode] = useState<"duration" | "interval">("duration");
  const [hours, setHours] = useState(() => String(Math.floor(Math.round(work.elapsedSeconds / 60) / 60)));
  const [minutes, setMinutes] = useState(() => String(Math.round(work.elapsedSeconds / 60) % 60));
  const edited = useRef(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (work.status !== "in_progress" || !submitAllowed || reasons.length > 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [work.status, generatedAt, submitAllowed, reasons.length]);
  const previewNow = submitAllowed && reasons.length === 0 ? now : undefined;
  const anchorSnapshot = assignmentWorkSnapshotForQueryDate(work, date);
  const anchorWork = date === range.startDate ? work : anchorSnapshot?.work;
  const elapsed = anchorWork ? executionElapsedSeconds(anchorWork, date === range.startDate ? generatedAt : anchorSnapshot?.generatedAt, previewNow) : 0;
  const timing = anchorWork ? automaticExecutionTiming(anchorWork, elapsed) : null;
  const editing = manual && allowEditExecutionTime;
  const interval = manualCompletion(selectedDates, start, end, /^\d{1,2}$/.test(offset) ? Number(offset) : NaN, range, status, work);
  const result = editMode === "duration" ? manualDurationCompletion(selectedDates, hours, minutes, start, range, work, status) : interval;
  const canSubmit = submitAllowed && canTransitionExecution(work, status) && work.missingRequiredInfo.length === 0 && executionDatesAllowed(work, range, selectedDates, maintenance)
    && (!multipleWorkedDays || workedDatesAllowed(workedDates));
  const blocked = reasons.length > 0 || !canSubmit;
  const autoError = selectedDates.length > 1 && timing && !executionIntervalCovered(selectedDates, timing.endDateOffset)
    ? "Selecciona todos los días que abarca el tiempo trabajado."
    : !maintenance && anchorWork !== undefined && (durable ? Math.round(elapsed / 60) <= 0 : timing === null || timing.minutes <= 0)
    ? allowEditExecutionTime ? "Sin tiempo registrado. Inicia el cronómetro o elige Manual." : "Sin tiempo registrado. Inicia el cronómetro para entregar."
    : null;
  const validationError = !executionDatesAllowed(work, range, selectedDates, maintenance)
    ? "Selecciona una fecha disponible."
    : editing ? result.error : autoError;
  const shownMinutes = editing ? result.minutes : Math.round(elapsed / 60);
  const intervalLabel = multipleWorkedDays ? null
    : editing ? result.input ? `${shortDate(date)} · ${result.input.executionStartTime} → ${result.input.endDateOffset ? `${shortDate(shiftDate(date, result.input.endDateOffset))} ` : ""}${result.input.executionEndTime}` : null
    : timing ? `${shortDate(date)} · ${timing.executionStartTime} → ${timing.endDateOffset ? `${shortDate(shiftDate(date, timing.endDateOffset))} ` : ""}${timing.executionEndTime}` : null;
  useEffect(() => {
    if (manual || edited.current) return;
    setStart(timing?.executionStartTime ?? executionStartTime(anchorWork ?? work));
    setEnd(timing?.executionEndTime ?? "");
    setOffset(String(timing?.endDateOffset ?? 0));
    setHours(String(Math.floor((timing?.minutes ?? Math.round(elapsed / 60)) / 60)));
    setMinutes(String((timing?.minutes ?? Math.round(elapsed / 60)) % 60));
  }, [date, timing?.executionStartTime, timing?.executionEndTime, timing?.endDateOffset, timing?.minutes, manual]);
  const submitted = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ busy, blocked, editing, result, autoError, status, selectedDates, multipleWorkedDays, workedDates, onSubmit });
  latest.current = { busy, blocked, editing, result, autoError, status, selectedDates, multipleWorkedDays, workedDates, onSubmit };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (!busy) submitted.current = false; }, [busy]);

  function toggleDate(day: string): void {
    if (busy) return;
    setSelectedDates((current) => {
      if (maintenance || !plannedDates.includes(day)) return [day];
      if (current.includes(day)) return current.length > 1 ? current.filter((value) => value !== day) : current;
      const planned = current.filter((value) => plannedDates.includes(value));
      return planned.length < MAX_EXECUTION_DATES ? [...planned, day].sort() : current;
    });
  }

  function toggleManual(): void {
    if (busy || !allowEditExecutionTime || manualOnly) return;
    if (!editing) {
      edited.current = false;
      setStart(timing?.executionStartTime ?? executionStartTime(work));
      setEnd(timing?.executionEndTime ?? "");
      setOffset(String(timing?.endDateOffset ?? 0));
      setHours(String(Math.floor((timing?.minutes ?? Math.round(elapsed / 60)) / 60)));
      setMinutes(String((timing?.minutes ?? Math.round(elapsed / 60)) % 60));
    }
    setManual(!editing);
  }

  function chooseSource(nextManual: boolean): void {
    if (nextManual !== editing) toggleManual();
  }

  function changeEditMode(next: "duration" | "interval"): void {
    if (busy || next === editMode) return;
    if (result.input) {
      setStart(result.input.executionStartTime ?? start);
      setEnd(result.input.executionEndTime ?? end);
      setOffset(String(result.input.endDateOffset ?? 0));
      setHours(String(Math.floor(result.minutes / 60)));
      setMinutes(String(result.minutes % 60));
    }
    setEditMode(next);
  }

  function submit(): void {
    const current = latest.current;
    if (!mounted.current || submitted.current || current.busy || current.blocked) return;
    const input = current.editing ? current.result.input : current.autoError ? null : { status: current.status, executionDates: [...current.selectedDates].sort(), isManual: false };
    if (!input) return;
    submitted.current = true;
    try { current.onSubmit({ ...input, ...(current.multipleWorkedDays ? { workedDates: [...current.workedDates].sort() } : {}) }); }
    catch (error) { submitted.current = false; throw error; }
  }

  return (<>
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <SafeAreaView style={styles.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalCard}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <SectionTitle title="Entregar trabajo" />
            {blocked ? <View style={styles.tight}>
              <Text style={styles.label}>Antes de entregar</Text>
              {reasons.map((reason, index) => <BodyText key={`${index}:${reason}`}>• {reason}</BodyText>)}
              {!canSubmit && reasons.length === 0 ? <BodyText>• Actualiza la ficha para verificar los requisitos.</BodyText> : null}
              {onRefresh ? <Button title="Actualizar ficha" variant="ghost" disabled={busy} onPress={() => { if (!latest.current.busy && mounted.current) onRefresh(); }} /> : null}
            </View> : null}
            {mode === "demo" ? <Notice message="Modo demostración: los cambios se guardan solo localmente." /> : null}
            {allowEditExecutionTime && !manualOnly ? <View style={local.segmented} accessibilityRole="radiogroup" accessibilityLabel="Origen del tiempo">
              <SegmentOption label="Cronómetro" icon="timer-outline" selected={!editing} disabled={busy} onPress={() => chooseSource(false)} />
              <SegmentOption label="Manual" icon="create-outline" selected={editing} disabled={busy} onPress={() => chooseSource(true)} />
            </View> : null}
            <View style={local.timeCard}>
              <Text style={local.overline}>Tiempo trabajado</Text>
              <Text style={local.timeValue}>{editing ? duration(shownMinutes) : anchorWork ? clock(elapsed) : "Por confirmar"}</Text>
              {intervalLabel ? <Text style={local.timeMeta}>{intervalLabel}</Text> : null}
              {editing && !manualOnly && anchorWork && elapsed > 0 ? <Text style={local.timeMeta}>Cronómetro: {clock(elapsed)}</Text> : null}
            </View>
            {editing ? <View style={styles.stack}>
              {!multipleWorkedDays ? <View style={local.segmented} accessibilityRole="radiogroup" accessibilityLabel="Forma de indicar el tiempo">
                <SegmentOption label="Duración" selected={editMode === "duration"} disabled={busy} onPress={() => changeEditMode("duration")} />
                <SegmentOption label="Inicio y término" selected={editMode === "interval"} disabled={busy} onPress={() => changeEditMode("interval")} />
              </View> : null}
              {editMode === "duration" && !executionStartTime(work) ? <TimeField label="Hora de inicio" value={start} onChange={(value) => { edited.current = true; setStart(value); }} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} /> : null}
              {editMode === "duration" ? <View style={styles.columns}>
                <NumericSelectField label="Horas" value={hours} max={743} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} onChange={(value) => { edited.current = true; setHours(value); }} containerStyle={styles.column} />
                <NumericSelectField label="Minutos" value={minutes} max={59} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} onChange={(value) => { edited.current = true; setMinutes(value); }} containerStyle={styles.column} />
              </View> : <>
              <View style={styles.columns}>
                <TimeField label="Inicio" value={start} onChange={(value) => { edited.current = true; setStart(value); }} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} containerStyle={styles.column} />
                <TimeField label="Término" value={end} onChange={(value) => { edited.current = true; setEnd(value); }} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} containerStyle={styles.column} />
              </View>
              <DayOffsetField label="Día de término" value={offset} onChange={(value) => { edited.current = true; setOffset(value); }} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} />
              </>}
            </View> : null}
            <View style={styles.tight}>
              <Text style={styles.label}>{multipleWorkedDays ? `Días trabajados · ${workedDates.length}` : selectedDates.length > 1 ? `Fechas · ${selectedDates.length}` : "Fecha"}</Text>
              {multipleWorkedDays ? <>
                <Text style={styles.caption}>{workedDates.map(day => new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))).join(" · ")}</Text>
                <Button title="Elegir días" icon="calendar-outline" variant="secondary" disabled={busy} onPress={() => setChoosingWorkedDates(true)} />
              </> : <>
                {dates.length > 1 ? <View style={styles.row}>{dates.map((day) => <ChoiceButton key={day} multiple={!maintenance} label={shortDate(day)} selected={selectedDates.includes(day)} disabled={busy || (!selectedDates.includes(day) && selectedDates.length >= MAX_EXECUTION_DATES)} onPress={() => toggleDate(day)} />)}</View> : <BodyText>{shortDate(date)}</BodyText>}
                {!maintenance && plannedDates.length > 1 && plannedDates.length <= MAX_EXECUTION_DATES ? <Button title="Todas las fechas planificadas" variant="ghost" disabled={busy} onPress={() => setSelectedDates([...plannedDates])} /> : null}
                {selectedDates.length > 1 ? <Text style={styles.caption}>El tiempo es el total de las fechas.</Text> : null}
              </>}
              <ChoiceButton multiple label="Trabajé en varios días" selected={multipleWorkedDays} disabled={busy} onPress={() => {
                if (busy) return;
                setMultipleWorkedDays(!multipleWorkedDays);
                if (!multipleWorkedDays) changeEditMode("duration");
                setSelectedDates([range.startDate]);
              }} />
            </View>
          </ScrollView>
          <View style={[styles.tight, { padding: 16 }]}>
            {error || validationError ? <Text accessibilityRole="alert" style={styles.errorText}>{error ?? validationError}</Text> : blocked ? <Text style={styles.caption}>{reasons[0] ?? "Revisa los requisitos antes de entregar."}</Text> : null}
            <Button title={mode === "demo" ? "Entregar en demostración" : durable ? "Guardar entrega" : "Confirmar y entregar"} icon="checkmark-circle-outline" loading={busy} disabled={busy || blocked || (editing ? result.input === null : autoError !== null)} onPress={submit} />
            <Button title="Seguir trabajando" variant="secondary" disabled={busy} onPress={onClose} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
    {choosingWorkedDates ? <CreationDatePicker multiple value={initialDate} selectedDates={workedDates} onClose={() => setChoosingWorkedDates(false)} onChange={setWorkedDates} /> : null}
  </>);
}

const local = StyleSheet.create({
  segmented: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.md, backgroundColor: palette.track },
  timeCard: { alignItems: "center", gap: 2, paddingVertical: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  overline: { ...typography.overline, color: palette.primary, textTransform: "uppercase" },
  timeValue: { ...typography.hero, color: palette.heading, fontVariant: ["tabular-nums"] },
  timeMeta: { ...typography.caption, color: palette.textSecondary },
});
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import { clock, duration, shiftDate, shortDate } from "../../domain/format";
import type { AssignmentWork, DateRange, StatusInput } from "../../domain/models";
import { automaticExecutionTiming, availableExecutionDates, canTransitionExecution, executionDatesAllowed, executionElapsedSeconds, executionStartTime, MAX_EXECUTION_DATES } from "../../domain/workExecution";
import { BodyText, Button, Field, SectionTitle } from "../../ui/components";
import { TimeField } from "../../ui/time/TimeField";
import { DayOffsetField } from "../../ui/time/NumericSelectField";
import { ChoiceButton, Notice } from "./DetailUi";
import { manualCompletion } from "./detailRules";
import { styles } from "./detailStyles";

export interface CompletionDialogProps {
  maintenance: boolean;
  work: AssignmentWork;
  allowEditExecutionTime: boolean;
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

export function CompletionDialog({ maintenance, work, allowEditExecutionTime, generatedAt, status = "delivered", initialDate, range, reasons, canSubmit: submitAllowed, onRefresh, error, busy, mode, onClose, onSubmit }: CompletionDialogProps) {
  const dates = availableExecutionDates(work, range);
  const plannedDates = dates.filter((day) => work.plannedDates?.includes(day));
  const [selectedDates, setSelectedDates] = useState<string[]>([dates.includes(initialDate) ? initialDate : range.startDate]);
  const date = [...selectedDates].sort()[0] ?? range.startDate;
  const [manual, setManual] = useState(false);
  const [start, setStart] = useState(() => executionStartTime(work));
  const [end, setEnd] = useState(() => automaticExecutionTiming(work)?.executionEndTime ?? "");
  const [offset, setOffset] = useState(() => String(automaticExecutionTiming(work)?.endDateOffset ?? 0));
  const [now, setNow] = useState(Date.now);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    if (work.status !== "in_progress" || !submitAllowed || reasons.length > 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [work.status, generatedAt, submitAllowed, reasons.length]);
  const previewNow = submitAllowed && reasons.length === 0 ? now : undefined;
  const elapsed = executionElapsedSeconds(work, generatedAt, previewNow);
  const anchorSnapshot = work.schedules?.find((snapshot) => snapshot.queryDates.includes(date));
  const anchorWork = date === range.startDate ? work : anchorSnapshot?.work;
  const timing = anchorWork ? automaticExecutionTiming(anchorWork, executionElapsedSeconds(anchorWork, date === range.startDate ? generatedAt : anchorSnapshot?.generatedAt, previewNow)) : null;
  const editing = manual && allowEditExecutionTime;
  const result = manualCompletion(selectedDates, start, end, /^\d{1,2}$/.test(offset) ? Number(offset) : NaN, range, status, work);
  const canSubmit = submitAllowed && canTransitionExecution(work, status) && work.missingRequiredInfo.length === 0 && executionDatesAllowed(work, range, selectedDates, maintenance);
  const blocked = reasons.length > 0 || !canSubmit;
  const autoError = !maintenance && anchorWork !== undefined && (timing === null || timing.minutes <= 0)
    ? allowEditExecutionTime
      ? "No hay tiempo de cronómetro suficiente para entregar automáticamente. Inicia el cronómetro o activa la edición manual."
      : "Inicia el cronómetro antes de entregar. La sucursal no permite registrar horas manuales; si acaba de iniciar, espera a que acumule tiempo."
    : null;
  const validationError = editing ? attempted ? result.error : null : autoError;
  const submitted = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ busy, blocked, editing, result, autoError, status, selectedDates, onSubmit });
  latest.current = { busy, blocked, editing, result, autoError, status, selectedDates, onSubmit };
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
    if (busy || !allowEditExecutionTime) return;
    if (!editing) {
      setStart(timing?.executionStartTime ?? executionStartTime(work));
      setEnd(timing?.executionEndTime ?? "");
      setOffset(String(timing?.endDateOffset ?? 0));
    }
    setManual(!editing);
    setAttempted(false);
  }

  function submit(): void {
    const current = latest.current;
    if (!mounted.current || submitted.current || current.busy || current.blocked) return;
    setAttempted(true);
    const input = current.editing ? current.result.input : current.autoError ? null : { status: current.status, executionDates: [...current.selectedDates].sort(), isManual: false };
    if (!input) return;
    submitted.current = true;
    try { current.onSubmit(input); }
    catch (error) { submitted.current = false; throw error; }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <SafeAreaView style={styles.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalCard}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <SectionTitle title="Entregar trabajo" subtitle="Revisa la ejecución registrada. La entrega cierra el estado y las respuestas, no los comentarios ni los archivos." />
            {blocked ? <View style={styles.tight}>
              <Text style={styles.label}>Antes de entregar</Text>
              {reasons.map((reason, index) => <BodyText key={`${index}:${reason}`}>• {reason}</BodyText>)}
              {!canSubmit && reasons.length === 0 ? <BodyText>• Actualiza la ficha para verificar los requisitos y permisos de entrega.</BodyText> : null}
              {onRefresh ? <Button title="Actualizar ficha" variant="ghost" disabled={busy} onPress={() => { if (!latest.current.busy && mounted.current) onRefresh(); }} /> : null}
            </View> : null}
            {mode === "demo" ? <Notice message="Modo demostración: los cambios se guardan solo localmente." /> : null}
            <View style={styles.tight}>
              <Text style={styles.label}>Tiempo acumulado {work.status === "in_progress" ? "· En curso" : "· Confirmado"}</Text>
              <Text style={styles.title}>{clock(elapsed)}</Text>
              <BodyText>Las pausas no suman tiempo. Al confirmar se utiliza una lectura nueva del servidor, no el reloj del dispositivo.</BodyText>
            </View>
            <View style={styles.tight}>
              <Text style={styles.label}>Fechas de cierre · {selectedDates.length} seleccionada(s)</Text>
              {dates.length > 1 ? <View style={styles.row}>{dates.map((day) => <ChoiceButton key={day} multiple={!maintenance} label={shortDate(day)} selected={selectedDates.includes(day)} disabled={busy || (!selectedDates.includes(day) && selectedDates.length >= MAX_EXECUTION_DATES)} onPress={() => toggleDate(day)} />)}</View> : <BodyText>{shortDate(date)}</BodyText>}
              {!maintenance && plannedDates.length > 1 && plannedDates.length <= MAX_EXECUTION_DATES ? <Button title="Seleccionar todas las fechas planificadas" variant="secondary" disabled={busy} onPress={() => setSelectedDates([...plannedDates])} /> : null}
              <BodyText>{maintenance ? "Se entrega únicamente este trabajo de mantenimiento, en una fecha. No se cierra la OT ni sus otros trabajos." : `Máximo ${MAX_EXECUTION_DATES} fechas explícitas. Cada fecha debe seguir asignada a ti en esta sucursal; el servidor lo vuelve a comprobar. No se cierran otros trabajos. ${selectedDates.length > 1 ? "No se amplía la selección automáticamente." : "Una ejecución nocturna puede registrar tiempo en su fecha de término."}`}</BodyText>
              {selectedDates.length > 1 ? <Notice message={`El intervalo se registra UNA sola vez, desde ${shortDate(date)}, no una vez por día. En automático se usa el cronómetro de esa primera fecha; si otros días tienen cronómetros, deben entregarse por separado. Un intervalo nocturno exige seleccionar todos sus días.`} /> : null}
            </View>
            {allowEditExecutionTime ? <ChoiceButton multiple label="Editar horas de ejecución manualmente" selected={editing} disabled={busy} onPress={toggleManual} /> : null}
            {editing ? <View style={styles.stack}>
              <BodyText>Indica el intervalo real TOTAL, no horas por día ni el horario programado. El registro quedará identificado como manual.</BodyText>
              <View style={styles.columns}>
                <TimeField label="Inicio real (HH:mm)" value={start} onChange={setStart} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} containerStyle={styles.column} />
                <TimeField label="Término real (HH:mm)" value={end} onChange={setEnd} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} containerStyle={styles.column} />
              </View>
              <DayOffsetField label="Día de término" value={offset} onChange={setOffset} disabled={busy} scopeKey={JSON.stringify([work.id, selectedDates, range])} hint="0: mismo día · 1: día siguiente. El término puede cruzar el límite del período consultado." />
              {result.input ? <Notice message={`Duración: ${duration(result.minutes)} · Término: ${shortDate(shiftDate(date, Number(offset)))}`} /> : null}
            </View> : maintenance ? <BodyText>Se conserva el tiempo acumulado del mantenimiento, incluso si es cero. No se envían horas que lo reemplacen.</BodyText> : <View style={styles.tight}>
              <View style={styles.columns}>
                <Field label="Inicio automático (HH:mm)" value={timing?.executionStartTime ?? ""} editable={false} containerStyle={styles.column} />
                <Field label="Término calculado (HH:mm)" value={timing?.executionEndTime ?? ""} editable={false} containerStyle={styles.column} />
              </View>
              {timing ? <Notice message={`Duración: ${duration(timing.minutes)} · Término: ${shortDate(shiftDate(date, timing.endDateOffset))}`} /> : null}
              {!anchorWork ? <Notice message={`El cronómetro de ${shortDate(date)} se consultará al confirmar. No se reutiliza el tiempo de otra fecha.`} /> : null}
              <BodyText>Vista previa del tiempo efectivo, redondeado al minuto. Las horas definitivas se calculan en el servidor.</BodyText>
            </View>}
            <BodyText>El servidor vuelve a validar permisos, respuestas y archivos obligatorios al confirmar. Los borradores del dispositivo no cuentan como evidencia guardada.</BodyText>
            {validationError ? <Notice message={validationError} tone="error" /> : null}
            {error ? <Notice message={error} tone="error" /> : null}
            <Button title={mode === "demo" ? "Entregar en demostración" : "Confirmar y entregar"} icon="checkmark-circle-outline" loading={busy} disabled={busy || blocked || (editing ? result.input === null : autoError !== null)} onPress={submit} />
            <Button title="Seguir trabajando" variant="secondary" disabled={busy} onPress={onClose} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
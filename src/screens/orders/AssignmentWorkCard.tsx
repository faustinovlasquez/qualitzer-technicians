import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { assignmentCodes } from "../../domain/assignmentCodes";
import { assignmentDay, assignmentProgress, assignmentWorkForQueryDate, assignmentWorkSnapshotForQueryDate } from "../../domain/assignmentSchedule";
import { clock, duration, isFinished, plainText, shortDate, STATUS_LABELS } from "../../domain/format";
import type { AssignmentGroup, AssignmentWork, StatusInput, WorkOpenOptions } from "../../domain/models";
import { isOfflineQueuedError, type OfflineSnapshot } from "../../domain/offline";
import { Badge, Button, Card, type BadgeTone } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { Notice } from "../workDetail/DetailUi";
import { errorMessage } from "../workDetail/detailRules";
import { isPendingLocalWork } from "../offline/offlineDashboardUi";
import { operationsForWork, pendingTimerForWork, timerPendingLabel, operationErrorReason, operationStatusLabels, type PendingTimer, type QueuedTimerMarker } from "../offline/offlineUi";
import { AssignmentMetadataRow } from "./AssignmentMetadataRow";
import { equipmentLabel, fullDate, safeCount, scheduleTime, statusTones } from "./assignmentPresentation";

export interface AssignmentWorkCardProps {
  group: AssignmentGroup;
  work: AssignmentWork;
  onOpenWork: (group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions) => void;
  onWorkStatus: (group: AssignmentGroup, work: AssignmentWork, input: StatusInput) => Promise<void>;
  busy?: boolean;
  generatedAt?: string;
  online?: boolean;
  staleReadOnly?: boolean;
  offline?: OfflineSnapshot | null;
  queryDate?: string;
  companyBranchId?: number;
  pendingTimer?: PendingTimer | null;
}

const priorities: { [K in AssignmentWork["priority"]]: { label: string; tone: BadgeTone } } = {
  low: { label: "Prioridad baja", tone: "neutral" },
  medium: { label: "Prioridad media", tone: "warning" },
  high: { label: "Prioridad alta", tone: "danger" },
};

function WorkExecution({ work, generatedAt, online = true, pending = false }: Pick<AssignmentWorkCardProps, "work" | "generatedAt" | "online"> & { pending?: boolean }) {
  const receivedAt = useMemo(() => Date.now(), [work, generatedAt]);
  const [now, setNow] = useState(Date.now);
  const running = online && !pending && work.status === "in_progress" && !work.isManualExecution;
  const snapshot = work.schedules?.find((item) => assignmentDay(item.work.scheduledDate) === assignmentDay(work.scheduledDate));
  const snapshotAt = Date.parse(generatedAt ?? snapshot?.generatedAt ?? "");
  const baseline = Number.isFinite(snapshotAt) ? snapshotAt : receivedAt;

  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, baseline]);

  const elapsed = work.elapsedSeconds + (running ? Math.max(0, (now - baseline) / 1000) : 0);
  const timing = assignmentProgress(work, elapsed);

  return <View style={styles.execution}>
    <View style={styles.between}>
      <Text style={styles.executionTitle}>Tiempo total ejecutado</Text>
      <Text style={styles.elapsed}>{clock(timing.totalExecutedMinutes * 60)}</Text>
    </View>
    <Text style={styles.note}>{duration(timing.totalExecutedMinutes)} ejecutados / {duration(timing.totalPlannedMinutes)} planificados</Text>
    <View style={styles.between}>
      <Text style={styles.note}>Avance total</Text>
      <Text style={[styles.count, timing.overtimeMinutes > 0 && styles.overtime]}>{timing.percentage === null ? "Sin tiempo planificado" : `${timing.percentage}%`}</Text>
    </View>
    <View accessibilityRole="progressbar" accessibilityLabel="Tiempo ejecutado frente al planificado" accessibilityValue={{ min: 0, max: 100, now: timing.barPercentage, text: timing.percentage === null ? "Sin tiempo planificado" : `${timing.percentage}% ejecutado` }} style={styles.progressTrack}>
      <View style={[styles.progressFill, timing.overtimeMinutes > 0 && styles.overtimeFill, { width: `${timing.barPercentage}%` }]} />
    </View>
    {timing.overtimeMinutes > 0 ? <Text style={styles.overtime}>{duration(timing.overtimeMinutes)} sobre lo planificado</Text> : null}
    {running ? <Text style={styles.note}>En ejecución · el servidor confirma el tiempo final.</Text> : null}
    {pending ? <Text style={styles.note}>Último tiempo recibido, sin incremento local mientras se confirma o actualiza el estado.</Text> : null}
    {!online ? <Text style={styles.note}>Último tiempo recibido · no se simula el cronómetro sin conexión o sin ficha verificada.</Text> : null}
  </View>;
}

export function AssignmentWorkCard(props: AssignmentWorkCardProps) {
  const scopeKey = JSON.stringify([props.group.id, props.work.id, assignmentDay(props.work.scheduledDate), props.queryDate, props.companyBranchId]);
  const queryDate = props.queryDate ?? assignmentDay(props.work.scheduledDate);
  const work = assignmentWorkForQueryDate(props.work, queryDate);
  const snapshot = assignmentWorkSnapshotForQueryDate(props.work, queryDate);
  return <AssignmentWorkCardContent key={scopeKey} {...props} work={work ?? props.work} generatedAt={snapshot?.generatedAt ?? props.generatedAt} staleReadOnly={props.staleReadOnly || !work} />;
}

function AssignmentWorkCardContent({ group, work, onOpenWork, onWorkStatus, busy = false, generatedAt, online = true, staleReadOnly = false, offline, queryDate, companyBranchId, pendingTimer: suppliedTimer }: AssignmentWorkCardProps) {
  const [acting, setActing] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [queuedTimer, setQueuedTimer] = useState<QueuedTimerMarker | null>(null);
  const queuedTimerRef = useRef(queuedTimer);
  const actionRef = useRef(false);
  const mounted = useRef(true);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const codes = assignmentCodes(group, work);
  const localWork = group.id.startsWith("local-") || isPendingLocalWork(work);
  const date = queryDate ?? assignmentDay(work.scheduledDate);
  const scope = { groupId: group.id, workId: work.id, startDate: date, endDate: date, companyBranchId };
  const scopedOperations = operationsForWork(offline, scope);
  const pendingTimer = offline !== undefined || suppliedTimer === undefined ? pendingTimerForWork(offline, scope, work) : suppliedTimer;
  const unobservedTimer = queuedTimer && pendingTimer?.id !== queuedTimer.operationId && !scopedOperations.some((operation) => operation.id === queuedTimer.operationId) ? queuedTimer : null;
  const desiredStatus = unobservedTimer?.status ?? pendingTimer?.payload.status ?? work.status;
  const timerPending = Boolean(pendingTimer || unobservedTimer);
  const timerNeedsAttention = offline?.connection?.foreground === false || pendingTimer !== null && pendingTimer.status !== "pending" && pendingTimer.status !== "syncing";
  const offlineReady = offline !== null && !offline?.authBlocked;
  const verifiedOnline = online && (offline === undefined || offline?.online === true) && offlineReady;
  const executionAvailable = offlineReady && (verifiedOnline || offline !== undefined) && !localWork && !staleReadOnly && !work.missingRequiredInfo.includes("OFFLINE_AWAITING_SERVER_SNAPSHOT");
  const pendingOperations = timerPending || scopedOperations.some((operation) => operation.status !== "applied")
    || operationsForWork(offline, { groupId: group.id, startDate: date, endDate: date, companyBranchId }).some((operation) => operation.status !== "applied");
  const codeLabels = localWork ? [] : [codes.workCode, codes.workOrderCode, codes.negotiationCode].filter((code) => code !== null);
  const plannedDates = [...new Set((work.plannedDates ?? []).map(assignmentDay).filter(Boolean))].sort();
  const customer = work.workCustomerName ?? group.customerName;
  const location = group.locationName.trim() ? group.locationName : group.locationAddress;
  const priority = priorities[work.priority];
  const total = safeCount(work.checklistTotal);
  const done = Math.min(total, safeCount(work.checklistDone));
  const title = plainText(work.title);
  const finished = isFinished(work);
  const locked = busy || acting;
  const pausing = desiredStatus === "in_progress";
  const actionTitle = pausing ? "Pausar" : desiredStatus === "paused" ? "Reanudar" : "Iniciar";
  const canChangeStatus = executionAvailable && !finished && !timerNeedsAttention && (pausing || work.canExecute);
  const gates = useRef({ canChangeStatus, canDeliver: false, desiredStatus });
  gates.current = { canChangeStatus, canDeliver: executionAvailable && verifiedOnline && !pendingOperations && !finished && work.canExecute, desiredStatus };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!queuedTimerRef.current || (pendingTimer?.id !== queuedTimerRef.current.operationId && !scopedOperations.some((operation) => operation.id === queuedTimerRef.current?.operationId))) return;
    queuedTimerRef.current = null;
    setQueuedTimer(null);
  }, [offline?.operations, pendingTimer?.id]);

  async function changeStatus(): Promise<void> {
    const status = pausing ? "paused" : "in_progress";
    if (!mounted.current || actionRef.current || busyRef.current || !gates.current.canChangeStatus || gates.current.desiredStatus === status || queuedTimerRef.current?.status === status) return;
    actionRef.current = true;
    setActing(true);
    setOperationError(null);
    try {
      await onWorkStatus(group, work, { status });
    } catch (error) {
      if (isOfflineQueuedError(error) && error.kind === "timer") {
        queuedTimerRef.current = { operationId: error.operationId, status };
        if (mounted.current) setQueuedTimer(queuedTimerRef.current);
      } else if (mounted.current) setOperationError(`No se pudo actualizar el estado. ${errorMessage(error)}`);
    } finally {
      actionRef.current = false;
      if (mounted.current) setActing(false);
    }
  }

  function openWork(options?: WorkOpenOptions): void {
    if (!mounted.current || actionRef.current || busyRef.current) return;
    if (options?.action && !gates.current.canDeliver) return;
    try { onOpenWork(group, work, options); }
    catch (error) { setOperationError(errorMessage(error)); }
  }

  return <Card style={styles.card}>
    <View style={styles.between}>
      <View style={styles.codes}>
        {localWork ? <Badge label="Guardado local · pendiente" tone="warning" /> : null}
        {codeLabels.map((code) => <Text key={code} style={styles.code}>{code}</Text>)}
      </View>
      <Badge label={STATUS_LABELS[work.status]} tone={statusTones[work.status]} />
    </View>
    <Pressable
      onPress={() => openWork()}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
      accessibilityLabel={`${codeLabels.join(". ")}. ${title}. ${STATUS_LABELS[work.status]}. ${priority.label}`}
      accessibilityHint="Abre el detalle del trabajo."
      style={({ pressed }) => [styles.titleButton, pressed && styles.pressed]}
    >
      <View style={styles.titleCopy}><Text style={styles.title}>{title}</Text><Text style={styles.detailLabel}>Ver detalle del trabajo</Text></View>
      <Ionicons name="chevron-forward-outline" size={21} color={palette.primary} accessible={false} />
    </Pressable>
    <View style={styles.codes}>
      <Badge label={priority.label} tone={priority.tone} />
      {work.isOverdue && !finished ? <Badge label="Atrasada" tone="danger" /> : null}
    </View>
    <View style={styles.metadata}>
      <AssignmentMetadataRow icon="hardware-chip-outline" text={equipmentLabel(work.workEquipment ?? group.equipment)} strong />
      <AssignmentMetadataRow icon="location-outline" text={location?.trim() ? location : "Ubicación no informada"} />
      {customer?.trim() ? <AssignmentMetadataRow icon="business-outline" text={customer} /> : null}
    </View>
    <View style={styles.schedule}>
      <AssignmentMetadataRow icon="calendar-outline" text={fullDate(work.scheduledDate)} strong />
      <AssignmentMetadataRow icon="time-outline" text={scheduleTime(work)} />
      {plannedDates.length > 1 ? <AssignmentMetadataRow icon="calendar-outline" text={`Fechas planificadas: ${plannedDates.map(shortDate).join(" · ")}`} /> : null}
    </View>
    {timerPending ? <Notice message={`${timerPendingLabel(pendingTimer)} · solicitado: ${STATUS_LABELS[desiredStatus]}. Estado recibido: ${STATUS_LABELS[work.status]}.${pendingTimer ? ` ${operationStatusLabels[pendingTimer.status]}.` : ""}${pendingTimer?.lastError ? ` ${operationErrorReason(pendingTimer.lastError)}` : ""}${pendingTimer?.status === "applied" && offline?.lastError ? " No se pudo actualizar la ficha. Reintenta la actualización manual desde el detalle." : ""}`} tone="warning" /> : null}
    <WorkExecution work={work} generatedAt={generatedAt} online={executionAvailable && verifiedOnline} pending={timerPending} />
    {total > 0 ? <View style={styles.execution}>
      <View style={styles.between}><Text style={styles.note}>Verificación completada</Text><Text style={styles.count}>{done}/{total}</Text></View>
      <View accessibilityRole="progressbar" accessibilityLabel="Lista de verificación" accessibilityValue={{ min: 0, max: total, now: done, text: `${done} de ${total} completados` }} style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(done / total * 100)}%` }]} />
      </View>
    </View> : null}
    <View style={styles.footer}>
      {!finished ? <View style={styles.actions}>
        <Button title={actionTitle} icon={pausing ? "pause-outline" : "play-outline"} disabled={locked || !canChangeStatus} loading={acting} onPress={() => void changeStatus()} style={styles.action} />
        <Button title="Entregar" icon="checkmark-done-outline" variant="secondary" disabled={locked || !gates.current.canDeliver} onPress={() => openWork({ action: "deliver" })} style={styles.action} />
      </View> : <Text style={styles.note}>Trabajo {work.status === "delivered" ? "entregado" : "completado"} · archivos, checklist y comentarios disponibles para consulta.</Text>}
      {!finished && !work.canExecute ? <Text style={styles.note}>Qualitzer no habilita iniciar, reanudar o entregar este trabajo. Consulta los requisitos en su detalle.</Text> : null}
      <View style={styles.actions}>
        <Button title={`Archivos (${safeCount(work.filesCount)})`} icon="attach-outline" variant="secondary" disabled={locked} onPress={() => openWork({ tab: "evidence" })} style={styles.shortcut} />
        <Button title={`Checklist (${done}/${total})`} icon="checkbox-outline" variant="secondary" disabled={locked} onPress={() => openWork({ tab: "checklist" })} style={styles.shortcut} />
        <Button title={`Comentarios (${safeCount(work.commentsCount)})`} icon="chatbubble-ellipses-outline" variant="secondary" disabled={locked} onPress={() => openWork({ tab: "comments" })} style={styles.shortcut} />
      </View>
      {operationError ? <Notice message={operationError} tone="error" onDismiss={() => setOperationError(null)} /> : null}
    </View>
  </Card>;
}

const styles = StyleSheet.create({
  card: { gap: 13 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  codes: { flexDirection: "row", flexWrap: "wrap", gap: 6, flexShrink: 1 },
  code: { ...typography.caption, fontWeight: "800", color: palette.primary, letterSpacing: 0.5, flexShrink: 1, backgroundColor: palette.primarySoft, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.sm, overflow: "hidden" },
  titleButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radius.sm },
  titleCopy: { flex: 1, gap: 3 },
  title: { fontSize: 18, lineHeight: 25, fontWeight: "700", letterSpacing: -0.3, color: palette.navy },
  detailLabel: { ...typography.caption, color: palette.primary },
  metadata: { gap: 8, paddingTop: 2 },
  schedule: { backgroundColor: palette.background, borderRadius: radius.sm, padding: 12, gap: 7 },
  execution: { gap: 7 },
  executionTitle: { ...typography.caption, color: palette.text, fontWeight: "700", flexShrink: 1 },
  note: { ...typography.caption, color: palette.textSecondary },
  elapsed: { ...typography.label, color: palette.primary, fontWeight: "700", fontVariant: ["tabular-nums"] },
  count: { ...typography.caption, color: palette.primary, fontWeight: "700", fontVariant: ["tabular-nums"] },
  overtime: { ...typography.caption, color: palette.amber, fontWeight: "700" },
  overtimeFill: { backgroundColor: palette.amber },
  progressTrack: { height: 5, borderRadius: radius.pill, backgroundColor: palette.track, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: palette.teal, borderRadius: radius.pill },
  footer: { gap: 10, borderTopWidth: 1, borderTopColor: palette.track, paddingTop: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { flex: 1, minWidth: 112, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  shortcut: { flexGrow: 1, flexBasis: 145, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10 },
  pressed: { opacity: 0.72 },
});
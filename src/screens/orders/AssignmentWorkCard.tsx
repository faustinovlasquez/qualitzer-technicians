import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { assignmentCodes } from "../../domain/assignmentCodes";
import { assignmentDay, assignmentProgress, assignmentWorkForQueryDate, assignmentWorkSnapshotForQueryDate } from "../../domain/assignmentSchedule";
import { clock, duration, isFinished, plainText, shortDate, STATUS_LABELS } from "../../domain/format";
import type { AssignmentGroup, AssignmentWork, StatusInput, WorkOpenOptions } from "../../domain/models";
import { isOfflineQueuedError, type OfflineSnapshot } from "../../domain/offline";
import { Badge, Button, Card, type BadgeTone } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { Notice } from "../workDetail/DetailUi";
import { isPendingLocalWork } from "../offline/offlineDashboardUi";
import { operationsForWork, pendingTimerForWork, timerPendingLabel, type PendingTimer, type QueuedTimerMarker } from "../offline/offlineUi";
import { operationNeedsAttention, syncUserError, userActionError as errorMessage } from "../offline/syncUserPresentation";
import { AssignmentMetadataRow } from "./AssignmentMetadataRow";
import { InfoBlock, infoStyles } from "./AssignmentInfoBlock";
import { equipmentLabel, fullDate, safeCount, scheduleTime, statusTones } from "./assignmentPresentation";
import { localTimerElapsedSeconds } from "../../offline/queueIntentions";
import { completionForWork, completionStatusLabel } from "../offline/offlineUi";

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
  /** Trabajador de la sesión: se marca como «Tú» entre los técnicos asignados. */
  currentWorkerId?: number | null;
}

const priorities: { [K in AssignmentWork["priority"]]: { label: string; tone: BadgeTone } } = {
  low: { label: "Prioridad baja", tone: "neutral" },
  medium: { label: "Prioridad media", tone: "warning" },
  high: { label: "Prioridad alta", tone: "danger" },
};

function WorkExecution({ work, generatedAt, online = true, pending = false, localTimer }: Pick<AssignmentWorkCardProps, "work" | "generatedAt" | "online"> & { pending?: boolean; localTimer?: PendingTimer | null }) {
  const receivedAt = useMemo(() => Date.now(), [work, generatedAt]);
  const [now, setNow] = useState(Date.now);
  const running = localTimer?.localClock ? localTimer.payload.status === "in_progress" : !pending && work.status === "in_progress" && !work.isManualExecution;
  const snapshot = work.schedules?.find((item) => assignmentDay(item.work.scheduledDate) === assignmentDay(work.scheduledDate));
  const snapshotAt = Date.parse(generatedAt ?? snapshot?.generatedAt ?? "");
  const baseline = Number.isFinite(snapshotAt) ? snapshotAt : receivedAt;

  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, baseline, localTimer]);

  const elapsed = (localTimer ? localTimerElapsedSeconds(localTimer, now) : null) ?? work.elapsedSeconds + (running ? Math.max(0, (now - baseline) / 1000) : 0);
  const timing = assignmentProgress(work, elapsed);

  const remaining = Math.max(0, timing.totalPlannedMinutes - timing.totalExecutedMinutes);
  return <View style={styles.execution} testID="assignment-work-execution">
    <View style={styles.between}>
      <Text style={styles.overline}>Avance total del trabajo</Text>
      <Text style={styles.progressValue} accessibilityLabel={`Ejecutado ${duration(timing.totalExecutedMinutes)}${timing.percentage === null ? "" : ` de ${duration(timing.totalPlannedMinutes)}, ${timing.percentage}%`}`}>
        <Text style={styles.elapsed}>{running ? clock(timing.totalExecutedMinutes * 60) : duration(timing.totalExecutedMinutes)}</Text>
        {timing.percentage !== null ? <Text> / {duration(timing.totalPlannedMinutes)}  </Text> : null}
        {timing.percentage !== null ? <Text style={[styles.count, timing.overtimeMinutes > 0 && styles.overtime]}>{timing.percentage}%</Text> : null}
      </Text>
    </View>
    {timing.percentage !== null ? <View accessibilityRole="progressbar" accessibilityLabel="Tiempo ejecutado frente al planificado" accessibilityValue={{ min: 0, max: 100, now: timing.barPercentage, text: `${timing.percentage}% ejecutado` }} style={styles.progressTrack}>
      <View style={[styles.progressFill, timing.overtimeMinutes > 0 && styles.overtimeFill, { width: `${timing.barPercentage}%` }]} />
    </View> : null}
    {timing.percentage === null ? <Text style={styles.note}>Sin tiempo planificado</Text>
      : timing.overtimeMinutes > 0 ? <Text style={styles.overtime}>{duration(timing.overtimeMinutes)} sobre lo planificado</Text>
      : <Text style={styles.note}>Faltan {duration(remaining)}</Text>}
    {running ? <Text style={styles.note}>En ejecución · el servidor confirma el tiempo final.</Text> : null}
    {pending || !online ? <Text style={styles.note}>{localTimer?.localClock || !pending ? "Tiempo local · pendiente de confirmar" : "Último tiempo recibido"}</Text> : null}
  </View>;
}

function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 90 || text.includes("\n");
  return <View style={styles.description}>
    <Text style={styles.descriptionText} numberOfLines={expanded ? undefined : 2}>{text}</Text>
    {long ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Leer menos de la descripción" : "Leer más de la descripción"} hitSlop={8} onPress={() => setExpanded(value => !value)}>
      <Text style={styles.readMore}>{expanded ? "Leer menos" : "Leer más"}</Text>
    </Pressable> : null}
  </View>;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function TeamChips({ responsibles, currentWorkerId }: { responsibles: AssignmentWork["responsibles"]; currentWorkerId?: number | null }) {
  if (responsibles.length === 0) return null;
  const isSelf = (id: number | string): boolean => currentWorkerId != null && String(id) === String(currentWorkerId);
  const ordered = [...responsibles].sort((a, b) => Number(isSelf(b.id)) - Number(isSelf(a.id)));
  return <View style={styles.team} accessible accessibilityLabel={`Técnicos asignados: ${ordered.map(person => isSelf(person.id) ? "tú" : person.name).join(", ")}`}>
    <Ionicons name="people-outline" size={15} color={palette.textMuted} accessible={false} />
    {ordered.map(person => {
      const self = isSelf(person.id);
      return <View key={String(person.id)} style={[styles.member, self && styles.memberSelf]}>
        {person.avatarThumbnail ? <Image source={{ uri: person.avatarThumbnail }} style={styles.memberAvatar} accessible={false} />
          : <View style={[styles.memberAvatar, styles.memberInitials]}><Text style={styles.memberInitialsText}>{initials(person.name)}</Text></View>}
        <Text style={[styles.memberName, self && styles.memberNameSelf]} numberOfLines={1}>{self ? "Tú" : person.name}</Text>
      </View>;
    })}
  </View>;
}

function hhmm(value: string | null | undefined): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

function breakTime(work: AssignmentWork): string | null {
  const start = hhmm(work.breakStartTime);
  const end = hhmm(work.breakEndTime);
  return work.hasBreakTime === true && start && end ? `${start} - ${end}` : null;
}

export function AssignmentWorkCard(props: AssignmentWorkCardProps) {
  const scopeKey = JSON.stringify([props.group.id, props.work.id, assignmentDay(props.work.scheduledDate), props.queryDate, props.companyBranchId]);
  const queryDate = props.queryDate ?? assignmentDay(props.work.scheduledDate);
  const work = assignmentWorkForQueryDate(props.work, queryDate);
  const snapshot = assignmentWorkSnapshotForQueryDate(props.work, queryDate);
  return <AssignmentWorkCardContent key={scopeKey} {...props} work={work ?? props.work} generatedAt={snapshot?.generatedAt ?? props.generatedAt} staleReadOnly={props.staleReadOnly || !work} />;
}

function AssignmentWorkCardContent({ group, work, onOpenWork, onWorkStatus, busy = false, generatedAt, online = true, staleReadOnly = false, offline, queryDate, companyBranchId, pendingTimer: suppliedTimer, currentWorkerId }: AssignmentWorkCardProps) {
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
  const completion = completionForWork(scopedOperations, work);
  const statusLabel = completion ? completionStatusLabel(completion) : STATUS_LABELS[work.status];
  const pendingTimer = offline !== undefined || suppliedTimer === undefined ? pendingTimerForWork(offline, scope, work) : suppliedTimer;
  const unobservedTimer = queuedTimer && pendingTimer?.id !== queuedTimer.operationId && !scopedOperations.some((operation) => operation.id === queuedTimer.operationId) ? queuedTimer : null;
  const desiredStatus = unobservedTimer?.status ?? pendingTimer?.payload.status ?? work.status;
  const timerPending = Boolean(pendingTimer || unobservedTimer);
  const timerNeedsAttention = offline?.connection?.foreground === false || pendingTimer !== null && !["pending", "syncing", "applied"].includes(pendingTimer.status);
  const offlineReady = offline !== null && !offline?.authBlocked;
  const verifiedOnline = online && (offline === undefined || offline?.online === true) && offlineReady;
  const executionAvailable = offlineReady && (verifiedOnline || offline !== undefined) && !localWork && !staleReadOnly && !work.missingRequiredInfo.includes("OFFLINE_AWAITING_SERVER_SNAPSHOT");
  const codeLabels = localWork ? [] : [codes.workCode, codes.workOrderCode, codes.negotiationCode].filter((code) => code !== null);
  const plannedDates = [...new Set((work.plannedDates ?? []).map(assignmentDay).filter(Boolean))].sort();
  const customer = work.workCustomerName ?? group.customerName;
  const location = group.locationName.trim() ? group.locationName : group.locationAddress;
  const priority = priorities[work.priority];
  const total = safeCount(work.checklistTotal);
  const done = Math.min(total, safeCount(work.checklistDone));
  const title = plainText(work.title) || "Trabajo sin título";
  const scheduledDay = assignmentDay(work.scheduledDate);
  const scheduledLabel = scheduledDay ? `${shortDate(scheduledDay)} ${scheduledDay.slice(0, 4)}` : "Sin fecha programada";
  const finished = isFinished(work);
  const locked = busy || acting;
  const pausing = desiredStatus === "in_progress";
  const actionTitle = pausing ? "Pausar" : desiredStatus === "paused" ? "Reanudar" : "Iniciar";
  const canChangeStatus = executionAvailable && !finished && !completion && !timerNeedsAttention && (pausing || work.canExecute);
  const canReviewDelivery = offlineReady && offline?.connection?.foreground !== false;
  const gates = useRef({ canChangeStatus, canReviewDelivery, desiredStatus });
  gates.current = { canChangeStatus, canReviewDelivery, desiredStatus };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!queuedTimerRef.current || (pendingTimer?.id !== queuedTimerRef.current.operationId && !scopedOperations.some((operation) => operation.id === queuedTimerRef.current?.operationId))) return;
    queuedTimerRef.current = null;
    setQueuedTimer(null);
  }, [offline?.operations, pendingTimer?.id, queuedTimer?.operationId]);

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
    if (options?.action && !gates.current.canReviewDelivery) return;
    try { onOpenWork(group, work, options); }
    catch (error) { setOperationError(errorMessage(error)); }
  }

  const equipment = work.workEquipment ?? group.equipment;
  const equipmentDetail = equipment ? [equipment.identifier, equipment.internalNumber].filter((value) => value && value !== equipment.label).join(" · ") || null : null;
  const summary = plainText(work.summary);
  const colacion = breakTime(work);

  return <Card style={[styles.card, finished && styles.closedCard]}>
    <View style={styles.between} testID={`assignment-work-heading-${work.id}`}>
      <View style={styles.codes}>
        {localWork ? <Badge label="Guardado local · pendiente" tone="warning" /> : null}
        {codeLabels.map((code) => <Text key={code} style={styles.code}>{code}</Text>)}
      </View>
      <Badge label={statusLabel} tone={completion ? "warning" : statusTones[work.status]} />
    </View>
    <Pressable
      onPress={() => openWork()}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
      accessibilityLabel={`${codeLabels.join(". ")}. ${title}. ${statusLabel}. ${priority.label}`}
      accessibilityHint="Abre el detalle del trabajo."
      style={({ pressed }) => [styles.titleButton, pressed && styles.pressed]}
    >
      <View style={styles.titleCopy}><Text numberOfLines={2} ellipsizeMode="tail" style={styles.title}>{title}</Text></View>
      <Ionicons name="chevron-forward-outline" size={21} color={palette.primary} accessible={false} />
    </Pressable>
    {summary ? <Description text={summary} /> : null}
    {work.priority !== "low" || (work.isOverdue && !finished) ? <View style={styles.codes}>
      {work.priority !== "low" ? <Badge label={priority.label} tone={priority.tone} /> : null}
      {work.isOverdue && !finished ? <Badge label="Atrasada" tone="danger" /> : null}
    </View> : null}
    <View style={infoStyles.list}>
      {customer?.trim() ? <InfoBlock label="Cliente" value={customer} /> : null}
      <InfoBlock label="Equipo" value={equipment ? equipment.label || equipmentLabel(equipment) : "Sin equipo asociado"} detail={equipmentDetail} />
      <InfoBlock label="Ubicación" icon="location-outline" value={location?.trim() ? location : "Sin ubicación"} />
      <View style={infoStyles.row} testID="assignment-work-schedule" accessibilityLabel={`${fullDate(work.scheduledDate)}. ${scheduleTime(work)}`}>
        <InfoBlock label="Horario" icon="calendar-outline" tone="blue" value={`${scheduledLabel} · ${scheduleTime(work)}`} style={infoStyles.half} />
        {colacion ? <InfoBlock label="Colación" icon="cafe-outline" tone="orange" value={colacion} style={infoStyles.half} /> : null}
      </View>
      {plannedDates.length > 1 ? <AssignmentMetadataRow icon="calendar-outline" text={`Fechas planificadas: ${plannedDates.map(shortDate).join(" · ")}`} /> : null}
    </View>
    <TeamChips responsibles={work.responsibles} currentWorkerId={currentWorkerId} />
    {pendingTimer && operationNeedsAttention(pendingTimer) ? <Notice message={syncUserError(pendingTimer.lastError) || timerPendingLabel(pendingTimer)} tone="error" /> : null}
    {completion ? <Notice message={completion.status === "applied" ? "Entrega confirmada · actualizando" : "Entrega guardada · pendiente de sincronizar"} /> : null}
    <WorkExecution work={completion ? { ...work, status: "paused", elapsedSeconds: completion.localClock.elapsedSeconds } : work} generatedAt={generatedAt} online={executionAvailable && verifiedOnline} pending={timerPending || Boolean(completion)} localTimer={completion ? null : pendingTimer} />
    {finished ? <Text style={styles.note}>Trabajo {work.status === "delivered" ? "entregado" : "completado"} · archivos, checklist y comentarios disponibles para consulta.</Text> : null}
    {!finished && !work.canExecute ? <Text style={styles.note}>La ejecución aún no está habilitada. Pulsa Entregar para revisar los requisitos pendientes.</Text> : null}
    <View style={styles.actionBar}>
      {!finished ? <Button stacked title={`${actionTitle}${timerPending ? ` · ${timerPendingLabel(pendingTimer)}` : ""}`} accessibilityLabel={actionTitle} icon={pausing ? "pause-outline" : "play-outline"} variant="secondary" iconColor={palette.primary} disabled={locked || !canChangeStatus} loading={acting} onPress={() => void changeStatus()} style={[styles.cell, styles.cellStart]} textStyle={styles.cellStartText} /> : null}
      {!finished ? <Button stacked title="Entregar" accessibilityLabel="Entregar: abrir revisión de requisitos, sin confirmar todavía" icon="radio-button-on-outline" variant="secondary" iconColor={palette.danger} disabled={locked || !canReviewDelivery} onPress={() => openWork({ action: "deliver" })} style={[styles.cell, styles.cellDeliver]} textStyle={styles.cellDeliverText} /> : null}
      <Button stacked title={`Archivos ${safeCount(work.filesCount)}`} accessibilityLabel={`Archivos (${safeCount(work.filesCount)})`} icon="folder-open-outline" variant="secondary" iconColor={palette.textSecondary} disabled={locked} onPress={() => openWork({ tab: "evidence" })} style={styles.cell} textStyle={styles.cellText} />
      <Button stacked title={`Checklist ${done}/${total}`} accessibilityLabel={`Checklist (${done}/${total})`} icon="checkbox-outline" variant="secondary" iconColor={palette.textSecondary} disabled={locked} onPress={() => openWork({ tab: "checklist" })} style={styles.cell} textStyle={styles.cellText} />
      <Button stacked title={`Com. ${safeCount(work.commentsCount)}`} accessibilityLabel={`Comentarios (${safeCount(work.commentsCount)})`} icon="chatbox-ellipses-outline" variant="secondary" iconColor={palette.textSecondary} disabled={locked} onPress={() => openWork({ tab: "comments" })} style={[styles.cell, styles.cellLast]} textStyle={styles.cellText} />
    </View>
    {operationError ? <Notice message={operationError} tone="error" onDismiss={() => setOperationError(null)} /> : null}
  </Card>;
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 12, borderRadius: 12, overflow: "hidden" },
  closedCard: { backgroundColor: palette.successSoft, borderLeftWidth: 4, borderLeftColor: palette.primary },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  codes: { flexDirection: "row", flexWrap: "wrap", gap: 6, flexShrink: 1 },
  code: { ...typography.caption, fontWeight: "800", color: palette.primary, letterSpacing: 0.5, flexShrink: 1, backgroundColor: palette.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, overflow: "hidden" },
  titleButton: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radius.sm },
  titleCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "800", letterSpacing: 0, color: palette.navy, textTransform: "uppercase" },
  description: { gap: 2, marginTop: -6 },
  descriptionText: { fontSize: 13, lineHeight: 18, color: palette.textSecondary },
  readMore: { fontSize: 12, lineHeight: 18, fontWeight: "700", color: palette.info },
  team: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  member: { flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 2, paddingRight: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: palette.background, maxWidth: "100%" },
  memberSelf: { backgroundColor: palette.infoSoft, borderWidth: 1, borderColor: "#C9D7EE" },
  memberAvatar: { width: 22, height: 22, borderRadius: 11 },
  memberInitials: { backgroundColor: palette.navyLight, alignItems: "center", justifyContent: "center" },
  memberInitialsText: { fontSize: 9, fontWeight: "800", color: palette.white },
  memberName: { fontSize: 11, lineHeight: 15, fontWeight: "600", color: palette.text, flexShrink: 1 },
  memberNameSelf: { color: palette.info, fontWeight: "800" },
  execution: { gap: 4 },
  overline: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.8, color: palette.textMuted, textTransform: "uppercase", flexShrink: 1 },
  progressValue: { fontSize: 12, lineHeight: 17, color: palette.textSecondary, fontVariant: ["tabular-nums"] },
  note: { ...typography.caption, color: palette.textSecondary },
  elapsed: { fontSize: 12, lineHeight: 17, color: palette.navy, fontWeight: "700", fontVariant: ["tabular-nums"] },
  count: { ...typography.caption, color: palette.primary, fontWeight: "700", fontVariant: ["tabular-nums"] },
  overtime: { ...typography.caption, color: palette.amber, fontWeight: "700" },
  overtimeFill: { backgroundColor: palette.amber },
  progressTrack: { height: 5, borderRadius: radius.pill, backgroundColor: palette.track, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: palette.teal, borderRadius: radius.pill },
  actionBar: { flexDirection: "row", marginHorizontal: -12, marginBottom: -12, borderTopWidth: 1, borderTopColor: palette.border },
  cell: { flex: 1, minWidth: 0, borderRadius: 0, borderWidth: 0, borderRightWidth: 1, borderRightColor: palette.border, backgroundColor: palette.surface },
  cellLast: { borderRightWidth: 0 },
  cellStart: { backgroundColor: palette.primarySoft },
  cellStartText: { color: palette.primary },
  cellDeliver: { backgroundColor: palette.dangerSoft },
  cellDeliverText: { color: palette.danger },
  cellText: { color: palette.textSecondary },
  pressed: { opacity: 0.72 },
});
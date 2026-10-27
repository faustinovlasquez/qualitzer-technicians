import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DateRange } from "../../domain/models";
import type { OfflineController, OfflineOperation, OfflineSnapshot } from "../../domain/offline";
import { OFFLINE_LIMITS } from "../../offline/contracts";
import { storageBytesLabel } from "../../offline/storageCapacity";
import { requiresDeployment } from "../../offline/connection";
import { connectionPresentation } from "../../offline/connectionPresentation";
import { Badge, BodyText, Button, Card, IconButton, SectionTitle } from "../../ui/components";
import { Notice } from "../workDetail/DetailUi";
import { errorMessage } from "../workDetail/detailRules";
import { styles } from "../workDetail/detailStyles";
import { fileSizeLabel } from "../workDetail/files/fileRules";
import { OfflineFileCard } from "./OfflineFileCard";
import { canRetryOperation, coverageDates, dependencyInfo, operationErrorReason, operationStatusLabels, operationTitle, pendingDocumentAttachment } from "./offlineUi";
import { PENDING_CHANGES_MESSAGE, syncUserError, userErrorText } from "./syncUserPresentation";
import { captureSyncAttempt, deploymentPendingCount, requestManualSync, syncAttemptMessage, syncAttemptPresentation, syncSnapshotKey, type SyncAttempt } from "./syncAttemptPresentation";
import { animateNextLayout } from "../../ui/motion";
import { palette } from "../../ui/theme";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { DISCARDABLE_STATUSES, discardSet } from "../../offline/discard";

export interface OfflineCenterScreenProps {
  controller: OfflineController;
  snapshot: OfflineSnapshot | null;
  range: DateRange;
  branchId: number;
  branchName?: string;
  onBack: () => void;
  onPrepare?: () => Promise<void>;
  /** Diferencia medida entre la hora del servidor y la del teléfono (ms). */
  clockOffsetMs?: number;
}

function OperationDetails({ operation, title = "Ver detalles técnicos" }: { operation: OfflineOperation; title?: string }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.tight}>
    <Button title={expanded ? "Ocultar detalles" : title} variant="ghost" onPress={() => { animateNextLayout(); setExpanded(!expanded); }} />
    {expanded ? <>
    <Text selectable style={styles.caption}>Operación: {operation.id}</Text>
    {operation.lastError ? <Text selectable style={styles.caption}>{operation.lastError} · {operationErrorReason(operation.lastError)}</Text> : null}
    <BodyText>{new Date(operation.createdAt).toLocaleString("es-CL")} · {operation.attempts} intento(s)</BodyText>
    {operation.kind === "create" ? <>
      <Text selectable style={styles.label}>{JSON.stringify(operation.input, null, 2)}</Text>
      {operation.result ? <Text selectable style={styles.caption}>Resultado confirmado: {JSON.stringify(operation.result, null, 2)}</Text> : null}
    </> : <>
      <Text selectable style={styles.caption}>Destino: {JSON.stringify(operation.scope)}</Text>
      {operation.kind === "comment" ? <Text selectable style={styles.label}>{operation.text}</Text> : null}
      {operation.kind === "answer" ? <>
        <BodyText>Paso {operation.stepId}</BodyText>
        <Text selectable style={styles.label}>Respuesta local: {JSON.stringify(operation.answer, null, 2)}</Text>
        <Text selectable style={styles.caption}>Base confirmada al editar: {JSON.stringify(operation.base, null, 2)}</Text>
        <BodyText>El estado actual del servidor debe reconsultarse antes de resolver un conflicto.</BodyText>
      </> : null}
      {operation.kind === "timer" || operation.kind === "checklist" || operation.kind === "completion" ? <Text selectable style={styles.caption}>Solicitud local: {JSON.stringify(operation.payload, null, 2)}</Text> : null}
    </>}
    {operation.receipt ? <Text selectable style={styles.caption}>Recibo: {JSON.stringify(operation.receipt, null, 2)}</Text> : null}
    </> : null}
  </View>;
}

export function OfflineCenterScreen({ controller, snapshot, range, branchId, branchName, onBack, onPrepare, clockOffsetMs = 0 }: OfflineCenterScreenProps) {
  const skewMinutes = Math.round(Math.abs(clockOffsetMs) / 60_000);
  const lock = useRef(false);
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [technicalDetails, setTechnicalDetails] = useState(false);
  const [discarding, setDiscarding] = useState<OfflineOperation | null>(null);
  const [discarded, setDiscarded] = useState<string | null>(null);
  const [discardingQuarantine, setDiscardingQuarantine] = useState(false);
  const [syncResult, setSyncResult] = useState<{ attempt: SyncAttempt; key: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  const syncKey = syncSnapshotKey(snapshot);
  const feedback = syncResult?.key === syncKey ? syncAttemptPresentation(syncResult.attempt, snapshot) : null;
  useEffect(() => {
    setSyncResult((previous) => previous && previous.key !== syncKey ? null : previous);
  }, [syncKey]);
  const nextAttemptAt = feedback?.nextAttemptAt;
  useEffect(() => {
    if (nextAttemptAt === undefined || nextAttemptAt <= Date.now()) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= nextAttemptAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [nextAttemptAt]);
  const awaitingDeployment = snapshot ? deploymentPendingCount(snapshot) : 0;
  const presentation = connectionPresentation(snapshot);
  const dependencies = useMemo(() => new Map(snapshot?.operations.map((operation) => [operation.id, operation]) ?? []), [snapshot?.operations]);
  const dates = coverageDates(range);
  const validWeek = dates.length > 0 && dates[dates.length - 1] === range.endDate;
  async function run(name: string, task: () => Promise<void>): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setAction(name);
    setMessage(null);
    setSyncResult(null);
    try { await task(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { lock.current = false; setAction(null); }
  }
  async function sync(): Promise<void> {
    const before = captureSyncAttempt(controller.getSnapshot());
    let attempt: SyncAttempt = { before };
    try { await requestManualSync(controller); }
    catch (error) { attempt = { before, failure: { error } }; }
    setNow(Date.now());
    setSyncResult({ attempt, key: syncSnapshotKey(controller.getSnapshot()) });
  }
  const offlineStorageVisible = snapshot?.connection && ["offline", "unreachable"].includes(snapshot.connection.status);
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><IconButton name="arrow-back-outline" label="Volver" onPress={onBack} /><SectionTitle title="Centro offline" subtitle={branchName ?? `Sucursal ${branchId}`} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.stack}>
        <Badge label={presentation.label} tone={presentation.tone === "error" ? "danger" : presentation.tone} />
        <BodyText>{presentation.secondary}</BodyText>
        <BodyText>{snapshot ? `${snapshot.pending} operación(es) pendientes · ${snapshot.conflicts} requieren atención` : "No se ha verificado la cola; no se presume vacía."}</BodyText>
        <BodyText>Datos locales al: {snapshot?.cachedAt ? new Date(snapshot.cachedAt).toLocaleString("es-CL") : "No disponible"}</BodyText>
        <BodyText>Última confirmación: {snapshot?.lastSyncedAt ? new Date(snapshot.lastSyncedAt).toLocaleString("es-CL") : "No disponible"}</BodyText>
        {skewMinutes >= 2 ? <Notice message={`La hora del teléfono está ${clockOffsetMs > 0 ? "atrasada" : "adelantada"} unos ${skewMinutes} min. La app la corrige con la hora de Qualitzer, pero conviene activar «Fecha y hora automáticas» en los ajustes del teléfono.`} tone="warning" /> : null}
        {snapshot?.authBlocked ? <Notice message="La sincronización está bloqueada hasta verificar de nuevo la sesión. Los pendientes se conservan; esta pantalla no cambia la autenticación." tone="warning" /> : null}
        {snapshot && snapshot.pending > 0 ? <BodyText>{PENDING_CHANGES_MESSAGE}</BodyText> : null}
        {!feedback && awaitingDeployment > 0 ? <BodyText>{awaitingDeployment} {awaitingDeployment === 1 ? "cambio requiere" : "cambios requieren"} actualizar el servicio. Contacta a soporte.</BodyText> : null}
        {!feedback && (snapshot?.lastError || snapshot?.connection?.errorCode) && !requiresDeployment(snapshot.lastError ?? snapshot.connection?.errorCode) ? <Notice message={syncUserError(snapshot.lastError ?? snapshot.connection?.errorCode)} tone="warning" /> : null}
        <Button title={technicalDetails ? "Ocultar diagnóstico de sincronización" : "Ver detalles técnicos de sincronización"} variant="ghost" onPress={() => setTechnicalDetails(!technicalDetails)} />
        {technicalDetails ? <>
          {snapshot?.lastError ? <Text selectable style={styles.caption}>{snapshot.lastError} · {operationErrorReason(snapshot.lastError)}</Text> : null}
          {snapshot?.connection?.errorCode ? <Text selectable style={styles.caption}>{snapshot.connection.errorCode}</Text> : null}
          {message ? <Text selectable style={styles.caption}>{message}</Text> : null}
        </> : null}
        <Button title="Sincronizar ahora" loading={action === "sync" || snapshot?.syncing} disabled={!presentation.canSync || !!action} onPress={() => void run("sync", sync)} />
        {feedback ? <Text accessibilityLiveRegion="polite" style={styles.caption}>{syncAttemptMessage(feedback, now)}</Text> : null}
        <BodyText>Mantén la app abierta para enviar los cambios. Una entrega guardada offline se confirma después de sincronizar sus operaciones anteriores.</BodyText>
      </Card>
      <Card style={styles.stack}>
        <SectionTitle title="Preparar hasta 7 fechas" subtitle={`${range.startDate} — ${range.endDate}`} />
        {!validWeek ? <Notice message="Selecciona un período válido de hasta 7 fechas para prepararlo." tone="warning" /> : null}
        {dates.map((date) => {
          const coverage = snapshot?.coverage.filter((entry) => entry.date === date && entry.branchId === branchId).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
          return <View key={date} style={styles.tight}><Text style={styles.label}>{date} · {coverage ? "Agenda en caché" : "No disponible offline"}</Text>{coverage ? <Text style={styles.caption}>Datos al {new Date(coverage.fetchedAt).toLocaleString("es-CL")}</Text> : null}</View>;
        })}
        <Button title="Preparar este período" icon="download-outline" loading={action === "prepare" || snapshot?.preparing} disabled={!snapshot || !presentation.ready || !presentation.canSync || !!action || snapshot.preparing || !validWeek} onPress={() => void run("prepare", onPrepare ?? (() => controller.prepareWeek(range, branchId)))} />
        <BodyText>La cobertura no es exhaustiva: agenda, primeras páginas y hasta {OFFLINE_LIMITS.prepareWorks} trabajos/grupos. Solo los archivos marcados como descargados tienen bytes locales. {onPrepare ? "La descarga depende del presupuesto configurado; no asegura todos los archivos." : "Esta preparación guarda datos y metadatos; no descarga archivos remotos."}</BodyText>
      </Card>
      {offlineStorageVisible ? <View style={styles.stack}>
        <SectionTitle title="Almacenamiento del dispositivo" />
        <BodyText>{snapshot.storage ? `Archivos offline: ${storageBytesLabel(snapshot.storage.usedBytes)} usados · ${storageBytesLabel(snapshot.storage.availableBytes)} disponibles aproximadamente.` : "No se pudo consultar el espacio disponible."}</BodyText>
        {snapshot.storage?.capacitySource === "device" ? <BodyText>Se reservan {storageBytesLabel(snapshot.storage.reserveBytes)} para el teléfono. El disponible cambia con el uso de otras apps.</BodyText> : <BodyText>Cuota local precautoria: {fileSizeLabel(OFFLINE_LIMITS.totalFileBytes)}. No representa todo el espacio libre del dispositivo.</BodyText>}
        <BodyText>Incluye archivos guardados y reservados por todos los perfiles en este teléfono. Máximo {fileSizeLabel(OFFLINE_LIMITS.fileBytes)} por archivo. La caché de datos usa hasta {fileSizeLabel(OFFLINE_LIMITS.cacheBytes)} por perfil, separada de los pendientes.</BodyText>
        <Notice message="No se borran pendientes para liberar espacio. Borrar los datos del navegador, desinstalar o perder el dispositivo puede destruir las copias locales aún no sincronizadas." tone="warning" />
      </View> : null}
      {/* Copias de lo ya enviado: se limpian solas a los 14 días; aquí se pueden liberar de inmediato. */}
      {controller.freeSpace ? <Card style={styles.stack}>
        <SectionTitle title="Espacio del teléfono" subtitle={snapshot?.storage ? `${storageBytesLabel(snapshot.storage.usedBytes)} usados por la app` : undefined} />
        <BodyText>Las fotos y archivos ya enviados se borran solos del teléfono a los 14 días. Puedes liberarlos ahora; lo pendiente nunca se borra.</BodyText>
        <Button title="Liberar espacio" icon="trash-bin-outline" variant="secondary" loading={action === "free"} disabled={!!action}
          onPress={() => void run("free", async () => { const bytes = await controller.freeSpace!(); setDiscarded(bytes > 0 ? `Se liberaron ${storageBytesLabel(bytes)}.` : "No había copias para liberar."); })} />
      </Card> : null}
      {(snapshot?.quarantined ?? 0) > 0 ? <Card style={styles.stack}>
        <Notice message={`${snapshot!.quarantined === 1 ? "Hay 1 cambio guardado" : `Hay ${snapshot!.quarantined} cambios guardados`} por otra versión de la app que no se puede leer. Se conserva aparte: compártelo como respaldo y, si ya no sirve, descártalo.`} tone="warning" />
        {controller.quarantineText ? <Button title="Compartir respaldo" icon="share-outline" variant="secondary" loading={action === "share:quarantine"} disabled={!!action}
          onPress={() => void run("share:quarantine", async () => {
            const { Share } = await import("react-native");
            await Share.share({ message: `Respaldo Qualitzer (cambios no legibles)\n\n${controller.quarantineText!()}` });
          })} /> : null}
        {controller.discardQuarantine ? <Button title="Descartar estos cambios" icon="trash-outline" variant="secondary" iconColor={palette.danger} textStyle={{ color: palette.danger }} disabled={!!action}
          onPress={() => setDiscardingQuarantine(true)} /> : null}
      </Card> : null}
      {discardingQuarantine && controller.discardQuarantine ? <Modal visible transparent animationType="fade" onRequestClose={() => setDiscardingQuarantine(false)}>
        <View style={styles.modalOverlay}><View style={[styles.modalCard, styles.modalContent]} accessibilityViewIsModal>
          <SectionTitle title="¿Descartar los cambios no legibles?" />
          <BodyText>No se enviarán a Qualitzer y no se pueden recuperar desde la app. Comparte antes un respaldo si lo necesitas.</BodyText>
          <View style={styles.row}>
            <View style={styles.grow}><Button title="Cancelar" variant="secondary" onPress={() => setDiscardingQuarantine(false)} /></View>
            <View style={styles.grow}><Button title="Descartar" variant="danger" loading={action === "quarantine"} disabled={!!action}
              onPress={() => void run("quarantine", async () => { const count = await controller.discardQuarantine!(); setDiscardingQuarantine(false); setDiscarded(`Se descartaron ${count} cambios no legibles.`); })} /></View>
          </View>
        </View></View>
      </Modal> : null}
      {message ? <Notice message={userErrorText(message)} tone="error" onDismiss={() => setMessage(null)} /> : null}
      <SectionTitle title="Registro de operaciones" subtitle="El texto local, la base y los recibos se conservan para revisión." />
      {[...(snapshot?.operations ?? [])].sort((a, b) => b.createdAt - a.createdAt).map((operation) => {
        const dependency = dependencyInfo(operation, dependencies);
        const parent = dependency.parent;
        return <Card key={operation.id} style={styles.stack}>
        <SectionTitle title={operationTitle(operation)} subtitle={new Date(operation.createdAt).toLocaleString("es-CL")} />
        <Badge label={dependency.status === "ready" ? operationStatusLabels[operation.status] : dependency.title} tone={operation.status === "applied" ? "success" : "warning"} />
        {operation.kind === "comment" ? <Text selectable style={styles.label}>{operation.text}</Text> : null}
        {operation.kind === "create" ? <BodyText>{operation.input.kind === "work" ? operation.input.work.summary : operation.input.kind === "maintenance" ? operation.input.maintenance.motive : operation.input.nonProductive.initialComment ?? operation.input.nonProductive.reasonText ?? "Tiempo no productivo"}</BodyText> : null}
        {operation.lastError && !requiresDeployment(operation.lastError) ? <Notice message={syncUserError(operation.lastError)} tone="warning" /> : null}
        {dependency.status !== "ready" ? <View style={styles.tight}>
          <BodyText>{parent?.lastError ? syncUserError(parent.lastError) : dependency.reason}</BodyText>
          {parent ? <><BodyText>{operationTitle(parent)}</BodyText><OperationDetails operation={parent} title="Ver detalles de la operación anterior" /></> : null}
          {parent && canRetryOperation(parent) ? <Button title="Reintentar operación anterior" variant="secondary" loading={action === parent.id} disabled={!presentation.canSync || !!action} onPress={() => void run(parent.id, () => controller.retry(parent.id))} /> : null}
        </View> : null}
        <OperationDetails operation={operation} />
        {operation.kind === "document" ? <OfflineFileCard file={{ ...pendingDocumentAttachment(operation), offline: { ...pendingDocumentAttachment(operation).offline, confirmed: operation.status === "applied" } }} readLocalFile={(id) => controller.readLocalFile(id)} /> : null}
        {dependency.status === "ready" && canRetryOperation(operation) ? <Button title="Reintentar misma operación" variant="secondary" loading={action === operation.id} disabled={!presentation.canSync || !!action} onPress={() => void run(operation.id, () => controller.retry(operation.id))} /> : operation.status === "pending" && dependency.status === "ready" ? <BodyText>Guardado. Se reintentará automáticamente respetando el tiempo de espera.</BodyText> : null}
        {/* Choque de checklist: el técnico decide qué respuesta queda. */}
        {operation.kind === "answer" && operation.status === "conflict" && controller.resolveAnswerConflict ? <View style={styles.tight}>
          <BodyText>Otra persona cambió este paso del checklist en Qualitzer. Elige qué respuesta queda.</BodyText>
          <Button title="Mantener mi respuesta" icon="checkmark-done-outline" loading={action === `keep:${operation.id}`} disabled={!!action || !presentation.canSync}
            onPress={() => void run(`keep:${operation.id}`, () => controller.resolveAnswerConflict!(operation.id, true))} />
          <Button title="Usar la de Qualitzer" icon="cloud-download-outline" variant="secondary" loading={action === `drop:${operation.id}`} disabled={!!action}
            onPress={() => void run(`drop:${operation.id}`, () => controller.resolveAnswerConflict!(operation.id, false))} />
        </View> : null}
        {/* Lo que ya terminó mal no queda atascado: se respalda (compartir) y se puede descartar con doble confirmación. */}
        {controller.discard && DISCARDABLE_STATUSES.includes(operation.status) && !(operation.kind === "answer" && operation.status === "conflict" && controller.resolveAnswerConflict) ? <View style={styles.tight}>
          <BodyText>No se pudo aplicar en Qualitzer. Puedes guardar un respaldo y descartarlo para seguir trabajando.</BodyText>
          <Button title="Compartir respaldo" icon="share-outline" variant="secondary" loading={action === `share:${operation.id}`} disabled={!!action}
            onPress={() => void run(`share:${operation.id}`, async () => {
              const uri = operation.kind === "document" ? (await controller.readLocalFile(operation.file.id).catch(() => null))?.uri : undefined;
              // Se carga al usarlo: compartir depende del teléfono.
              const { shareOperationBackup } = await import("../../offline/shareBackup");
              if (!await shareOperationBackup(operation, operationTitle(operation), uri)) throw new Error("Este dispositivo no permite compartir. Copia el texto desde los detalles.");
            })} />
          <Button title="Descartar…" icon="trash-outline" variant="secondary" iconColor={palette.danger} textStyle={{ color: palette.danger }} disabled={!!action}
            onPress={() => setDiscarding(operation)} />
        </View> : null}
      </Card>; })}
      {snapshot && snapshot.operations.length === 0 ? <BodyText>No hay operaciones registradas en esta sesión y sucursal.</BodyText> : null}
    </ScrollView>
    {discarding && controller.discard ? <DiscardDialog operation={discarding} affected={discardSet(snapshot?.operations ?? [], discarding.id)} busy={action === "discard"}
      onClose={() => { if (action !== "discard") setDiscarding(null); }}
      onConfirm={() => void run("discard", async () => {
        const removed = await controller.discard!(discarding.id);
        setDiscarding(null);
        setMessage(null);
        setDiscarded(removed.length === 1 ? "Se descartó 1 operación." : `Se descartaron ${removed.length} operaciones.`);
      })} /> : null}
    {discarded ? <View style={styles.tight}><Notice message={discarded} tone="success" onDismiss={() => setDiscarded(null)} /></View> : null}
  </SafeAreaView>;
}

/** Doble confirmación: primero se ve qué se descarta (también lo que depende de ello) y después se confirma de nuevo. */
function DiscardDialog({ operation, affected, busy, onClose, onConfirm }: { operation: OfflineOperation; affected: OfflineOperation[]; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const [sure, setSure] = useState(false);
  const others = affected.filter((entry) => entry.id !== operation.id);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.modalOverlay}><View style={[styles.modalCard, styles.modalContent]} accessibilityViewIsModal>
      <SectionTitle title={sure ? "¿Seguro? No se puede deshacer" : "¿Descartar esta operación?"} subtitle={operationTitle(operation)} />
      <BodyText>{sure ? "Lo descartado no se enviará a Qualitzer y se borran sus archivos de este teléfono. Si no guardaste un respaldo, compártelo antes."
        : "No se enviará a Qualitzer. Úsalo solo si ya no se puede aplicar (por ejemplo, el trabajo cambió o se eliminó)."}</BodyText>
      {others.length > 0 ? <View style={styles.tight}>
        <Text style={styles.label}>También se descartan {others.length === 1 ? "1 operación que depende de esta" : `${others.length} operaciones que dependen de esta`}:</Text>
        {others.slice(0, 8).map((entry) => <BodyText key={entry.id}>• {operationTitle(entry)}</BodyText>)}
        {others.length > 8 ? <BodyText>…y {others.length - 8} más.</BodyText> : null}
      </View> : null}
      <View style={styles.row}>
        <View style={styles.grow}><Button title="Cancelar" variant="secondary" disabled={busy} onPress={onClose} /></View>
        <View style={styles.grow}>{sure ? <Button title="Descartar definitivamente" icon="trash-outline" variant="danger" loading={busy} disabled={busy} onPress={onConfirm} />
          : <Button title="Continuar" variant="danger" onPress={() => setSure(true)} />}</View>
      </View>
    </View></View>
  </Modal>;
}
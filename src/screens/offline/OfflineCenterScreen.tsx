import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DateRange } from "../../domain/models";
import type { OfflineController, OfflineOperation, OfflineSnapshot } from "../../domain/offline";
import { OFFLINE_LIMITS } from "../../offline/contracts";
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

export interface OfflineCenterScreenProps {
  controller: OfflineController;
  snapshot: OfflineSnapshot | null;
  range: DateRange;
  branchId: number;
  branchName?: string;
  onBack: () => void;
  onPrepare?: () => Promise<void>;
}

function OperationDetails({ operation, title = "Ver detalles técnicos" }: { operation: OfflineOperation; title?: string }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.tight}>
    <Button title={expanded ? "Ocultar detalles" : title} variant="ghost" onPress={() => setExpanded(!expanded)} />
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
      {operation.kind === "timer" || operation.kind === "checklist" ? <Text selectable style={styles.caption}>Solicitud local: {JSON.stringify(operation.payload, null, 2)}</Text> : null}
    </>}
    {operation.receipt ? <Text selectable style={styles.caption}>Recibo: {JSON.stringify(operation.receipt, null, 2)}</Text> : null}
    </> : null}
  </View>;
}

export function OfflineCenterScreen({ controller, snapshot, range, branchId, branchName, onBack, onPrepare }: OfflineCenterScreenProps) {
  const lock = useRef(false);
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [technicalDetails, setTechnicalDetails] = useState(false);
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
  const files = new Map((snapshot?.operations ?? []).flatMap((operation) => operation.kind === "document" ? [[operation.file.id, operation.file.size] as const] : []));
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><IconButton name="arrow-back-outline" label="Volver" onPress={onBack} /><SectionTitle title="Centro offline" subtitle={branchName ?? `Sucursal ${branchId}`} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.stack}>
        <Badge label={presentation.label} tone={presentation.tone === "error" ? "danger" : presentation.tone} />
        <BodyText>{presentation.secondary}</BodyText>
        <BodyText>{snapshot ? `${snapshot.pending} operación(es) pendientes · ${snapshot.conflicts} requieren atención` : "No se ha verificado la cola; no se presume vacía."}</BodyText>
        <BodyText>Datos locales al: {snapshot?.cachedAt ? new Date(snapshot.cachedAt).toLocaleString("es-CL") : "No disponible"}</BodyText>
        <BodyText>Última confirmación: {snapshot?.lastSyncedAt ? new Date(snapshot.lastSyncedAt).toLocaleString("es-CL") : "No disponible"}</BodyText>
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
        <BodyText>Mantén la app abierta para enviar los cambios. La entrega requiere conexión y no tener pendientes.</BodyText>
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
      <Card style={styles.stack}>
        <SectionTitle title="Almacenamiento del dispositivo" />
        <BodyText>Archivos de operaciones visibles: {fileSizeLabel([...files.values()].reduce((sum, size) => sum + size, 0))}. No es el uso total del dispositivo.</BodyText>
        <BodyText>Límites: {fileSizeLabel(OFFLINE_LIMITS.fileBytes)} por archivo · {fileSizeLabel(OFFLINE_LIMITS.totalFileBytes)} globales · caché de datos {fileSizeLabel(OFFLINE_LIMITS.cacheBytes)}. Espacio libre y descargas confirmadas: no informados por este controlador.</BodyText>
        <Notice message="No se borran pendientes para liberar espacio. Borrar los datos del navegador, desinstalar o perder el dispositivo puede destruir las copias locales aún no sincronizadas." tone="warning" />
      </Card>
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
        {dependency.status === "ready" && canRetryOperation(operation) ? <Button title="Reintentar misma operación" variant="secondary" loading={action === operation.id} disabled={!presentation.canSync || !!action} onPress={() => void run(operation.id, () => controller.retry(operation.id))} /> : operation.status === "pending" && dependency.status === "ready" ? <BodyText>Guardado. Se reintentará automáticamente respetando el tiempo de espera.</BodyText> : dependency.status === "ready" && operation.status !== "applied" && operation.status !== "syncing" ? <BodyText>Se conserva para revisión. No se reenvía a ciegas ni se descarta desde aquí.</BodyText> : null}
      </Card>; })}
      {snapshot && snapshot.operations.length === 0 ? <BodyText>No hay operaciones registradas en esta sesión y sucursal.</BodyText> : null}
    </ScrollView>
  </SafeAreaView>;
}
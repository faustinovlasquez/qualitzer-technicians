import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, ScrollView, Text, View } from "react-native";
import { DeviceSecurityContext, PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { CameraPermissionError } from "../../domain/cameraErrors";
import type { Attachment, LocalPhoto } from "../../domain/models";
import type { OfflineController, OfflineSnapshot } from "../../domain/offline";
import { OfflineFileCard } from "../offline/OfflineFileCard";
import { isConfirmedAttachment, offlineAttachment, pendingDocumentAttachment, type PendingDocument } from "../offline/offlineUi";
import { syncUserError, userErrorText } from "../offline/syncUserPresentation";
import { BodyText, Button, IconButton, SectionTitle } from "../../ui/components";
import { palette } from "../../ui/theme";
import { Notice } from "./DetailUi";
import { errorMessage } from "./detailRules";
import { styles } from "./detailStyles";
import { pickWorkspaceFiles } from "./files/filePicker";
import { fileSizeLabel, MAX_FILES, type FileSource } from "./files/fileRules";
import { useWorkspaceDraft } from "./files/WorkspaceDraftStore";
import { PendingFileList, SavedFileList } from "./files/WorkspaceFileList";
import { workspaceStyles } from "./files/workspaceStyles";
import { fileSavePresentation } from "./files/fileSavePresentation";
import { saveFileBatch } from "./files/saveFileBatch";
import { useTrustedNativePicker } from "../../security/useTrustedNativePicker";
import { CameraPermissionGuide } from "./files/CameraPermissionGuide";
import { useCameraPermissionGuide } from "./files/useCameraPermissionGuide";

export { cleanupFileWorkspace } from "./files/WorkspaceDraftStore";

export interface FileWorkspaceProps {
  backHandler?: { current: ((home?: boolean) => boolean) | null };
  scopeKey: string;
  resourceKey?: string;
  mode: "live" | "demo";
  readOnly: boolean;
  busy?: boolean;
  title?: string;
  compact?: boolean;
  autoSave?: boolean;
  headerAction?: ReactNode;
  requirement?: string;
  notices?: ReactNode;
  listFooter?: ReactNode;
  onLoad: () => Promise<Attachment[]>;
  onUpload: (files: LocalPhoto[]) => Promise<void>;
  onDelete?: (fileId: string) => Promise<void>;
  offline?: OfflineSnapshot | null;
  pending?: PendingDocument[];
  readLocalFile?: OfflineController["readLocalFile"];
}

interface WorkspaceMessage { text: string; tone: "error" | "success" | "warning"; }

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Estado visual del guardado: progreso mientras se envía, subida al servidor y confirmación final. */
function SaveStatusCard({ state, done, total, detail }: { state: "saving" | "syncing" | "offline" | "saved"; done: number; total: number; detail?: string }) {
  const saved = state === "saved";
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : saved ? 1 : 0;
  const title = saved ? total === 1 ? "Archivo guardado correctamente" : `${plural(total, "archivo guardado", "archivos guardados")} correctamente`
    : state === "saving" ? `Guardando ${Math.min(done + 1, total)} de ${total}…`
    : state === "offline" ? "Guardado en el teléfono"
    : `Subiendo al servidor · ${done} de ${total}`;
  const subtitle = saved ? "Ya quedó registrado en el trabajo." : state === "offline" ? "Se subirá automáticamente cuando vuelva la conexión. No necesitas repetirlo." : detail ?? "No cierres la app mientras termina.";
  return <View style={[workspaceStyles.saveCard, saved ? workspaceStyles.saveCardDone : state === "offline" ? workspaceStyles.saveCardOffline : null]} accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityLabel={`${title}. ${subtitle}`} testID="file-save-status">
    <View style={workspaceStyles.saveCardRow}>
      {saved ? <View style={workspaceStyles.saveCheck}><Text style={workspaceStyles.saveCheckMark}>✓</Text></View>
        : state === "offline" ? <View style={[workspaceStyles.saveCheck, workspaceStyles.saveCheckOffline]}><Text style={workspaceStyles.saveCheckMark}>↻</Text></View>
        : <ActivityIndicator color={palette.primary} />}
      <View style={workspaceStyles.saveCardText}>
        <Text style={[workspaceStyles.saveCardTitle, saved ? workspaceStyles.saveCardTitleDone : null]}>{title}</Text>
        <Text style={styles.caption} numberOfLines={2}>{subtitle}</Text>
      </View>
    </View>
    {!saved ? <View style={workspaceStyles.saveTrack}><View style={[workspaceStyles.saveFill, { width: `${Math.max(8, Math.round(ratio * 100))}%` }, state === "offline" ? workspaceStyles.saveFillOffline : null]} /></View> : null}
  </View>;
}

export function FileWorkspace(props: FileWorkspaceProps) {
  return <FileWorkspaceContent key={JSON.stringify([props.mode, props.scopeKey])} {...props} />;
}

function FileWorkspaceContent(props: FileWorkspaceProps) {
  const runNativePicker = useTrustedNativePicker();
  const security = useContext(DeviceSecurityContext);
  const securityRef = useRef(security);
  securityRef.current = security;
  const draft = useWorkspaceDraft(props.scopeKey, props.mode);
  const callbacks = useRef(props);
  callbacks.current = props;
  const active = useRef(false);
  const generation = useRef(0);
  const pickerGeneration = useRef(0);
  const pickerContext = useRef({ resource: props.resourceKey, identity: Symbol() });
  if (pickerContext.current.resource !== props.resourceKey) pickerContext.current = { resource: props.resourceKey, identity: Symbol() };
  const selectionLease = useRef<symbol | null>(null);
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<WorkspaceMessage | null>(null);
  const [operation, setOperation] = useState<"select" | "prepare" | "upload" | "delete" | "remove" | null>(null);
  const [progress, setProgress] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ index: number; total: number; name: string } | null>(null);
  // Archivos enviados a la cola en este guardado: se sigue su subida para avisar cuando queden confirmados.
  const [syncWatch, setSyncWatch] = useState<{ total: number } | null>(null);
  const [savedFlash, setSavedFlash] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Attachment | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const handler = props.backHandler;
    if (!handler) return;
    const back = (home = false): boolean => {
      if (operation !== null || draft.store.getSnapshot().fileBusy || draft.store.getSnapshot().saving) return true;
      if (!home && deleting) { setDeleting(null); return true; }
      if (!home && help) { setHelp(false); return true; }
      return false;
    };
    handler.current = back;
    return () => { if (handler.current === back) handler.current = null; };
  }, [props.backHandler, operation, deleting, help, draft.store]);
  const list = useRef<ScrollView>(null);
  const cameraGuide = useCameraPermissionGuide(JSON.stringify([props.mode, props.scopeKey, props.resourceKey]), () => active.current && !callbacks.current.readOnly && !callbacks.current.busy && callbacks.current.offline !== null && !callbacks.current.offline?.authBlocked);
  const unavailable = props.readOnly || props.busy === true || props.offline === null || props.offline?.authBlocked === true || draft.closed || !draft.hydrated || draft.fileBusy;
  const pending = draft.files.filter((file) => !file.uploaded);
  const savePresentation = fileSavePresentation(props.mode, pending.length, props.offline);
  const offlineLoading = props.offline === null;
  const deletionDisabled = props.offline !== undefined && (!props.offline?.online || props.offline.authBlocked);
  const displayedFiles = new Map((files ?? []).map((file) => [String(file.id), file]));
  for (const operation of props.pending ?? []) {
    if (operation.status === "applied") continue;
    for (const [id, existing] of displayedFiles) {
      if (offlineAttachment(existing)?.offline.operationId === operation.id) displayedFiles.delete(id);
    }
    const file = pendingDocumentAttachment(operation);
    displayedFiles.set(String(file.id), file);
  }
  const localFiles = [...displayedFiles.values()].flatMap((file) => { const local = offlineAttachment(file); return local && !local.offline.confirmed ? [local] : []; });
  const remoteFiles = [...displayedFiles.values()].filter((file) => isConfirmedAttachment(file) && !String(file.id).startsWith("local-"));
  useEffect(() => { if (message || draft.error || loadError) list.current?.scrollTo({ y: 0, animated: false }); }, [message, draft.error, loadError]);
  const queuedLocal = localFiles.length;
  // Un archivo con error queda señalado en su propia tarjeta; la subida en curso ya no lo cuenta.
  const stuckLocal = localFiles.filter((file) => ["blocked", "auth_required", "needs_review", "conflict"].includes(file.offline.status ?? "pending")).length;
  useEffect(() => {
    if (syncWatch === null) return;
    if (queuedLocal === 0) { setSavedFlash(syncWatch.total); setSyncWatch(null); }
    else if (stuckLocal === queuedLocal) setSyncWatch(null);
  }, [syncWatch, queuedLocal, stuckLocal]);
  useEffect(() => {
    if (savedFlash === null) return;
    const timer = setTimeout(() => setSavedFlash(null), 4500);
    return () => clearTimeout(timer);
  }, [savedFlash]);
  const saveStatus = operation === "upload" && uploadProgress
    ? <SaveStatusCard state="saving" done={uploadProgress.index - 1} total={uploadProgress.total} detail={uploadProgress.name} />
    : syncWatch !== null && queuedLocal > 0
      ? <SaveStatusCard state={props.offline !== undefined && props.offline !== null && !props.offline.online ? "offline" : "syncing"} done={Math.max(0, syncWatch.total - queuedLocal)} total={Math.max(syncWatch.total, queuedLocal)} />
      : savedFlash !== null ? <SaveStatusCard state="saved" done={savedFlash} total={savedFlash} /> : null;

  const load = useCallback(async (): Promise<boolean> => {
    const request = ++generation.current;
    if (active.current) { setLoading(true); setLoadError(null); }
    try {
      const result = await callbacks.current.onLoad();
      if (active.current && request === generation.current) { setFiles(result); return true; }
    } catch (error) {
      if (active.current && request === generation.current) setLoadError(`No se pudieron consultar los archivos: ${errorMessage(error)}`);
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
    return false;
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      generation.current += 1;
      pickerGeneration.current += 1;
      if (selectionLease.current) draft.store.endFiles(selectionLease.current);
      selectionLease.current = null;
    };
  }, [load, draft.store]);

  const previousResource = useRef(props.resourceKey);
  useEffect(() => {
    if (previousResource.current === props.resourceKey) return;
    previousResource.current = props.resourceKey;
    void load();
  }, [load, props.resourceKey]);

  const appliedRevision = props.offline?.operations.filter((operation) => operation.kind === "document" && operation.status === "applied").map((operation) => operation.id).join("|") ?? "";
  const previousAppliedRevision = useRef(appliedRevision);
  useEffect(() => {
    if (previousAppliedRevision.current === appliedRevision) return;
    previousAppliedRevision.current = appliedRevision;
    void load();
  }, [appliedRevision, load]);

  async function pick(source: FileSource, isCurrent: () => boolean = () => true): Promise<void> {
    if (!isCurrent() || !active.current || !(securityRef.current?.isUnlocked() ?? true) || callbacks.current.readOnly || callbacks.current.busy || callbacks.current.offline === null || callbacks.current.offline?.authBlocked) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    selectionLease.current = lease;
    const token = ++pickerGeneration.current;
    const context = pickerContext.current.identity;
    const canContinue = (): boolean => isCurrent() && active.current && token === pickerGeneration.current && pickerContext.current.identity === context && (securityRef.current?.isUnlocked() ?? true) && !callbacks.current.readOnly && !callbacks.current.busy && callbacks.current.offline !== null && !callbacks.current.offline?.authBlocked;
    let permissionError: CameraPermissionError | null = null;
    let addedIds: string[] = [];
    setMessage(null);
    setOperation("select");
    try {
      const selected = await pickWorkspaceFiles(source, MAX_FILES - draft.store.getSnapshot().files.length, runNativePicker, canContinue);
      if (token !== pickerGeneration.current || !active.current) return;
      if (!canContinue()) throw new Error("La selección se canceló porque este destino ya no permite cambios en este momento.");
      if (selected.length === 0) return;
      selectionLease.current = null;
      setOperation("prepare");
      const previousIds = new Set(draft.store.getSnapshot().files.map(file => file.id));
      await draft.store.addFiles(selected);
      addedIds = draft.store.getSnapshot().files.filter(file => !previousIds.has(file.id)).map(file => file.id);
    } catch (error) {
      if (source === "camera" && error instanceof CameraPermissionError) permissionError = error;
      else if (active.current && token === pickerGeneration.current) setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      draft.store.endFiles(lease);
      if (selectionLease.current === lease) selectionLease.current = null;
      if (active.current && token === pickerGeneration.current) setOperation(null);
    }
    if (addedIds.length > 0 && callbacks.current.autoSave && canContinue()) await upload(addedIds);
    if (permissionError && canContinue()) cameraGuide.handleError(permissionError, { onRetry: current => pick("camera", current), onGallery: current => pick("library", current) });
  }

  function cancelPicker(): void {
    if (operation !== "select") return;
    pickerGeneration.current += 1;
    if (selectionLease.current) draft.store.endFiles(selectionLease.current);
    selectionLease.current = null;
    setOperation(null);
    setMessage({ text: "Selección cancelada. No se añadió ni envió ningún archivo.", tone: "warning" });
  }

  async function remove(id: string): Promise<void> {
    if (!active.current || callbacks.current.readOnly || callbacks.current.busy || callbacks.current.offline?.authBlocked) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    setOperation("remove");
    setMessage(null);
    try { await draft.store.removeFile(id); }
    catch (error) { if (active.current) setMessage({ text: errorMessage(error), tone: "error" }); }
    finally { draft.store.endFiles(lease); if (active.current) setOperation(null); }
  }

  async function upload(fileIds?: readonly string[]): Promise<void> {
    if (!active.current || !(securityRef.current?.isUnlocked() ?? true) || callbacks.current.readOnly || callbacks.current.busy || callbacks.current.offline === null || callbacks.current.offline?.authBlocked) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    const uploadFile = callbacks.current.onUpload;
    const resource = callbacks.current.resourceKey;
    setMessage(null);
    setSavedFlash(null);
    setOperation("upload");
    try {
      const { saved, queued, failure } = await saveFileBatch({
        store: draft.store, upload: uploadFile, fileIds,
        canContinue: () => active.current && (securityRef.current?.isUnlocked() ?? true) && !callbacks.current.readOnly && callbacks.current.offline !== null && !callbacks.current.offline?.authBlocked && callbacks.current.resourceKey === resource,
        requireSource: callbacks.current.offline === undefined,
        onProgress: (index, total, name) => { if (active.current) { setProgress(`${index}/${total} · ${name}`); setUploadProgress({ index, total, name }); } },
      });
      if (saved > 0 && active.current) void load();
      if (active.current) {
        if (failure) {
          const done = saved + queued;
          setMessage({ text: `${done > 0 ? `${plural(done, "archivo guardado", "archivos guardados")}. ` : ""}${failure} Los restantes se conservan; reintenta solo los pendientes.`, tone: done === 0 ? "error" : "warning" });
        }
        // Lo enviado a la cola se sigue en la tarjeta de estado hasta que el servidor lo confirme.
        if (queued > 0) setSyncWatch((current) => ({ total: (current?.total ?? 0) + queued }));
        else if (saved > 0 && !failure) setSavedFlash(saved);
      }
    } catch (error) {
      if (active.current) setMessage({ text: `No se pudo terminar el guardado. Conserva los borradores y revisa la cola antes de reintentar: ${errorMessage(error)}`, tone: "error" });
    } finally {
      if (active.current) { setOperation(null); setProgress(""); setUploadProgress(null); }
      draft.store.endFiles(lease);
    }
  }

  async function deleteSaved(): Promise<void> {
    const onDelete = callbacks.current.onDelete;
    if (!active.current || !deleting || !onDelete || callbacks.current.readOnly || callbacks.current.busy || deletionDisabled || (callbacks.current.offline !== undefined && (!callbacks.current.offline?.online || callbacks.current.offline.authBlocked)) || !isConfirmedAttachment(deleting) || String(deleting.id).startsWith("local-")) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    setMessage(null);
    setOperation("delete");
    try {
      const deletedId = String(deleting.id);
      await onDelete(deletedId);
      if (active.current) {
        generation.current += 1;
        setFiles(current => current?.filter(file => String(file.id) !== deletedId) ?? null);
        setDeleting(null);
      }
      const refreshed = active.current ? await load() : true;
      if (active.current) setMessage({ text: refreshed ? "Archivo eliminado." : "El archivo se eliminó, pero no se pudo actualizar la lista. Actualízala; no repitas la eliminación.", tone: refreshed ? "success" : "warning" });
    } catch (error) { if (active.current) setMessage({ text: `No se confirmó la eliminación: ${errorMessage(error)}`, tone: "error" }); }
    finally { draft.store.endFiles(lease); if (active.current) setOperation(null); }
  }

  async function retryDraft(): Promise<void> {
    try { await draft.store.retry(); }
    catch (error) { if (active.current) setMessage({ text: errorMessage(error), tone: "error" }); }
  }

  const listContent = <View style={styles.tight}>
      {props.notices}
      {props.readOnly ? <Notice message="Solo lectura · puedes consultar los archivos." /> : null}
      {draft.error ? <View style={styles.tight}><Notice message={userErrorText(draft.error)} tone="error" />{!draft.closed ? <Button title="Reintentar borrador" variant="secondary" disabled={draft.saving || draft.fileBusy || props.busy} onPress={() => { void retryDraft(); }} /> : null}</View> : null}
      {!draft.hydrated && !draft.error ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><BodyText>Recuperando borradores de este destino…</BodyText></View> : null}
      {draft.fileBusy && operation === null ? <Notice message="Hay una operación de archivos en curso para este destino. Espera a que termine antes de realizar otra." /> : null}
      {saveStatus}
      {message ? <Notice message={userErrorText(message.text)} tone={message.tone} onDismiss={() => setMessage(null)} /> : null}
      {props.compact && Platform.OS === "web" && pending.length > 0 ? <Text style={styles.caption}>Sin guardar: se pierden al recargar.</Text> : null}
      {draft.hydrated && pending.length > 0 ? <Text style={styles.label}>{pending.length} sin guardar · {fileSizeLabel(draft.files.reduce((sum, file) => sum + file.size, 0))} / 40 MiB</Text> : null}
      <PendingFileList files={props.offline !== undefined ? pending : draft.files} expanded={props.autoSave} disabled={unavailable} onRemove={(id) => { void remove(id); }} />
      {draft.files.some((file) => file.uploaded) ? <View style={styles.tight}><Notice message="Ya transferidos; no se reenviarán. Falta limpiar el borrador original." tone="warning" />{draft.files.filter((file) => file.uploaded).map((file) => <Button key={file.id} title={`Limpiar borrador original: ${file.name}`} variant="secondary" disabled={unavailable} onPress={() => void remove(file.id)} />)}</View> : null}
      <View style={styles.between}><Text style={styles.label}>{[...displayedFiles.values()].filter(isConfirmedAttachment).length}{props.mode === "demo" ? " en listado demo" : " confirmados"} · {localFiles.filter((file) => !file.offline.confirmed).length} en cola</Text><IconButton label={loadError ? "Reintentar archivos" : "Actualizar archivos"} name="refresh-outline" disabled={loading || props.busy || draft.fileBusy || draft.closed} onPress={() => { void load(); }} /></View>
      {props.mode === "demo" && localFiles.some((file) => !file.offline.confirmed) ? <Notice message="El listado demo no confirma los envíos en cola. Sus copias pendientes se conservan." tone="warning" /> : null}
      {loading ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><BodyText>Consultando archivos…</BodyText></View> : null}
      {loadError ? <Notice message={`${userErrorText(loadError)}${files !== null ? " La lista visible corresponde a la última consulta correcta." : " No se ha verificado si hay archivos."}`} tone="error" /> : null}
      {localFiles.map((file) => {
        const error = props.pending?.find((operation) => operation.id === file.offline.operationId)?.lastError;
        return <View key={String(file.id)} style={styles.tight}>
        <OfflineFileCard file={file} readLocalFile={props.offline?.authBlocked ? undefined : props.readLocalFile} expanded={props.autoSave} />
        {error ? <Notice message={syncUserError(error)} tone="warning" /> : null}
        {props.onDelete ? <Button title="Eliminar archivo" variant="secondary" disabled={unavailable || deletionDisabled || !file.offline.confirmed || String(file.id).startsWith("local-") || loading || !!loadError} onPress={() => setDeleting(file)} /> : null}
      </View>; })}
      {remoteFiles.length > 0 ? <SavedFileList files={remoteFiles} mode={props.mode} readLocalFile={!loadError && !props.offline?.authBlocked ? props.readLocalFile : undefined} canDelete={!unavailable && !loading && !loadError && !deletionDisabled} onDelete={props.onDelete ? setDeleting : undefined} /> : displayedFiles.size === 0 && files !== null && !loadError && !loading ? <BodyText>No hay archivos guardados en este destino.</BodyText> : null}
      {props.listFooter}
    </View>;
  const connection = props.offline === null ? "Recuperando cola…" : props.offline?.authBlocked ? "Verifica tu sesión · pendientes conservados" : props.mode === "demo" ? "Demostración · guardado local" : props.offline === undefined ? "Carga manual · espera confirmación" : "Guarda los archivos seleccionados";

  return <View style={props.compact ? workspaceStyles.bounded : styles.stack} testID="file-workspace">
    <View style={workspaceStyles.toolbar} testID="files-toolbar">
      <View style={workspaceStyles.controls}>
        <Text accessibilityRole="header" numberOfLines={2} style={workspaceStyles.title}>{props.title ?? "Archivos"}</Text>
        {props.headerAction}
        <IconButton name="information-circle-outline" label="Ayuda de archivos y límites" onPress={() => setHelp(true)} />
      </View>
      {props.requirement ? <Text style={styles.caption}>{props.requirement}</Text> : null}
      {!props.readOnly ? <View style={workspaceStyles.controls}>
        <Button title="Cámara" icon="camera-outline" variant="secondary" style={workspaceStyles.compactPicker} textStyle={workspaceStyles.compactPickerText} disabled={unavailable || draft.files.length >= MAX_FILES} onPress={() => { void pick("camera"); }} />
        <Button title="Galería" icon="images-outline" variant="secondary" style={workspaceStyles.compactPicker} textStyle={workspaceStyles.compactPickerText} disabled={unavailable || draft.files.length >= MAX_FILES} onPress={() => { void pick("library"); }} />
        <Button title="Archivos" icon="folder-open-outline" variant="secondary" style={workspaceStyles.compactPicker} textStyle={workspaceStyles.compactPickerText} disabled={unavailable || draft.files.length >= MAX_FILES} onPress={() => { void pick("document"); }} />
      </View> : null}
    </View>
    {props.compact ? <ScrollView ref={list} style={workspaceStyles.list} contentContainerStyle={workspaceStyles.listContent} keyboardShouldPersistTaps="handled" testID="files-list-scroll">{listContent}</ScrollView> : <View style={workspaceStyles.listContent}>{listContent}</View>}
    <View style={workspaceStyles.dock} testID="files-save-dock">
      <Text style={styles.caption} accessibilityLiveRegion="polite" numberOfLines={2}>{progress || (operation === "select" ? "Esperando selección…" : operation === "prepare" ? "Protegiendo archivos…" : props.autoSave && !offlineLoading && !props.offline?.authBlocked ? pending.length > 0 ? `${pending.length} archivo(s) por guardar` : localFiles.length > 0 ? "Guardado local · pendiente de sincronizar" : "Sin archivos por guardar" : connection)}</Text>
      {!props.compact && Platform.OS === "web" && pending.length > 0 ? <Text style={styles.caption}>Sin guardar: se pierden al recargar.</Text> : null}
      {operation === "select" && Platform.OS === "web" ? <Button title="Ya cerré el selector · cancelar" variant="secondary" onPress={cancelPicker} /> : !props.readOnly && (!props.autoSave || pending.length > 0 || operation === "upload") ? <Button title={props.autoSave ? `${props.compact ? "Guardar" : "Guardar pendientes"} · ${pending.length}` : savePresentation.title} accessibilityLabel={props.autoSave ? `Guardar pendientes · ${pending.length}` : savePresentation.title} icon="cloud-upload-outline" disabled={unavailable || offlineLoading || pending.length === 0 || draft.saving || draft.error !== null} loading={operation === "upload"} onPress={() => { void upload(); }} /> : null}
    </View>
    <CameraPermissionGuide guide={cameraGuide} />
    <Modal visible={help} transparent animationType="fade" onRequestClose={() => setHelp(false)}>
      <View style={styles.modalOverlay}><View style={styles.modalCard} accessibilityViewIsModal><ScrollView contentContainerStyle={styles.modalContent}>
        <SectionTitle title="Archivos y límites" />
        <BodyText>Hasta {MAX_FILES} archivos por borrador, 25 MiB por archivo y 40 MiB por destino. La cola durable conserva su límite global de 500 MiB; no se eliminan pendientes para liberar espacio.</BodyText>
        <BodyText>Galería y Archivos admiten selección múltiple. Cámara añade una foto cada vez. Cada selección se añade a las anteriores.</BodyText>
        <BodyText>Imágenes, PDF, DOCX, XLSX, TXT y CSV según formato admitido por el servidor. Sin SVG, ejecutables ni macros. HEIC/HEIF no son compatibles con todos los destinos; usa JPEG o PNG para pasos.</BodyText>
        <BodyText>{savePresentation.description}</BodyText>
        <BodyText>{Platform.OS === "web" ? "Antes de guardar, el borrador solo existe en esta sesión del navegador. Guarda antes de recargar o cerrar." : "La selección se copia al dispositivo como borrador. Pulsa Guardar para incorporarla a la cola."}</BodyText>
        <BodyText>En cola no equivale a evidencia confirmada. Eliminar requiere conexión; no se borran archivos de la cola desde aquí.</BodyText>
        <Button title="Cerrar ayuda" onPress={() => setHelp(false)} />
      </ScrollView></View></View>
    </Modal>
    {deleting !== null ? <Modal visible transparent animationType="fade" onRequestClose={() => { if (operation !== "delete") setDeleting(null); }}>
      <View style={styles.modalOverlay}><View style={styles.modalCard} accessibilityViewIsModal><ScrollView contentContainerStyle={styles.modalContent}>
        <SectionTitle title="¿Eliminar archivo?" subtitle={deleting?.name} />
        <BodyText>El archivo dejará de estar disponible en este destino. No podrás restaurarlo desde la app.</BodyText>
        {message?.tone === "error" ? <Notice message={userErrorText(message.text)} tone="error" /> : null}
        <Button title="Cancelar" variant="secondary" disabled={operation === "delete"} onPress={() => setDeleting(null)} />
        <Button title="Confirmar eliminación" variant="danger" icon="trash-outline" loading={operation === "delete"} disabled={unavailable || deletionDisabled || !props.onDelete} onPress={() => { void deleteSaved(); }} />
      </ScrollView></View></View>
    </Modal> : null}
  </View>;
}
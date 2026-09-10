import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, ScrollView, Text, View } from "react-native";
import type { Attachment, LocalPhoto } from "../../domain/models";
import type { OfflineController, OfflineSnapshot } from "../../domain/offline";
import { OfflineFileCard } from "../offline/OfflineFileCard";
import { isConfirmedAttachment, offlineAttachment, pendingDocumentAttachment, queueOwnsDocument, type PendingDocument } from "../offline/offlineUi";
import { Badge, BodyText, Button, Card, SectionTitle } from "../../ui/components";
import { palette } from "../../ui/theme";
import { Notice } from "./DetailUi";
import { errorMessage, httpUrl } from "./detailRules";
import { styles } from "./detailStyles";
import { pickWorkspaceFiles } from "./files/filePicker";
import { fileSizeLabel, MAX_FILES, type FileSource } from "./files/fileRules";
import { useWorkspaceDraft } from "./files/WorkspaceDraftStore";
import { PendingFileList, SavedFileList } from "./files/WorkspaceFileList";
import { workspaceStyles } from "./files/workspaceStyles";
import { fileSavePresentation } from "./files/fileSavePresentation";

export { cleanupFileWorkspace } from "./files/WorkspaceDraftStore";

export interface FileWorkspaceProps {
  scopeKey: string;
  resourceKey?: string;
  mode: "live" | "demo";
  readOnly: boolean;
  busy?: boolean;
  title?: string;
  onLoad: () => Promise<Attachment[]>;
  onUpload: (files: LocalPhoto[]) => Promise<void>;
  onDelete?: (fileId: string) => Promise<void>;
  offline?: OfflineSnapshot | null;
  pending?: PendingDocument[];
  readLocalFile?: OfflineController["readLocalFile"];
}

interface WorkspaceMessage { text: string; tone: "error" | "success" | "warning"; }

export function FileWorkspace(props: FileWorkspaceProps) {
  return <FileWorkspaceContent key={JSON.stringify([props.mode, props.scopeKey])} {...props} />;
}

function FileWorkspaceContent(props: FileWorkspaceProps) {
  const draft = useWorkspaceDraft(props.scopeKey, props.mode);
  const callbacks = useRef(props);
  callbacks.current = props;
  const active = useRef(false);
  const generation = useRef(0);
  const pickerGeneration = useRef(0);
  const selectionLease = useRef<symbol | null>(null);
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<WorkspaceMessage | null>(null);
  const [operation, setOperation] = useState<"select" | "prepare" | "upload" | "delete" | "remove" | null>(null);
  const [progress, setProgress] = useState("");
  const [deleting, setDeleting] = useState<Attachment | null>(null);
  const unavailable = props.readOnly || props.busy === true || props.offline === null || draft.closed || !draft.hydrated || draft.fileBusy;
  const pending = draft.files.filter((file) => !file.uploaded);
  const savePresentation = fileSavePresentation(props.mode, pending.length, props.offline);
  const offlineLoading = props.offline === null;
  const deletionDisabled = props.offline !== undefined && (!props.offline?.online || props.offline.authBlocked);
  const displayedFiles = new Map((files ?? []).map((file) => [String(file.id), file]));
  for (const operation of props.pending ?? []) {
    if (operation.status === "applied" || [...displayedFiles.values()].some((file) => offlineAttachment(file)?.offline.operationId === operation.id)) continue;
    const file = pendingDocumentAttachment(operation);
    displayedFiles.set(String(file.id), file);
  }
  const localFiles = [...displayedFiles.values()].flatMap((file) => { const local = offlineAttachment(file); return local && (local.offline.downloaded || !local.offline.confirmed) ? [local] : []; });
  const remoteFiles = [...displayedFiles.values()].filter((file) => isConfirmedAttachment(file) && !String(file.id).startsWith("local-") && (!offlineAttachment(file) || httpUrl(file.url) !== null));

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

  async function pick(source: FileSource): Promise<void> {
    if (callbacks.current.readOnly || callbacks.current.busy || callbacks.current.offline === null) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    selectionLease.current = lease;
    const token = ++pickerGeneration.current;
    setMessage(null);
    setOperation("select");
    try {
      const selected = await pickWorkspaceFiles(source, MAX_FILES - draft.store.getSnapshot().files.length);
      if (token !== pickerGeneration.current || !active.current) return;
      if (callbacks.current.readOnly || callbacks.current.busy) throw new Error("La selección se canceló porque este destino ya no permite cambios en este momento.");
      if (selected.length === 0) return;
      selectionLease.current = null;
      setOperation("prepare");
      await draft.store.addFiles(selected);
    } catch (error) {
      if (active.current && token === pickerGeneration.current) setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      draft.store.endFiles(lease);
      if (selectionLease.current === lease) selectionLease.current = null;
      if (active.current && token === pickerGeneration.current) setOperation(null);
    }
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
    if (callbacks.current.readOnly || callbacks.current.busy) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    setOperation("remove");
    setMessage(null);
    try { await draft.store.removeFile(id); }
    catch (error) { if (active.current) setMessage({ text: errorMessage(error), tone: "error" }); }
    finally { draft.store.endFiles(lease); if (active.current) setOperation(null); }
  }

  async function upload(): Promise<void> {
    if (callbacks.current.readOnly || callbacks.current.busy || callbacks.current.offline === null) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    const uploadFile = callbacks.current.onUpload;
    let saved = 0;
    let queued = 0;
    let failure: string | null = null;
    setMessage(null);
    setOperation("upload");
    try {
      await draft.store.flush();
      const selected = draft.store.getSnapshot().files.filter((file) => !file.uploaded);
      for (const [index, file] of selected.entries()) {
        if (!active.current || callbacks.current.readOnly || draft.store.getSnapshot().closed) { failure = "Se detuvo el envío. Los archivos pendientes se conservan."; break; }
        setProgress(`Guardando ${index + 1} de ${selected.length}: ${file.name}`);
        draft.store.validateFile(file, callbacks.current.offline === undefined);
        const { id, uri, name, mimeType, size } = file;
        let queueOwnsFile = false;
        try {
          await uploadFile([{ id, uri, name, mimeType, size }]);
          saved += 1;
        } catch (error) {
          if (!queueOwnsDocument(error)) throw error;
          queued += 1;
          queueOwnsFile = true;
        }
        try { await draft.store.confirmFile(id); }
        catch (error) {
          if (queueOwnsFile) throw new Error("La cola conserva su propia copia. Falta limpiar el borrador original; no vuelvas a enviarlo. Reintenta la limpieza local.");
          throw error;
        }
      }
    } catch (error) { failure = errorMessage(error); }
    finally {
      const refreshed = saved + queued > 0 && active.current ? await load() : true;
      if (active.current) {
        const confirmation = saved > 0 ? `${saved} archivo(s) confirmado(s)${props.mode === "demo" ? " en demostración" : " en Qualitzer"}. ` : "";
        const queuedMessage = queued > 0 ? `${queued} archivo(s) guardado(s) en este dispositivo · pendientes de sincronizar. La cola conserva su propia copia; no cuentan como evidencia confirmada. ` : "";
        setMessage({ text: `${confirmation}${queuedMessage}${failure ? `La carga se detuvo: ${failure} Los archivos restantes se conservan. ` : ""}${!refreshed ? "No se pudo actualizar la lista. No repitas los archivos ya transferidos a la cola o confirmados." : !failure && saved + queued > 0 ? "No necesitas repetir esta carga." : !failure ? "No hay archivos pendientes para enviar." : ""}`, tone: failure && saved + queued === 0 ? "error" : queued > 0 || failure || !refreshed ? "warning" : "success" });
        setOperation(null);
        setProgress("");
      }
      draft.store.endFiles(lease);
    }
  }

  async function deleteSaved(): Promise<void> {
    const onDelete = callbacks.current.onDelete;
    if (!deleting || !onDelete || callbacks.current.readOnly || callbacks.current.busy || deletionDisabled || !isConfirmedAttachment(deleting) || String(deleting.id).startsWith("local-")) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    setMessage(null);
    setOperation("delete");
    try {
      await onDelete(String(deleting.id));
      if (active.current) setDeleting(null);
      const refreshed = active.current ? await load() : true;
      if (active.current) setMessage({ text: refreshed ? "Archivo eliminado." : "El archivo se eliminó, pero no se pudo actualizar la lista. Actualízala; no repitas la eliminación.", tone: refreshed ? "success" : "warning" });
    } catch (error) { if (active.current) setMessage({ text: `No se confirmó la eliminación: ${errorMessage(error)}`, tone: "error" }); }
    finally { draft.store.endFiles(lease); if (active.current) setOperation(null); }
  }

  async function retryDraft(): Promise<void> {
    try { await draft.store.retry(); }
    catch (error) { if (active.current) setMessage({ text: errorMessage(error), tone: "error" }); }
  }

  return <View style={styles.stack}>
    <Card style={styles.stack}>
      <View style={styles.between}><SectionTitle title={props.title ?? "Archivos"} subtitle="Fotos y documentos de este destino" /><Badge label={props.mode === "demo" ? "Demostración" : "Qualitzer"} tone="info" /></View>
      <BodyText>Hasta 4 archivos pendientes · 25 MB por archivo · 40 MB en total (MiB). Imágenes, PDF, DOCX, XLSX, TXT y CSV. Sin SVG, ejecutables ni macros.</BodyText>
      {props.readOnly ? <Notice message="Este destino está en modo de solo lectura. Puedes consultar y abrir sus archivos." /> : null}
      <BodyText>{savePresentation.description}</BodyText>
      {Platform.OS === "web" ? <Notice message={props.offline !== undefined ? "Seleccionar una foto todavía no confirma su guardado. Pulsa el botón de guardar antes de recargar o cerrar para conservar una copia duradera. Después, la sincronización es automática; no necesitas elegir un modo online u offline." : "Los archivos locales solo se conservan en esta sesión del navegador. Se pierden al recargar o cerrar la página; no son un borrador duradero. No se suben automáticamente."} tone="warning" /> : <BodyText>{props.offline !== undefined ? "Los archivos seleccionados se copian al almacenamiento del dispositivo. Confirma su guardado para incluirlos en la sincronización." : "Los archivos seleccionados se copian al almacenamiento del dispositivo. Solo se envían cuando confirmas la carga."}</BodyText>}
      {offlineLoading ? <Notice message="Recuperando la cola local. Espera antes de guardar para no duplicar archivos pendientes." /> : null}
      {deletionDisabled ? <Notice message="Eliminar archivos requiere conexión y confirmación del servidor. Las copias en cola no se pueden eliminar desde aquí." tone="warning" /> : null}
      {draft.error ? <View style={styles.tight}><Notice message={draft.error} tone="error" />{!draft.closed ? <Button title="Reintentar borrador" variant="secondary" disabled={draft.saving || draft.fileBusy || props.busy} onPress={() => { void retryDraft(); }} /> : null}</View> : null}
      {!draft.hydrated && !draft.error ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><BodyText>Recuperando borradores de este destino…</BodyText></View> : null}
      {!props.readOnly ? <View style={styles.row}>
        <Button title="Cámara" icon="camera-outline" variant="secondary" style={workspaceStyles.pickerButton} disabled={unavailable || draft.files.length >= MAX_FILES} onPress={() => { void pick("camera"); }} />
        <Button title="Galería" icon="images-outline" variant="secondary" style={workspaceStyles.pickerButton} disabled={unavailable || draft.files.length >= MAX_FILES} onPress={() => { void pick("library"); }} />
        <Button title="PDF" icon="document-text-outline" variant="secondary" style={workspaceStyles.pickerButton} disabled={unavailable || draft.files.length >= MAX_FILES} onPress={() => { void pick("pdf"); }} />
        <Button title="Documento" icon="folder-open-outline" variant="secondary" style={workspaceStyles.pickerButton} disabled={unavailable || draft.files.length >= MAX_FILES} onPress={() => { void pick("document"); }} />
      </View> : null}
      {operation === "select" || operation === "prepare" ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><BodyText>{operation === "select" ? "Esperando selección…" : "Copiando y guardando el borrador…"}</BodyText></View> : null}
      {draft.fileBusy && operation === null ? <Notice message="Hay una operación de archivos en curso para este destino. Espera a que termine antes de realizar otra." /> : null}
      {operation === "select" && Platform.OS === "web" ? <Button title="Ya cerré el selector · cancelar" variant="secondary" onPress={cancelPicker} /> : null}
      {message ? <Notice message={message.text} tone={message.tone} onDismiss={() => setMessage(null)} /> : null}
      {draft.hydrated ? <Text style={styles.label}>{pending.length} pendientes de envío · {fileSizeLabel(draft.files.reduce((sum, file) => sum + file.size, 0))} / 40 MB</Text> : null}
      <PendingFileList files={props.offline !== undefined ? pending : draft.files} disabled={unavailable} onRemove={(id) => { void remove(id); }} />
      {draft.files.some((file) => file.uploaded) ? <View style={styles.tight}><Notice message={props.offline !== undefined ? "Estos archivos ya fueron transferidos a la cola o confirmados. No se incluirán en otra carga. Falta limpiar el borrador original." : "Los archivos marcados como confirmados ya se enviaron. Limpia su copia local; no se incluirán en otra carga."} tone="warning" />{draft.files.filter((file) => file.uploaded).map((file) => <Button key={file.id} title={`Limpiar borrador original: ${file.name}`} variant="secondary" disabled={unavailable} onPress={() => void remove(file.id)} />)}</View> : null}
      {draft.saving && draft.hydrated ? <BodyText>Guardando cambios del borrador…</BodyText> : draft.hydrated && !draft.error && draft.files.length > 0 ? <Badge label={Platform.OS === "web" ? "Borrador · solo esta sesión" : "Borrador guardado en el dispositivo"} tone="warning" /> : null}
      {progress ? <Text accessibilityLiveRegion="polite" style={styles.label}>{progress}</Text> : null}
      {!props.readOnly ? <Button title={savePresentation.title} icon="cloud-upload-outline" disabled={unavailable || offlineLoading || pending.length === 0 || draft.saving || draft.error !== null} loading={operation === "upload"} onPress={() => { void upload(); }} /> : null}
    </Card>
    <Card style={styles.stack}>
      <View style={styles.between}><SectionTitle title={props.mode === "demo" ? "Archivos de demostración" : "Archivos del destino"} subtitle={`${[...displayedFiles.values()].filter(isConfirmedAttachment).length} confirmados · ${localFiles.filter((file) => !file.offline.confirmed).length} pendientes${files === null ? " · consulta remota no verificada" : ""}`} /><Button title={loadError ? "Reintentar archivos" : "Actualizar archivos"} icon="refresh-outline" variant="secondary" loading={loading} disabled={props.busy || draft.fileBusy || draft.closed} onPress={() => { void load(); }} /></View>
      <BodyText>Los enlaces remotos solo admiten HTTP/HTTPS. Las copias locales se abren por su identificador verificado en el almacenamiento, no desde URLs arbitrarias.</BodyText>
      {loading ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><BodyText>Consultando archivos…</BodyText></View> : null}
      {loadError ? <Notice message={`${loadError}${files !== null ? " La lista visible corresponde a la última consulta correcta." : " No se ha verificado si hay archivos."}`} tone="error" /> : null}
      {localFiles.map((file) => <View key={String(file.id)} style={styles.tight}>
        <OfflineFileCard file={file} readLocalFile={props.readLocalFile} />
        {props.onDelete ? <Button title="Eliminar archivo" variant="secondary" disabled={unavailable || deletionDisabled || !file.offline.confirmed || String(file.id).startsWith("local-") || loading || !!loadError} onPress={() => setDeleting(file)} /> : null}
      </View>)}
      {remoteFiles.length > 0 ? <SavedFileList files={remoteFiles} mode={props.mode} canDelete={!unavailable && !loading && !loadError && !deletionDisabled} onDelete={props.onDelete ? setDeleting : undefined} /> : displayedFiles.size === 0 && files !== null && !loadError && !loading ? <BodyText>No hay archivos guardados en este destino.</BodyText> : null}
    </Card>
    <Modal visible={deleting !== null} transparent animationType="fade" onRequestClose={() => { if (operation !== "delete") setDeleting(null); }}>
      <View style={styles.modalOverlay}><View style={styles.modalCard} accessibilityViewIsModal><ScrollView contentContainerStyle={styles.modalContent}>
        <SectionTitle title="¿Eliminar archivo?" subtitle={deleting?.name} />
        <BodyText>El archivo dejará de estar disponible en este destino. No podrás restaurarlo desde la app.</BodyText>
        {message?.tone === "error" ? <Notice message={message.text} tone="error" /> : null}
        <Button title="Cancelar" variant="secondary" disabled={operation === "delete"} onPress={() => setDeleting(null)} />
        <Button title="Confirmar eliminación" variant="danger" icon="trash-outline" loading={operation === "delete"} disabled={unavailable || deletionDisabled || !props.onDelete} onPress={() => { void deleteSaved(); }} />
      </ScrollView></View></View>
    </Modal>
  </View>;
}
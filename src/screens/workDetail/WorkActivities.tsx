import { useContext, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { z } from "zod";
import type { Activity, Attachment, LocalPhoto } from "../../domain/models";
import { plainText } from "../../domain/format";
import { isWorkActivity, workActivityInputSchema, type WorkActivityInput } from "../../domain/workActivities";
import { Badge, BodyText, Button, Field, IconButton, SectionTitle } from "../../ui/components";
import { AttachmentList, Notice } from "./DetailUi";
import { styles } from "./detailStyles";
import { errorMessage } from "./detailRules";
import { FileWorkspace } from "./FileWorkspace";
import { useWorkspaceDraft } from "./files/WorkspaceDraftStore";
import { DeviceSecurityContext, PrivateModal } from "../../security/DeviceSecurityContext";
import { useTrustedNativePicker } from "../../security/useTrustedNativePicker";
import { pickWorkspaceFiles } from "./files/filePicker";
import { MAX_FILES, type FileSource } from "./files/fileRules";
import { PendingFileList } from "./files/WorkspaceFileList";
import { saveFileBatch } from "./files/saveFileBatch";
import { CameraPermissionGuide } from "./files/CameraPermissionGuide";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { palette } from "../../ui/theme";
import { useCameraPermissionGuide } from "./files/useCameraPermissionGuide";

export interface WorkActivityActions {
  load(): Promise<Activity[]>;
  create(input: WorkActivityInput): Promise<{ id: number }>;
  complete(id: number): Promise<void>;
  remove?(id: number): Promise<void>;
  files(id: number): Promise<Attachment[]>;
  upload(id: number, files: LocalPhoto[]): Promise<void>;
}
interface Props { onCreated?: () => void; backHandler?: { current: ((home?: boolean) => boolean) | null }; scopeKey: string; mode: "live" | "demo"; activities: Activity[]; actions?: WorkActivityActions; disabled: boolean; readOnly: boolean; }
const formSchema = z.object({ activity: z.string().max(240), hours: z.string().optional(), minutes: z.string(), createdId: z.number().int().positive().optional() })
  .transform(value => ({ activity: value.activity, minutes: value.hours === undefined ? value.minutes : String(Number(value.hours) * 60 + Number(value.minutes)), createdId: value.createdId }));
const emptyForm: z.infer<typeof formSchema> = { activity: "", minutes: "0", createdId: undefined };

export function WorkActivities(props: Props) {
  const draft = useWorkspaceDraft(`${props.scopeKey}:activity-form`, props.mode);
  const [activities, setActivities] = useState(props.activities.filter(isWorkActivity));
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [recentId, setRecentId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  const created = useRef<number | null>(null);
  const latest = useRef(props); latest.current = props;
  const security = useContext(DeviceSecurityContext);
  const securityRef = useRef(security); securityRef.current = security;
  const runNativePicker = useTrustedNativePicker();
  const canWrite = () => mounted.current && !latest.current.disabled && !latest.current.readOnly && (securityRef.current?.isUnlocked() ?? true);
  const cameraGuide = useCameraPermissionGuide(props.scopeKey, canWrite);
  const parsed = (() => { try { return formSchema.safeParse(draft.text ? JSON.parse(draft.text) : emptyForm); } catch { return formSchema.safeParse(null); } })();
  const form = parsed.success ? parsed.data : emptyForm;
  const disabled = props.disabled || props.readOnly || busy || !props.actions;
  const filesBack = useRef<((home?: boolean) => boolean) | null>(null);
  useEffect(() => {
    const handler = props.backHandler;
    if (!handler) return;
    const back = (home = false): boolean => {
      if (lock.current || draft.store.getSnapshot().saving || draft.store.getSnapshot().fileBusy || filesBack.current?.(home)) return true;
      if (home) return false;
      if (deleting) { setDeleting(null); return true; }
      if (creating) { setCreating(false); return true; }
      if (selected !== null) { setSelected(null); return true; }
      return false;
    };
    handler.current = back;
    return () => { if (handler.current === back) handler.current = null; };
  }, [props.backHandler, deleting, creating, selected, draft.store]);
  async function load(): Promise<void> {
    const current = latest.current;
    if (!current.actions) return;
    const result = await current.actions.load();
    if (mounted.current && current.scopeKey === latest.current.scopeKey) setActivities(result.filter(isWorkActivity));
  }
  useEffect(() => {
    mounted.current = true;
    void load().catch(failure => { if (mounted.current) setError(errorMessage(failure)); });
    return () => { mounted.current = false; };
  }, [props.scopeKey]);
  async function change(value: Partial<z.infer<typeof formSchema>>): Promise<void> {
    try { await draft.store.setText(JSON.stringify({ ...form, ...value })); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
  }
  async function run(operation: () => Promise<void>, write = true): Promise<void> {
    if (lock.current || (write && !canWrite()) || !mounted.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await operation(); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function create(): Promise<void> {
    if (!parsed.success || !props.actions) return;
    const input = workActivityInputSchema.safeParse({ activity: form.activity, executionTime: /^\d+$/.test(form.minutes) ? Number(form.minutes) : NaN });
    if (!input.success) { setError("Indica el nombre y una cantidad válida de minutos enteros."); return; }
    await run(async () => {
      await draft.store.flush();
      if (!canWrite()) return;
      const activityId = created.current ?? form.createdId ?? (await props.actions!.create(input.data)).id;
      created.current = activityId;
      await draft.store.setText(JSON.stringify({ ...form, createdId: activityId }));
      const lease = draft.store.beginFiles();
      if (!lease) throw new Error("Los archivos están ocupados. El registro de actividad se conserva.");
      try {
        const result = await saveFileBatch({ store: draft.store, upload: files => props.actions!.upload(activityId, files), canContinue: canWrite, requireSource: true, onProgress: () => {} });
        if (result.failure) throw new Error(result.failure);
      } finally { draft.store.endFiles(lease); }
      if (!mounted.current) return;
      setSelected(null); setRecentId(activityId); setCreating(false);
      await load();
      if (mounted.current) props.onCreated?.();
    });
  }
  async function pick(source: FileSource, isCurrent: () => boolean = () => true): Promise<void> {
    if (!canWrite() || !isCurrent()) return;
    const lease = draft.store.beginFiles();
    if (!lease) return;
    try {
      const assets = await pickWorkspaceFiles(source, MAX_FILES - draft.store.getSnapshot().files.length, runNativePicker, () => canWrite() && isCurrent());
      if (canWrite() && isCurrent() && assets.length) await draft.store.addFiles(assets);
    } catch (failure) {
      if (!cameraGuide.handleError(failure, { onRetry: current => pick("camera", current), onGallery: current => pick("library", current) }) && mounted.current) setError(errorMessage(failure));
    } finally { draft.store.endFiles(lease); }
  }
  async function openForm(): Promise<void> {
    await run(async () => {
      if ((form.createdId || created.current) && draft.files.every(file => file.uploaded)) {
        for (const file of draft.files) await draft.store.removeFile(file.id);
        await draft.store.setText(JSON.stringify(emptyForm));
        created.current = null;
      }
      setCreating(true); setSelected(null);
    });
  }
  const selectedActivity = activities.find(activity => activity.id === selected);
  const orderedActivities = [...activities].sort((left, right) => Number(right.id === recentId) - Number(left.id === recentId));
  function closeFiles(): void { if (!filesBack.current?.(true) && !lock.current) setSelected(null); }
  return <View style={styles.stack} testID="work-activities">
    <View style={styles.sectionHeading}><Ionicons name="construct-outline" size={22} color={palette.primary} /><Text accessibilityRole="header" style={styles.sectionTitle}>Actividades</Text><Badge label={String(activities.length)} />
      <IconButton label="Actualizar actividades" name="refresh-outline" disabled={busy} onPress={() => void run(load, false)} />
      {!props.readOnly ? <IconButton label="Agregar actividad" name="add-outline" disabled={disabled || !draft.hydrated} onPress={() => void openForm()} /> : null}
    </View>
    {error || draft.error || !parsed.success ? <Notice message={error ?? draft.error ?? "No se pudo leer el borrador de actividad."} tone="error" /> : null}
    {activities.length === 0 ? <BodyText>Sin actividades registradas.</BodyText> : orderedActivities.map((activity, index) => <View key={activity.id} style={[styles.activityCard, activity.id === recentId && styles.activityRecent]} testID={`activity-card-${activity.id}`}>
      <View style={styles.between}><Text style={styles.activityIndex}>ACTIVIDAD {String(index + 1).padStart(2, "0")}</Text>{activity.id === recentId ? <Badge label="Recién añadida" tone="teal" /> : null}<Badge label={`${activity.executionTime} min`} /></View>
      <View style={styles.between}>
        <Text accessibilityRole="header" style={styles.activityTitle}>{plainText(activity.activity)}</Text>
      </View>
      <Badge label={activity.isCompleted ? "Completada" : "Pendiente"} tone={activity.isCompleted ? "success" : "warning"} />
      <View style={styles.activityActions}>
        <Button title="Archivos" accessibilityLabel={`Archivos de actividad: ${plainText(activity.activity)}`} icon="folder-open-outline" variant="ghost" disabled={busy} onPress={() => setSelected(activity.id)} style={styles.grow} />
        {!activity.isCompleted && !props.readOnly ? <IconButton name="checkmark-circle-outline" label={`Completar actividad: ${plainText(activity.activity)}`} disabled={disabled} onPress={() => void run(async () => { await props.actions!.complete(activity.id); await load(); })} /> : null}
        {props.actions?.remove && !props.readOnly ? <IconButton name="trash-outline" label={`Eliminar actividad: ${plainText(activity.activity)}`} disabled={disabled} onPress={() => setDeleting(activity)} /> : null}
      </View>
    </View>)}
    {selectedActivity ? <PrivateModal visible animationType="slide" onRequestClose={closeFiles}><SafeAreaView style={styles.safe}>
      <View style={styles.header}><IconButton name="arrow-back-outline" label="Volver a actividades" onPress={closeFiles} /><View style={styles.grow}><Text style={styles.caption}>Archivos de actividad</Text><Text style={styles.label}>{plainText(selectedActivity.activity)}</Text></View><IconButton name="home-outline" label="Volver al inicio de actividades" onPress={closeFiles} /></View>
      {props.actions ? <FileWorkspace compact backHandler={filesBack} scopeKey={`${props.scopeKey}:activity:${selectedActivity.id}`} resourceKey={`${props.scopeKey}:${selectedActivity.id}`} mode={props.mode} readOnly={props.readOnly} busy={props.disabled || busy} title="Archivos" notices={selectedActivity.technicalDocuments.map(document => <View key={document.id} style={styles.tight}><Text style={styles.label}>{plainText(document.documentName)}</Text>{document.file ? <AttachmentList files={[document.file]} /> : null}</View>)} onLoad={() => props.actions!.files(selectedActivity.id)} onUpload={files => props.actions!.upload(selectedActivity.id, files)} /> : null}
    </SafeAreaView></PrivateModal> : null}
    {creating ? <PrivateModal visible transparent animationType="fade" onRequestClose={() => { if (!busy && !draft.fileBusy) setCreating(false); }}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.modalCard} accessibilityViewIsModal accessibilityLabel="Nueva actividad">
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <SectionTitle title={form.createdId ? "Archivos de actividad" : "Nueva actividad"} />
            {error || draft.error ? <Notice message={error ?? draft.error ?? ""} tone="error" /> : null}
            <Field label="Nombre de la actividad" value={form.activity} editable={!disabled && !form.createdId && draft.hydrated} maxLength={240} onChangeText={activity => void change({ activity })} />
            <Field label="Minutos de actividad" keyboardType="number-pad" value={form.minutes} editable={!disabled && !form.createdId} maxLength={5} onChangeText={minutes => void change({ minutes })} />
            <View style={styles.between}><SectionTitle title="Archivos" /><View style={styles.row}>
              <IconButton name="camera-outline" label="Tomar foto de actividad" disabled={disabled || draft.fileBusy} onPress={() => void pick("camera")} />
              <IconButton name="images-outline" label="Fotos de actividad" disabled={disabled || draft.fileBusy} onPress={() => void pick("library")} />
              <IconButton name="attach-outline" label="Adjuntar archivos de actividad" disabled={disabled || draft.fileBusy} onPress={() => void pick("document")} />
            </View></View>
            <PendingFileList files={draft.files} disabled={disabled || draft.fileBusy} onRemove={id => void run(() => draft.store.removeFile(id))} />
            <Button title={form.createdId ? "Guardar archivos pendientes" : "Guardar actividad"} icon="save-outline" loading={busy} disabled={disabled || !draft.hydrated || draft.saving || draft.fileBusy || !!draft.error} onPress={() => void create()} />
            <Button title="Cancelar" variant="ghost" disabled={busy || draft.fileBusy} onPress={() => setCreating(false)} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </PrivateModal> : null}
    {deleting ? <PrivateModal visible transparent animationType="fade" onRequestClose={() => { if (!busy) setDeleting(null); }}><View style={styles.modalOverlay}><View style={[styles.modalCard, styles.modalContent]} accessibilityViewIsModal>
      <SectionTitle title="¿Eliminar actividad?" />
      <BodyText>{plainText(deleting.activity)}</BodyText>
      {error ? <Notice message={error} tone="error" /> : null}
      <Button title="Eliminar actividad" variant="danger" icon="trash-outline" disabled={disabled} loading={busy} onPress={() => void run(async () => {
        if (!props.actions?.remove) return;
        await props.actions.remove(deleting.id);
        if (!mounted.current) return;
        setActivities(current => current.filter(activity => activity.id !== deleting.id));
        setSelected(null); setDeleting(null); await load();
      })} />
      <Button title="Cancelar" variant="ghost" disabled={busy} onPress={() => setDeleting(null)} />
    </View></View></PrivateModal> : null}
    <CameraPermissionGuide guide={cameraGuide} />
  </View>;
}
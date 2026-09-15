import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import type { Activity, Attachment, LocalPhoto } from "../../domain/models";
import { duration, plainText } from "../../domain/format";
import { workActivityInputSchema, type WorkActivityInput } from "../../domain/workActivities";
import { Badge, BodyText, Button, Field, IconButton, SectionTitle } from "../../ui/components";
import { NumericSelectField } from "../../ui/time/NumericSelectField";
import { AttachmentList, ChoiceButton, Notice } from "./DetailUi";
import { styles } from "./detailStyles";
import { errorMessage } from "./detailRules";
import { FileWorkspace } from "./FileWorkspace";
import { useWorkspaceDraft } from "./files/WorkspaceDraftStore";

export interface WorkActivityActions {
  load(): Promise<Activity[]>;
  create(input: WorkActivityInput): Promise<{ id: number }>;
  complete(id: number): Promise<void>;
  files(id: number): Promise<Attachment[]>;
  upload(id: number, files: LocalPhoto[]): Promise<void>;
}
interface Props { scopeKey: string; mode: "live" | "demo"; activities: Activity[]; actions?: WorkActivityActions; disabled: boolean; readOnly: boolean; }
const formSchema = z.object({ activity: z.string().max(240), hours: z.string(), minutes: z.string(), createdId: z.number().int().positive().optional() });
const emptyForm: z.infer<typeof formSchema> = { activity: "", hours: "0", minutes: "0" };

export function WorkActivities(props: Props) {
  const draft = useWorkspaceDraft(`${props.scopeKey}:activity-form`, props.mode);
  const [activities, setActivities] = useState(props.activities.filter(activity => !activity.activity.startsWith("__WORK_CHECKLIST__")));
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  const created = useRef<number | null>(null);
  const latest = useRef(props); latest.current = props;
  const parsed = (() => { try { return formSchema.safeParse(draft.text ? JSON.parse(draft.text) : emptyForm); } catch { return formSchema.safeParse(null); } })();
  const form = parsed.success ? parsed.data : emptyForm;
  const disabled = props.disabled || props.readOnly || busy || !props.actions;
  async function load(): Promise<void> {
    const current = latest.current;
    if (!current.actions) return;
    const result = await current.actions.load();
    if (mounted.current && current.scopeKey === latest.current.scopeKey) setActivities(result);
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
    if (lock.current || (write && (latest.current.disabled || latest.current.readOnly)) || !mounted.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await operation(); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function create(): Promise<void> {
    if (!parsed.success || !props.actions || form.createdId || created.current) return;
    const input = workActivityInputSchema.safeParse({ activity: form.activity, executionTime: Number(form.hours) * 60 + Number(form.minutes) });
    if (!input.success) { setError("Indica el nombre y un tiempo válido para la actividad."); return; }
    await run(async () => {
      await draft.store.flush();
      if (latest.current.disabled || latest.current.readOnly) return;
      const result = await props.actions!.create(input.data);
      created.current = result.id;
      await draft.store.setText(JSON.stringify({ ...form, createdId: result.id }));
      if (!mounted.current) return;
      setSelected(result.id); setCreating(false);
      await load();
    });
  }
  return <View style={styles.stack} testID="work-activities">
    <View style={styles.between}><SectionTitle title="Actividades" /><View style={styles.row}>
      <IconButton label="Actualizar actividades" name="refresh-outline" disabled={busy} onPress={() => void run(load, false)} />
      {!props.readOnly ? <Button title="Agregar actividad" icon="add-outline" variant="secondary" disabled={disabled} onPress={() => void run(async () => { if (form.createdId || created.current) await draft.store.setText(JSON.stringify(emptyForm)); created.current = null; setCreating(true); setSelected(null); })} /> : null}
    </View></View>
    {error || draft.error || !parsed.success ? <Notice message={error ?? draft.error ?? "No se pudo leer el borrador de actividad."} tone="error" /> : null}
    {creating ? <View style={styles.stack}>
      <Field label="Nombre de la actividad" value={form.activity} editable={!disabled && draft.hydrated} maxLength={240} onChangeText={activity => void change({ activity })} />
      <View style={styles.columns}>
        <NumericSelectField label="Horas de actividad" max={743} value={form.hours} scopeKey={props.scopeKey} disabled={disabled} containerStyle={styles.column} onChange={hours => void change({ hours })} />
        <NumericSelectField label="Minutos de actividad" max={59} value={form.minutes} scopeKey={props.scopeKey} disabled={disabled} containerStyle={styles.column} onChange={minutes => void change({ minutes })} />
      </View>
      <Button title="Guardar actividad y añadir archivos" icon="save-outline" loading={busy} disabled={disabled || !draft.hydrated || draft.saving || !!draft.error || !!form.createdId} onPress={() => void create()} />
      <Button title="Cancelar" variant="ghost" disabled={busy} onPress={() => setCreating(false)} />
    </View> : null}
    {activities.length === 0 ? <BodyText>Sin actividades registradas.</BodyText> : activities.map(activity => <View key={activity.id} style={styles.item}>
      <View style={styles.between}>
        <ChoiceButton multiple label={plainText(activity.activity)} selected={activity.isCompleted} disabled={disabled || activity.isCompleted} onPress={() => void run(async () => { await props.actions!.complete(activity.id); await load(); })} />
        <Badge label={duration(activity.executionTime)} />
      </View>
      <View style={styles.between}><Text style={styles.caption}>{activity.isCompleted ? "Completada" : "Pendiente"}</Text><Button title="Archivos de actividad" icon="documents-outline" variant="ghost" disabled={busy} onPress={() => setSelected(selected === activity.id ? null : activity.id)} /></View>
      {selected === activity.id ? <View style={styles.tight}>
        {activity.technicalDocuments.map(document => <View key={document.id} style={styles.tight}><Text style={styles.label}>{plainText(document.documentName)}</Text>{document.file ? <AttachmentList files={[document.file]} /> : null}</View>)}
        {props.actions ? <FileWorkspace scopeKey={`${props.scopeKey}:activity:${activity.id}`} resourceKey={`${props.scopeKey}:${activity.id}`} mode={props.mode} readOnly={props.readOnly} busy={props.disabled || busy} title="Evidencias de actividad" onLoad={() => props.actions!.files(activity.id)} onUpload={files => props.actions!.upload(activity.id, files)} /> : null}
      </View> : null}
    </View>)}
  </View>;
}
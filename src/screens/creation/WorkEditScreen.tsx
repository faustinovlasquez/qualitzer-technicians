import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { creationOptionsSchema, workEditDocumentSchema, type CreationOptions, type CreationOptionsQuery, type WorkEditDocument, type WorkEditInput } from "../../domain/creation";
import type { Tenant, User } from "../../domain/models";
import { ApiError } from "../../infrastructure/errors";
import { useDeviceSecurity } from "../../security/DeviceSecurityContext";
import { Button, IconButton } from "../../ui/components";
import { palette, typography } from "../../ui/theme";
import { CreationFields, priorityLabels } from "./CreationFields";
import { CreationEquipmentLookup } from "./CreationEquipmentLookup";
import { CreationCatalogSelector, type CreationCatalogCache } from "./CreationCatalogSelector";
import { CreationScheduleFields } from "./CreationScheduleFields";
import { CreationModal } from "./CreationModal";
import { validateCreationForm, workEditForm, workEditPayload, type CreationForm, type CreationFormErrors } from "./creationForm";

export interface WorkEditScreenProps {
  editing: WorkEditDocument; user: User; tenant: Tenant; storageKey: string; busy: boolean; online: boolean;
  backHandler?: { current: (() => void) | null };
  onBack(): void;
  onLoadOptions(query: CreationOptionsQuery): Promise<CreationOptions>;
  onSave(input: WorkEditInput): Promise<WorkEditDocument>;
  onSaved(document: WorkEditDocument): Promise<void>;
}
export function WorkEditScreen(props: WorkEditScreenProps) {
  const security = useDeviceSecurity();
  const [form, setForm] = useState(() => workEditForm(props.editing));
  const [errors, setErrors] = useState<CreationFormErrors>({});
  const [options, setOptions] = useState<CreationOptions | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<WorkEditDocument | null>(null);
  const confirmed = useRef<WorkEditDocument | null>(null);
  const [catalog, setCatalog] = useState<"equipment" | "specialties" | null>(null);
  const [exit, setExit] = useState(false);
  const changed = useRef(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ props, security }); latest.current = { props, security };
  const cache = useRef<CreationCatalogCache>(new Map()).current;
  const disabled = props.busy || saving || !props.online || !!saved;
  const document = props.editing;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setError(""); setOptions(null);
    void latest.current.props.onLoadOptions({ companyBranchId: document.companyBranchId }).then(value => {
      const result = creationOptionsSchema.parse(value);
      if (result.companyBranchId !== document.companyBranchId || result.userId !== props.user.id || result.workerId !== props.user.workerId) throw new Error("WORK_EDIT_OPTIONS_MISMATCH");
      if (active) setOptions(result);
    }).catch(() => { if (active) setError("No se pudieron cargar las opciones del trabajo."); });
    return () => { active = false; };
  }, [document.companyBranchId, props.user.id, props.user.workerId, reload]);
  function close() { if (lock.current || props.busy) return; if (saved || !changed.current) props.onBack(); else setExit(true); }
  useEffect(() => {
    if (props.backHandler) props.backHandler.current = close;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { close(); return true; });
    return () => { listener.remove(); if (props.backHandler) props.backHandler.current = null; };
  }, [props.busy, saving, saved, props.backHandler, props.onBack]);
  function change<Key extends keyof CreationForm>(key: Key, value: CreationForm[Key]) {
    if (disabled || confirmed.current || lock.current || latest.current.props.busy || !latest.current.props.online || !latest.current.security.isUnlocked()) return;
    changed.current = true; setForm(previous => ({ ...previous, [key]: value })); setErrors(previous => ({ ...previous, [key]: undefined }));
  }
  function next() {
    const validation = validateCreationForm("work", form);
    if (step === 0) { delete validation.date; delete validation.startTime; delete validation.endTime; }
    setErrors(validation);
    if (!Object.keys(validation).length) setStep(step + 1);
  }
  async function save() {
    if (lock.current || !latest.current.security.isUnlocked() || latest.current.props.busy || !latest.current.props.online || !options || !mounted.current) return;
    lock.current = true; setSaving(true); setError("");
    try {
      let result = confirmed.current;
      if (!result) {
        const validation = validateCreationForm("work", form); setErrors(validation);
        if (Object.keys(validation).length) { setStep(0); return; }
        result = workEditDocumentSchema.parse(await latest.current.props.onSave(workEditPayload(document, form)));
        if (result.groupId !== document.groupId || result.workId !== document.workId || result.companyBranchId !== document.companyBranchId) throw new Error("WORK_EDIT_RESULT_MISMATCH");
        if (!mounted.current) return;
        confirmed.current = result; setSaved(result);
      }
      if (latest.current.security.isUnlocked()) await latest.current.props.onSaved(result);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof ApiError && caught.code === "WORK_EDIT_CONFLICT" ? "El trabajo cambió. Vuelve a abrir la ficha antes de guardar para no sobrescribir otros cambios."
        : caught instanceof ApiError && caught.code === "WORK_SCHEDULE_READ_ONLY" ? "El horario ya no se puede modificar porque cambió la planificación o comenzó su ejecución."
        : "No se pudo completar la actualización. Conserva este formulario y reintenta; no se creará otro trabajo.");
    } finally { lock.current = false; if (mounted.current) setSaving(false); }
  }
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><IconButton name="arrow-back-outline" label="Volver al trabajo" disabled={saving || props.busy} onPress={close} /><Text accessibilityRole="header" style={styles.title}>Editar trabajo</Text></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.caption}>{props.tenant.name} · {props.user.name}</Text>
      <Text style={styles.label}>{["1. Datos", "2. Horario", "3. Revisar"][step]}</Text>
      {!options && !error ? <ActivityIndicator accessibilityLabel="Cargando opciones de edición" /> : null}
      {!options && error ? <Button title="Reintentar opciones" variant="secondary" onPress={() => setReload(value => value + 1)} /> : null}
      {options && step === 0 ? <CreationFields kind="work" editing form={form} errors={errors} options={options} disabled={disabled} specialtyLocked={document.equipmentInherited} onChange={change} onSelectCatalog={setCatalog}
        equipmentLookup={document.equipmentInherited ? <View><Text style={styles.label}>Equipo heredado</Text><Text style={styles.body}>{document.equipment?.label ?? "Sin equipo informado en la asignación"}</Text></View> : <CreationEquipmentLookup editing companyBranchId={document.companyBranchId} userId={props.user.id} workerId={props.user.workerId} required={false} disabled={disabled} selected={form.equipment} error={errors.equipment} cache={cache} onLoadOptions={props.onLoadOptions} onSelect={item => change("equipment", item)} />} /> : null}
      {options && step === 1 ? <>
        {!document.scheduleEditable ? <Text style={styles.caption}>Horario de solo lectura: la planificación es compartida o el trabajo ya tiene ejecución.</Text> : null}
        <CreationScheduleFields form={form} errors={errors} disabled={disabled || !document.scheduleEditable} optionalTimes scopeKey={`${props.storageKey}:edit:${document.workId}:${form.date}`} onChange={change} />
        <Text style={styles.caption}>{options.timezone}</Text>
      </> : null}
      {options && step === 2 ? <View style={styles.review}><Text style={styles.title}>{form.title}</Text><Text style={styles.body}>{form.summary}</Text><Text style={styles.body}>{form.date} · {form.startTime || "Sin inicio"} - {form.endTime || "Sin fin"}</Text><Text style={styles.body}>{priorityLabels[form.priority]}</Text><Text style={styles.body}>{form.equipment?.label ?? "Sin equipo asociado"}</Text></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!props.online ? <Text accessibilityRole="alert" style={styles.error}>Conecta para editar el trabajo.</Text> : null}
      {saved ? <Text accessibilityLiveRegion="polite" style={styles.label}>Cambios guardados</Text> : null}
      {options && step < 2 && !saved ? <Button title={step === 0 ? "Continuar a horario" : "Revisar cambios"} disabled={disabled} onPress={next} /> : options ? <Button title={saved ? "Volver al trabajo actualizado" : "Guardar cambios"} icon="save-outline" loading={saving} disabled={props.busy || !props.online} onPress={() => void save()} /> : null}
      {step > 0 && !saved ? <Button title="Paso anterior" variant="ghost" disabled={disabled} onPress={() => setStep(step - 1)} /> : null}
    </ScrollView>
    {catalog && !disabled ? <CreationCatalogSelector resource={catalog} companyBranchId={document.companyBranchId} userId={props.user.id} workerId={props.user.workerId} cache={cache} selected={catalog === "equipment" ? form.equipment : form.specialty} onLoadOptions={props.onLoadOptions} onClose={() => setCatalog(null)} onSelect={item => change(catalog === "equipment" ? "equipment" : "specialty", item)} /> : null}
    {exit ? <CreationModal title="Descartar cambios sin guardar" onClose={() => setExit(false)}><Button title="Descartar cambios" variant="danger" onPress={props.onBack} /><Button title="Seguir editando" variant="secondary" onPress={() => setExit(false)} /></CreationModal> : null}
  </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: palette.background }, header: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 }, content: { gap: 16, padding: 20, width: "100%", maxWidth: 720, alignSelf: "center" }, review: { gap: 12 }, title: { ...typography.heading, color: palette.text, flexShrink: 1 }, label: { ...typography.label, color: palette.text }, body: { ...typography.body, color: palette.text }, caption: { ...typography.caption, color: palette.textSecondary }, error: { ...typography.body, color: palette.danger } });
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  hasDowntime, hasFailureAnalysis, instantFromParts, LEVEL_LABELS, localDateTimeParts, MAINTENANCE_STATUS_LABELS, MAINTENANCE_TYPE_LABELS,
  type MaintenanceDetailsDraft, type MaintenanceInfo, type MaintenanceInfoChanges, type MaintenanceLevel
} from "../../domain/maintenanceInfo";
import type { AssignmentGroup } from "../../domain/models";
import { plainText } from "../../domain/format";
import { Button, Card, Field, SectionTitle } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { LEVELS, LEVEL_TONES, MaintenanceDetailsFields, type CatalogAccess } from "../creation/MaintenanceDetailsFields";
import { CreationSelectField } from "../creation/CreationSelectField";
import { CreationModal } from "../creation/CreationModal";
import { Notice } from "../workDetail/DetailUi";

export interface MaintenanceInfoActions {
  load: (group: AssignmentGroup) => Promise<MaintenanceInfo>;
  save: (group: AssignmentGroup, expectedRevision: string, changes: MaintenanceInfoChanges) => Promise<MaintenanceInfo>;
}

export type { CatalogAccess };

interface Props {
  group: AssignmentGroup;
  actions: MaintenanceInfoActions;
  catalogs: CatalogAccess | null;
  canEditPermission: boolean;
  online: boolean;
  disabled: boolean;
}

const failureText = (failure: unknown, fallback: string): string => failure instanceof Error && failure.message ? failure.message : fallback;
const showInstant = (iso: string | null): string => {
  if (!iso) return "Sin dato";
  const value = new Date(iso);
  return Number.isFinite(value.getTime()) ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(value) : "Sin dato";
};

type Draft = { title: string; motive: string; priority: MaintenanceLevel } & MaintenanceDetailsDraft;

function toDraft(info: MaintenanceInfo): Draft {
  const reported = localDateTimeParts(info.reportedAt);
  const downtime = localDateTimeParts(info.downtimeStartedAt);
  return {
    title: info.title ?? "", motive: info.motive, priority: info.priority, instructions: info.instructions ?? "", requestedBy: info.requestedBy ?? "",
    reportedDate: reported.date, reportedTime: reported.time, downtimeDate: downtime.date, downtimeTime: downtime.time,
    system: info.system, failureCause: info.failureCause, detectionMethod: info.detectionMethod, causedDamageType: info.causedDamageType,
    failureSeverity: info.failureSeverity, affectsOtherAssets: info.affectsOtherAssets,
    interruptionMinutes: info.interruptionMinutes === null ? "" : String(info.interruptionMinutes), affectedAssets: info.affectedAssets,
  };
}

/** Solo lo que cambió respecto de lo leído, para no pisar datos que otra persona cambió en otros campos. */
function draftChanges(info: MaintenanceInfo, draft: Draft): { changes: MaintenanceInfoChanges; error: string | null } {
  const changes: MaintenanceInfoChanges = {};
  const original = toDraft(info);
  const textOrNull = (value: string): string | null => value.trim() === "" ? null : value.trim();
  if (draft.title.trim() !== original.title.trim()) changes.title = textOrNull(draft.title);
  // El motivo es opcional, como en la web y al crear.
  if (draft.motive.trim() !== original.motive.trim()) changes.motive = draft.motive.trim();
  if (draft.priority !== original.priority) changes.priority = draft.priority;
  if (draft.instructions.trim() !== original.instructions.trim()) changes.instructions = textOrNull(draft.instructions);
  if (hasFailureAnalysis(info.type)) {
    if (draft.requestedBy.trim() !== original.requestedBy.trim()) changes.requestedBy = textOrNull(draft.requestedBy);
    if (draft.reportedDate !== original.reportedDate || draft.reportedTime !== original.reportedTime) {
      const reportedAt = instantFromParts(draft.reportedDate, draft.reportedTime);
      if (!reportedAt) return { changes, error: "Indica fecha y hora del reporte." };
      changes.reportedAt = reportedAt;
    }
    if (draft.system?.id !== original.system?.id) changes.systemId = draft.system?.id ?? null;
    if (draft.failureCause?.id !== original.failureCause?.id) changes.failureCauseId = draft.failureCause?.id ?? null;
    if (draft.detectionMethod?.id !== original.detectionMethod?.id) changes.detectionMethodId = draft.detectionMethod?.id ?? null;
    if (draft.causedDamageType?.id !== original.causedDamageType?.id) changes.causedDamageTypeId = draft.causedDamageType?.id ?? null;
    if (draft.failureSeverity !== original.failureSeverity) changes.failureSeverity = draft.failureSeverity;
  }
  if (hasDowntime(info.type)) {
    if (draft.downtimeDate !== original.downtimeDate || draft.downtimeTime !== original.downtimeTime) {
      const downtime = instantFromParts(draft.downtimeDate, draft.downtimeTime);
      if (!downtime) return { changes, error: "Indica fecha y hora de \"Detenido desde\"." };
      if (Date.parse(downtime) > Date.now() + 60_000) return { changes, error: "\"Detenido desde\" no puede estar en el futuro." };
      changes.downtimeStartedAt = downtime;
    }
    if (draft.affectsOtherAssets !== original.affectsOtherAssets) changes.affectsOtherAssets = draft.affectsOtherAssets;
    if (draft.affectsOtherAssets) {
      if (draft.interruptionMinutes !== original.interruptionMinutes) {
        const minutes = draft.interruptionMinutes.trim() === "" ? null : Number(draft.interruptionMinutes);
        if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0)) return { changes, error: "El tiempo de interrupción debe ser un número entero de minutos." };
        changes.interruptionMinutes = minutes;
      }
      const ids = draft.affectedAssets.map((asset) => asset.id);
      if (JSON.stringify(ids) !== JSON.stringify(original.affectedAssets.map((asset) => asset.id))) changes.affectedAssetIds = ids;
    }
  }
  return { changes, error: null };
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} selectable>{value?.trim() ? plainText(value) : "Sin dato"}</Text>
  </View>;
}

/** Pestaña "Información" del mantenimiento: datos generales, análisis de la falla y activos afectados, como la web. */
export function MaintenanceInfoPanel({ group, actions, catalogs, canEditPermission, online, disabled }: Props) {
  const [info, setInfo] = useState<MaintenanceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const mounted = useRef(true);
  const ticket = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ticket.current++; }; }, []);

  async function load(): Promise<MaintenanceInfo | null> {
    if (!online) return null;
    const current = ++ticket.current;
    setLoading(true); setError(null);
    try {
      const result = await actions.load(group);
      if (mounted.current && current === ticket.current) setInfo(result);
      return result;
    } catch (cause) {
      if (mounted.current && current === ticket.current) setError(failureText(cause, "No se pudo cargar la información."));
      return null;
    } finally { if (mounted.current && current === ticket.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [group.id, online]);

  async function save(): Promise<void> {
    if (!info || !draft || saving) return;
    const { changes, error: invalid } = draftChanges(info, draft);
    if (invalid) { setFormError(invalid); return; }
    if (Object.keys(changes).length === 0) { setDraft(null); return; }
    setSaving(true); setFormError(null);
    try {
      const saved = await actions.save(group, info.revision, changes);
      if (!mounted.current) return;
      ticket.current++;
      setInfo(saved); setDraft(null); setMessage("Información del mantenimiento guardada.");
    } catch (cause) {
      if (!mounted.current) return;
      setFormError(failureText(cause, "No se pudo guardar. Revisa tu conexión."));
      // Si otra persona lo cambió, se carga la versión actual para revisar antes de volver a guardar.
      if (cause instanceof Error && /cambió el mantenimiento/.test(cause.message)) {
        const fresh = await load();
        if (fresh && mounted.current) setDraft(toDraft(fresh));
      }
    } finally { if (mounted.current) setSaving(false); }
  }

  const editable = Boolean(info?.canEdit) && canEditPermission && online && !disabled;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((previous) => previous ? { ...previous, [key]: value } : previous);
  const showFailure = info ? hasFailureAnalysis(info.type) : false;
  const showDowntime = info ? hasDowntime(info.type) : false;

  return <View style={styles.stack}>
    <SectionTitle title="Información del mantenimiento" subtitle="Datos generales y análisis de la falla, igual que en la web." />
    {!online ? <Notice message="Sin conexión: la información se consulta en el servidor. Conéctate para verla." tone="warning" /> : null}
    {error ? <Notice message={error} tone="error" onDismiss={() => setError(null)} /> : null}
    {message ? <Notice message={message} tone="success" onDismiss={() => setMessage(null)} /> : null}
    {loading && !info ? <ActivityIndicator accessibilityLabel="Cargando información" color={palette.primary} /> : null}
    {info ? <>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Datos generales</Text>
        <Row label="Tipo" value={MAINTENANCE_TYPE_LABELS[info.type] ?? info.type} />
        <Row label="Estado" value={MAINTENANCE_STATUS_LABELS[info.status] ?? info.status} />
        <Row label="Equipo" value={info.equipment?.label} />
        <Row label="Título" value={info.title} />
        <Row label="Motivo" value={info.motive} />
        <Row label="Prioridad" value={LEVEL_LABELS[info.priority]} />
        <Row label="Instrucciones para el personal" value={info.instructions} />
        {showFailure ? <><Row label="Fecha de reporte" value={showInstant(info.reportedAt)} /><Row label="Solicitado por" value={info.requestedBy} /></> : null}
        {showDowntime ? <Row label="Detenido desde" value={showInstant(info.downtimeStartedAt)} /> : null}
      </Card>
      {showFailure ? <Card style={styles.card}>
        <Text style={styles.cardTitle}>Análisis de la falla</Text>
        <Row label="Sistema" value={info.system?.label} />
        <Row label="Causa de falla" value={info.failureCause?.label} />
        <Row label="Método de detección" value={info.detectionMethod?.label} />
        <Row label="Severidad de la falla" value={info.failureSeverity ? LEVEL_LABELS[info.failureSeverity] : null} />
        <Row label="Tipo de daño causado" value={info.causedDamageType?.label} />
      </Card> : null}
      {showDowntime ? <Card style={styles.card}>
        <Text style={styles.cardTitle}>Otros activos afectados</Text>
        <Row label="¿Afecta a otros activos?" value={info.affectsOtherAssets ? "Sí" : "No"} />
        {info.affectsOtherAssets ? <>
          <Row label="Tiempo de interrupción" value={info.interruptionMinutes === null ? null : `${info.interruptionMinutes} min`} />
          <Row label="Equipos e implementos afectados" value={info.affectedAssets.map((asset) => asset.label).join("\n")} />
        </> : null}
      </Card> : null}
      {!info.canEdit ? <Text style={styles.hint}>El mantenimiento o tu trabajo ya está cerrado: la información se cambia desde la web.</Text>
        : !canEditPermission ? <Text style={styles.hint}>Tu sucursal no permite editar mantenimientos desde la app.</Text> : null}
      {editable ? <Button title="Editar información" icon="create-outline" onPress={() => { setDraft(toDraft(info)); setFormError(null); setMessage(null); }} /> : null}
    </> : null}

    {draft && info ? <CreationModal title="Editar información" onClose={() => { if (!saving) setDraft(null); }}
      footer={<>
        {formError ? <Text accessibilityRole="alert" style={styles.error}>{formError}</Text> : null}
        <Button title="Guardar" icon="checkmark-outline" loading={saving} disabled={saving} onPress={() => void save()} />
        <Button title="Cancelar" variant="secondary" disabled={saving} onPress={() => setDraft(null)} />
      </>}>
      <Field label="Título (opcional)" value={draft.title} maxLength={500} editable={!saving} onChangeText={(value) => set("title", value)} />
      <Field label="Motivo (opcional)" value={draft.motive} maxLength={5000} multiline editable={!saving} onChangeText={(value) => set("motive", value)} />
      <CreationSelectField label="Prioridad" value={draft.priority} disabled={saving} onChange={(value) => set("priority", value)}
        options={LEVELS.map((level) => ({ value: level, label: LEVEL_LABELS[level], tone: LEVEL_TONES[level] }))} />
      <MaintenanceDetailsFields type={info.type} value={draft} disabled={saving} catalogs={catalogs} scopeKey={group.id} equipmentId={info.equipment?.id}
        onChange={(patch) => setDraft((previous) => previous ? { ...previous, ...patch } : previous)} />
      <Text style={styles.hint}>El tipo de mantenimiento y el equipo se cambian desde la web.</Text>
    </CreationModal> : null}

  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  card: { gap: 8 },
  cardTitle: { ...typography.label, color: palette.heading, fontWeight: "800" },
  row: { gap: 2, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.track },
  rowLabel: { ...typography.caption, color: palette.textSecondary },
  rowValue: { ...typography.body, color: palette.text },
  hint: { ...typography.caption, color: palette.textSecondary },
  error: { ...typography.caption, color: palette.danger },
  label: { ...typography.label, color: palette.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  chipText: { ...typography.label, color: palette.text },
  chipTextOn: { color: palette.primary, fontWeight: "700" },
  chipTextWhite: { color: palette.white, fontWeight: "800" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pickerField: { gap: 6 },
  picker: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  pickerChosen: { borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  pickerText: { flex: 1, fontSize: 15, fontWeight: "600", color: palette.heading },
  placeholder: { color: palette.textMuted, fontWeight: "500" },
  dateRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", flexWrap: "wrap" },
  dateButton: { flex: 1, minWidth: 150 },
  timeBox: { flex: 1, minWidth: 140 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  assetRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
});

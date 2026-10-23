import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, type IconName } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { TimeField } from "../../ui/time/TimeField";
import { CreationDatePicker } from "../../screens/creation/CreationDatePicker";
import type { WorkshopStatuses } from "../../domain/workshopManage";
import { workshopStatusLabel } from "../../domain/workshopBoard";
import { OptionRow, PickerSheet } from "../intake/IntakePickers";
import { Notice } from "../entry/EntrySections";

const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const prettyDate = (value: string) => new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

/** Lista que se carga al abrir, con reintento. */
function useLoaded<T>(load: () => Promise<T>, fallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const loader = useRef(load);
  loader.current = load;
  const fetch = () => { setError(""); setData(null); loader.current().then(setData, (failure: unknown) => setError(failureText(failure, fallback))); };
  useEffect(fetch, []);
  return { data, error, retry: fetch };
}

function Loading({ text, error, retry }: { text: string; error: string; retry: () => void }) {
  return error ? <View style={styles.block}><Notice tone="danger" icon="cloud-offline-outline" message={error} /><Button title="Reintentar" variant="secondary" icon="refresh" onPress={retry} /></View>
    : <View style={styles.row}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>{text}</Text></View>;
}

/** Estado y subestado del ingreso, con los que configuró la sucursal (igual que en la web). */
export function StatusSheet({ load, onSave, onClose }: {
  load: () => Promise<WorkshopStatuses>; onSave: (statusId: number, subStatusId: number | null) => Promise<void>; onClose: () => void;
}) {
  const statuses = useLoaded(load, "No se pudieron cargar los estados.");
  const [statusId, setStatusId] = useState<number | null>(null);
  const [subStatusId, setSubStatusId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const chosen = statuses.data?.items.find((item) => item.id === statusId) ?? null;
  async function save() {
    if (statusId === null) return;
    setSaving(true); setError("");
    try { await onSave(statusId, subStatusId); } catch (failure) { setError(failureText(failure, "No se pudo cambiar el estado.")); } finally { setSaving(false); }
  }
  return <PickerSheet title="Cambiar estado" onClose={saving ? () => undefined : onClose}
    footer={<Button title={chosen ? `Guardar: ${workshopStatusLabel(chosen.name)}` : "Elige un estado"} icon="checkmark" loading={saving} disabled={saving || !chosen} onPress={() => void save()} />}>
    {!statuses.data ? <Loading text="Cargando estados…" error={statuses.error} retry={statuses.retry} /> : null}
    {statuses.data?.items.length === 0 ? <Text style={styles.hint}>La sucursal no tiene estados configurados para los ingresos.</Text> : null}
    {statuses.data?.items.map((status) => <View key={status.id} style={styles.group}>
      <OptionRow title={workshopStatusLabel(status.name)} selected={statusId === status.id}
        onPress={() => { setStatusId(status.id); setSubStatusId(null); setError(""); }} />
      {statusId === status.id && status.subStatuses.length > 0 ? <View style={styles.subList}>
        <Text style={styles.label}>Subestado (opcional)</Text>
        {status.subStatuses.map((sub) => <OptionRow key={sub.id} title={sub.name} selected={subStatusId === sub.id}
          onPress={() => setSubStatusId((current) => current === sub.id ? null : sub.id)} />)}
      </View> : null}
      {statusId === status.id && status.subStatuses.length === 0 ? <Text style={[styles.hint, styles.subList]}>Este estado no tiene subestados. Los subestados se configuran en la web.</Text> : null}
    </View>)}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Mover el equipo a otra nave del taller. Solo aparecen las naves con espacio. */
export function MoveAreaSheet({ currentAreaId, load, onMove, onClose }: {
  currentAreaId: number | null; load: () => Promise<{ items: Array<{ id: number; title: string }> }>; onMove: (areaId: number, note: string | null) => Promise<void>; onClose: () => void;
}) {
  const areas = useLoaded(load, "No se pudieron cargar las naves.");
  const [areaId, setAreaId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = areas.data?.items.filter((item) => item.id !== currentAreaId) ?? [];
  async function move() {
    if (areaId === null) return;
    setSaving(true); setError("");
    try { await onMove(areaId, note.trim() || null); } catch (failure) { setError(failureText(failure, "No se pudo mover el equipo.")); } finally { setSaving(false); }
  }
  return <PickerSheet title="Mover a otra nave" onClose={saving ? () => undefined : onClose}
    footer={<Button title="Mover equipo" icon="swap-horizontal" loading={saving} disabled={saving || areaId === null} onPress={() => void move()} />}>
    {!areas.data ? <Loading text="Buscando naves con espacio…" error={areas.error} retry={areas.retry} /> : null}
    {areas.data && options.length === 0 ? <Notice tone="warning" icon="alert-circle-outline" message="No hay otra nave con espacio libre en este taller." /> : null}
    {options.map((area) => <OptionRow key={area.id} title={area.title} selected={areaId === area.id} onPress={() => { setAreaId(area.id); setError(""); }} />)}
    {options.length > 0 ? <View style={styles.field}>
      <Text style={styles.label}>Nota (opcional)</Text>
      <TextInput value={note} onChangeText={setNote} maxLength={500} multiline placeholder="Ej.: pasa a motores para el desarme" placeholderTextColor={palette.textMuted}
        style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel="Nota del movimiento" />
    </View> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Nueva fecha estimada de entrega. Como en la web, se pide el motivo y queda en el historial. */
export function EstimatedDateSheet({ current, scopeKey, onSave, onClose }: {
  current: string | null; scopeKey: string; onSave: (iso: string, reason: string) => Promise<void>; onClose: () => void;
}) {
  const start = current && Number.isFinite(Date.parse(current)) ? new Date(current) : null;
  const [date, setDate] = useState(start ? localDate(start) : "");
  const [time, setTime] = useState(start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : "18:00");
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const at = new Date(`${date}T${time || "18:00"}:00`);
    if (!date || !Number.isFinite(at.getTime())) { setError("Elige la nueva fecha."); return; }
    if (reason.trim().length < 3) { setError("Escribe el motivo del cambio."); return; }
    setSaving(true); setError("");
    try { await onSave(at.toISOString(), reason.trim()); } catch (failure) { setError(failureText(failure, "No se pudo cambiar la fecha.")); } finally { setSaving(false); }
  }
  // El calendario reemplaza a la ventana mientras se elige, para no abrir una ventana sobre otra.
  if (picking) return <CreationDatePicker value={date || localDate(new Date())} showInputHint={false} onClose={() => setPicking(false)}
    onChange={(value) => { setDate(value); setError(""); }} />;
  return <PickerSheet title="Cambiar fecha de entrega" onClose={saving ? () => undefined : onClose}
    footer={<Button title="Guardar nueva fecha" icon="calendar" loading={saving} disabled={saving} onPress={() => void save()} />}>
    <View style={styles.row}>
      <SelectorTrigger label="Nueva fecha *" value={date ? prettyDate(date) : ""} icon="calendar-outline" disabled={saving} containerStyle={styles.grow} onPress={() => setPicking(true)} />
      <TimeField label="Hora" value={time} scopeKey={`workshop-estimated-${scopeKey}`} disabled={saving} containerStyle={styles.time} onChange={setTime} />
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Motivo *</Text>
      <TextInput value={reason} onChangeText={(value) => { setReason(value); setError(""); }} maxLength={500} multiline placeholder="Ej.: se espera un repuesto"
        placeholderTextColor={palette.textMuted} style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel="Motivo del cambio de fecha" />
    </View>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

export interface ManageTile { icon: IconName; label: string; onPress: () => void; strong?: boolean }

/** Accesos rápidos de la ficha en una fila compacta: datos, inspección, firma, estado, nave y fecha de entrega. */
export function ManageBar({ onStatus, onMove, onDate, extra = [] }: { onStatus?: () => void; onMove?: () => void; onDate?: () => void; extra?: ManageTile[] }) {
  const tiles: ManageTile[] = [
    ...extra,
    ...(onStatus ? [{ icon: "flag-outline" as const, label: "Estado", onPress: onStatus }] : []),
    ...(onMove ? [{ icon: "swap-horizontal" as const, label: "Mover nave", onPress: onMove }] : []),
    ...(onDate ? [{ icon: "calendar-outline" as const, label: "Fecha entrega", onPress: onDate }] : [])
  ];
  if (tiles.length === 0) return null;
  return <View style={styles.bar}>{tiles.map((tile) => <Pressable key={tile.label} accessibilityRole="button" accessibilityLabel={tile.label} onPress={tile.onPress}
    style={({ pressed }) => [styles.tile, tile.strong && styles.tileStrong, pressed && styles.tilePressed]}>
    <Ionicons name={tile.icon} size={16} color={tile.strong ? palette.white : palette.primary} accessible={false} />
    <Text style={[styles.tileText, tile.strong && styles.tileTextStrong]} numberOfLines={1}>{tile.label}</Text>
  </Pressable>)}</View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", gap: 6 },
  // Botones de una línea (ícono junto al nombre) con el color de la marca para que se note que se tocan.
  tile: { flex: 1, minWidth: 0, minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 6, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1, borderColor: palette.primary, backgroundColor: palette.primarySoft },
  tileStrong: { backgroundColor: palette.primary, borderColor: palette.primary },
  tileTextStrong: { color: palette.white },
  tilePressed: { opacity: 0.7 },
  tileText: { flexShrink: 1, fontSize: 12, fontWeight: "800", color: palette.primary },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  grow: { flex: 1 },
  time: { width: 110 },
  block: { gap: 8 },
  group: { gap: 6 },
  subList: { gap: 6, paddingLeft: 16, borderLeftWidth: 2, borderLeftColor: palette.border, marginLeft: 8 },
  hint: { ...typography.caption, color: palette.textSecondary },
  field: { gap: 6 },
  label: { ...typography.label, color: palette.text },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  multiline: { minHeight: 80, paddingTop: 10 },
  error: { ...typography.caption, color: palette.danger }
});

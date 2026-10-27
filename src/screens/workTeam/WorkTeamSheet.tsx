import { Ionicons } from "@expo/vector-icons";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { isFinished, plainText } from "../../domain/format";
import type { AssignmentGroup, AssignmentWork } from "../../domain/models";
import { availableTeamCandidates, canRemoveTeamMember, type WorkTeam, type WorkTeamMember } from "../../domain/workTeam";
import { errorText } from "../../infrastructure/errors";
import { palette, radius, typography } from "../../ui/theme";
import { PickerSheet, PickerState, SearchBox } from "../../workshop/intake/IntakePickers";
import { Notice } from "../workDetail/DetailUi";

/** Acciones para gestionar el equipo de un trabajo. Sin proveedor (demostración, sin conexión o permiso apagado) no se muestra la gestión. */
export interface WorkTeamActions {
  load: (group: AssignmentGroup, work: AssignmentWork) => Promise<WorkTeam>;
  add: (group: AssignmentGroup, work: AssignmentWork, workerId: number) => Promise<WorkTeam>;
  remove: (group: AssignmentGroup, work: AssignmentWork, workerId: number) => Promise<WorkTeam>;
}

const WorkTeamContext = createContext<WorkTeamActions | null>(null);

export function WorkTeamProvider({ value, children }: { value: WorkTeamActions | null; children: ReactNode }) {
  return <WorkTeamContext.Provider value={value}>{children}</WorkTeamContext.Provider>;
}

/** Solo los trabajos productivos, del servidor y sin terminar tienen equipo editable. */
export function canManageWorkTeam(group: AssignmentGroup, work: AssignmentWork): boolean {
  return work.workType === "productive" && !group.id.startsWith("direct-np-") && !group.id.startsWith("local-") && !work.id.startsWith("local-") && !isFinished(work);
}

/** Abre la ventana del equipo desde la tarjeta o la ficha. `open` es nulo cuando no se puede gestionar. */
export function useWorkTeamSheet(group: AssignmentGroup, work: AssignmentWork, disabled = false): { open: (() => void) | null; sheet: ReactNode } {
  const actions = useContext(WorkTeamContext);
  const [visible, setVisible] = useState(false);
  const manageable = actions !== null && canManageWorkTeam(group, work);
  useEffect(() => { if (!manageable) setVisible(false); }, [manageable]);
  return {
    open: manageable && !disabled ? () => setVisible(true) : null,
    sheet: visible && actions ? <WorkTeamSheet group={group} work={work} actions={actions} onClose={() => setVisible(false)} /> : null,
  };
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function Avatar({ person }: { person: WorkTeamMember }) {
  return person.avatarThumbnail ? <Image source={{ uri: person.avatarThumbnail }} style={styles.avatar} accessible={false} />
    : <View style={[styles.avatar, styles.initials, person.avatarColor ? { backgroundColor: person.avatarColor } : null]}><Text style={styles.initialsText}>{initials(person.name)}</Text></View>;
}

function WorkTeamSheet({ group, work, actions, onClose }: { group: AssignmentGroup; work: AssignmentWork; actions: WorkTeamActions; onClose: () => void }) {
  const [team, setTeam] = useState<WorkTeam | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const load = () => {
    setLoadError(""); setTeam(null);
    actions.load(group, work).then(value => { if (mounted.current) setTeam(value); }, (failure: unknown) => { if (mounted.current) setLoadError(errorText(failure)); });
  };
  useEffect(load, []);
  const candidates = useMemo(() => team ? availableTeamCandidates(team, query).slice(0, 100) : [], [team, query]);
  const removable = team ? canRemoveTeamMember(team) : false;

  async function change(person: WorkTeamMember, add: boolean) {
    if (saving !== null) return;
    setSaving(person.id); setError(""); setNotice(""); setConfirmRemove(null);
    try {
      const next = add ? await actions.add(group, work, person.id) : await actions.remove(group, work, person.id);
      if (!mounted.current) return;
      // Quien se quita a sí mismo deja de ver el trabajo: se cierra la ventana.
      if (!add && person.isCurrentUser) { onClose(); return; }
      setTeam(next); setQuery("");
      setNotice(add ? `${person.name} quedó asignado desde hoy en adelante.` : `${person.name} ya no está en el equipo.`);
    } catch (failure) {
      if (mounted.current) setError(errorText(failure));
    } finally {
      if (mounted.current) setSaving(null);
    }
  }

  const ordered = team ? [...team.members].sort((a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser)) : [];
  return <PickerSheet title="Equipo del trabajo" onClose={onClose}>
    <Text style={styles.subtitle} numberOfLines={2}>{plainText(work.title) || "Trabajo sin título"}</Text>
    <PickerState loading={team === null && !loadError} error={loadError} empty={null} onRetry={load} />
    {error ? <Notice message={error} tone="error" onDismiss={() => setError("")} /> : null}
    {notice ? <Notice message={notice} tone="success" onDismiss={() => setNotice("")} /> : null}
    {team ? <>
      <Text style={styles.section} accessibilityRole="header">Asignados ({team.members.length})</Text>
      {ordered.map(person => <View key={person.id} style={[styles.row, person.isCurrentUser && styles.rowSelf]}>
        <Avatar person={person} />
        <Text style={styles.name} numberOfLines={2}>{person.isCurrentUser ? `${person.name} (Tú)` : person.name}</Text>
        {removable ? confirmRemove === person.id ? <View style={styles.confirm}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Confirmar quitar a ${person.name}`} disabled={saving !== null} onPress={() => void change(person, false)} style={({ pressed }) => [styles.pill, styles.pillDanger, pressed && styles.pressed]}>
            <Text style={styles.pillDangerText}>{saving === person.id ? "Quitando…" : "Quitar"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancelar" disabled={saving !== null} onPress={() => setConfirmRemove(null)} style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
            <Text style={styles.pillText}>No</Text>
          </Pressable>
        </View> : <Pressable accessibilityRole="button" accessibilityLabel={`Quitar a ${person.isCurrentUser ? "ti mismo" : person.name} del equipo`} hitSlop={8} disabled={saving !== null}
          onPress={() => setConfirmRemove(person.id)} style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}>
          <Ionicons name="person-remove-outline" size={20} color={palette.danger} accessible={false} />
        </Pressable> : null}
      </View>)}
      {!removable ? <Text style={styles.hint}>El trabajo no puede quedar sin responsables: agrega a otro técnico para poder quitar a este.</Text> : null}
      <Text style={styles.section} accessibilityRole="header">Agregar técnico</Text>
      <Text style={styles.hint}>Queda asignado en todos los días planificados desde hoy y verá el trabajo en su jornada.</Text>
      <SearchBox value={query} onChange={setQuery} placeholder="Buscar técnico por nombre" />
      {candidates.length === 0 ? <PickerState loading={false} error="" empty={query ? "Sin resultados para esa búsqueda." : "No hay más técnicos disponibles en la sucursal."} /> : null}
      {candidates.map(person => <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Agregar a ${person.name}`} disabled={saving !== null}
        onPress={() => void change(person, true)} style={({ pressed }) => [styles.row, pressed && styles.pressed, saving !== null && saving !== person.id && styles.dimmed]}>
        <Avatar person={person} />
        <Text style={styles.name} numberOfLines={2}>{person.name}</Text>
        <View style={[styles.pill, styles.pillAdd]}>
          <Ionicons name="add" size={16} color={palette.white} accessible={false} />
          <Text style={styles.pillAddText}>{saving === person.id ? "Agregando…" : "Agregar"}</Text>
        </View>
      </Pressable>)}
    </> : null}
  </PickerSheet>;
}

const styles = StyleSheet.create({
  subtitle: { ...typography.caption, color: palette.textSecondary, marginTop: -6 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: palette.textMuted, marginTop: 6 },
  hint: { ...typography.caption, color: palette.textSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  rowSelf: { borderColor: palette.infoBorder, backgroundColor: palette.infoSoft },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  initials: { backgroundColor: palette.navyLight, alignItems: "center", justifyContent: "center" },
  initialsText: { fontSize: 12, fontWeight: "800", color: palette.white },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "700", color: palette.text },
  confirm: { flexDirection: "row", gap: 6 },
  iconAction: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.dangerSoft },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  pillText: { fontSize: 13, fontWeight: "700", color: palette.text },
  pillDanger: { backgroundColor: palette.dangerSolid, borderColor: palette.dangerSolid },
  pillDangerText: { fontSize: 13, fontWeight: "800", color: palette.white },
  pillAdd: { backgroundColor: palette.primary, borderColor: palette.primary },
  pillAddText: { fontSize: 13, fontWeight: "800", color: palette.white },
  pressed: { opacity: 0.75 },
  dimmed: { opacity: 0.5 },
});

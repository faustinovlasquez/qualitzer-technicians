import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { checklistAssociationBlocked, type ChecklistAssignmentResult, type ChecklistCatalogOption, type ChecklistCatalogPage, type ChecklistCatalogQuery } from "../../../domain/checklistAssignment";
import { plainText } from "../../../domain/format";
import type { AssignmentGroup, AssignmentWork, Session } from "../../../domain/models";
import { isOfflineQueuedError } from "../../../domain/offline";
import { operationErrorReason, operationStatusLabels, type PendingChecklist } from "../../offline/offlineUi";
import { Badge, BodyText, Button, Card, Field, SectionTitle } from "../../../ui/components";
import { palette } from "../../../ui/theme";

export interface ChecklistAssociationPanelProps {
  storageKey: string;
  group: AssignmentGroup;
  work: AssignmentWork;
  mode: Session["mode"];
  online: boolean;
  busy: boolean;
  pendingLocalWork?: boolean;
  readOnly?: boolean;
  pending?: PendingChecklist[];
  offlineReady?: boolean;
  loadOptions: (query: ChecklistCatalogQuery) => Promise<ChecklistCatalogPage>;
  attach: (checklistId: number) => Promise<ChecklistAssignmentResult>;
  onAttached: (result: ChecklistAssignmentResult) => Promise<void> | void;
}

export function ChecklistAssociationPanel(props: ChecklistAssociationPanelProps) {
  return <ChecklistAssociationContent key={`${props.storageKey}:${props.mode}:${props.group.id}:${props.work.id}`} {...props} />;
}

function ChecklistAssociationContent(props: ChecklistAssociationPanelProps) {
  const { group, work, mode, online, busy, pendingLocalWork, readOnly, loadOptions, attach, onAttached, pending = [], offlineReady = true } = props;
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState<ChecklistCatalogPage | null>(null);
  const [selected, setSelected] = useState<ChecklistCatalogOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ChecklistAssignmentResult | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [localQueued, setLocalQueued] = useState<{ operationId: string; checklistId: number }[]>([]);
  const queuedRef = useRef(localQueued);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const blocked = !offlineReady ? "Recupera la cola y verifica tu sesión antes de agregar un checklist." : readOnly ? "Actualiza el detalle canónico antes de agregar un checklist." : checklistAssociationBlocked(group, work, online, pendingLocalWork);
  const unavailable = useRef(Boolean(blocked) || busy);
  unavailable.current = Boolean(blocked) || busy;
  const current = useRef(props);
  current.current = props;
  function alreadyQueued(id: number): boolean {
    return queuedRef.current.some((entry) => entry.checklistId === id) || (current.current.pending ?? []).some((entry) => entry.payload.checklistId === id);
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);
  useEffect(() => {
    if (blocked) { generation.current++; setSelected(null); setPage(null); setLoading(false); }
  }, [blocked]);
  useEffect(() => {
    queuedRef.current = queuedRef.current.filter((entry) => !pending.some((operation) => operation.id === entry.operationId) && !work.checklists.some((list) => list.checklistId === entry.checklistId));
    setLocalQueued(queuedRef.current);
  }, [props.pending, work.checklists]);

  async function load(nextPage: number, query = appliedSearch) {
    if (!mounted.current || unavailable.current || inFlight.current) return;
    const current = ++generation.current;
    setLoading(true); setError(null); setSelected(null); setPage(null);
    try {
      const result = await loadOptions({ search: query, page: nextPage });
      if (current !== generation.current || !mounted.current || unavailable.current) return;
      setPage(result); setAppliedSearch(query);
    } catch (cause) {
      if (current === generation.current && mounted.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar el catálogo.");
    } finally { if (current === generation.current && mounted.current) setLoading(false); }
  }

  async function refresh(result: ChecklistAssignmentResult) {
    try { await onAttached(result); if (mounted.current) setRefreshPending(false); }
    catch { if (mounted.current) { setRefreshPending(true); setError("Checklist asociado. No se pudo actualizar el detalle; vuelve a actualizarlo sin repetir la asociación."); } }
  }

  async function confirm() {
    if (!mounted.current || !selected || selected.alreadyAssigned || alreadyQueued(selected.id) || work.checklists.some((list) => list.checklistId === selected.id) || unavailable.current || inFlight.current || loading) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      const result = await attach(selected.id);
      if (!mounted.current) return;
      setConfirmed(result); setSelected(null); setPage(null); setOpened(false);
      void refresh(result);
    } catch (cause) {
      if (isOfflineQueuedError(cause) && cause.kind === "checklist") {
        queuedRef.current = [...queuedRef.current, { operationId: cause.operationId, checklistId: selected.id }];
        if (mounted.current) {
          setLocalQueued(queuedRef.current); setSelected(null); setPage(null); setOpened(false); setConfirmed(null);
        }
      } else if (mounted.current) setError(cause instanceof Error ? cause.message : "No se pudo confirmar la asociación. Actualiza antes de reintentar.");
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }

  const disabled = Boolean(blocked) || busy || saving;
  return (
    <Card style={styles.panel}>
      <SectionTitle title="Checklists de la empresa" subtitle="Agrega un checklist existente sin cambiar respuestas ni borradores de los demás." />
      {mode === "demo" ? <Badge label="Catálogo de demostración" tone="info" /> : null}
      <Button title="Agregar checklist" icon="add-circle-outline" disabled={disabled || loading} onPress={() => { setOpened(true); setConfirmed(null); void load(0, search); }} />
      {blocked ? <BodyText>{blocked}</BodyText> : <BodyText>{online ? "La asociación se valida en el servidor al sincronizar." : "Solo están disponibles las búsquedas guardadas en este dispositivo."} La selección queda pendiente hasta la confirmación; no se inventan pasos ni respuestas.</BodyText>}
      {pending.filter((operation) => operation.status !== "applied").map((operation) => <View key={operation.id} style={styles.panel}>
        <Badge label={`Checklist ${operation.payload.checklistId} · ${operationStatusLabels[operation.status]}`} tone="warning" />
        <BodyText>Asociación en cola · pasos pendientes de confirmar.</BodyText>
        {operation.lastError ? <BodyText>{operationErrorReason(operation.lastError)}</BodyText> : null}
      </View>)}
      {localQueued.filter((entry) => !pending.some((operation) => operation.id === entry.operationId)).map((entry) => <Badge key={entry.operationId} label={`Checklist ${entry.checklistId} · asociación en cola`} tone="warning" />)}
      {confirmed ? <Badge label={confirmed.alreadyAssigned ? "El checklist ya estaba asociado" : "Checklist asociado"} tone="success" /> : null}
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {refreshPending && confirmed ? <Button title="Actualizar detalle" variant="secondary" disabled={disabled} onPress={() => { void refresh(confirmed); }} /> : null}
      {opened && !blocked ? <View style={styles.panel}>
        <Field label="Buscar por nombre o código" value={search} onChangeText={setSearch} maxLength={120} editable={!saving && !busy} onSubmitEditing={() => { void load(0, search); }} />
        <Button title="Buscar" icon="search-outline" variant="secondary" loading={loading} disabled={disabled} onPress={() => { void load(0, search); }} />
        {page?.items.length === 0 ? <BodyText>No hay checklists activos con pasos para esta búsqueda.</BodyText> : null}
        {page?.items.map((option) => {
          const associated = option.alreadyAssigned || work.checklists.some((item) => item.checklistId === option.id);
          const queued = alreadyQueued(option.id);
          return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected?.id === option.id, disabled: associated || queued || disabled }} disabled={associated || queued || disabled || loading} onPress={() => { if (!unavailable.current && !alreadyQueued(option.id)) setSelected(option); }} style={[styles.option, selected?.id === option.id && styles.selected]}>
            <Text style={styles.name}>{plainText(option.name)}</Text>
            <BodyText>{plainText(option.code ?? "") || "Sin código"}</BodyText>
            {option.description ? <Text numberOfLines={3}>{plainText(option.description)}</Text> : null}
            {associated ? <Badge label="Ya asociado" /> : null}
            {queued && !associated ? <Badge label="Asociación registrada · pendiente de ficha" tone="warning" /> : null}
          </Pressable>;
        })}
        {page ? <View style={styles.pagination}>
          <Button title="Anterior" variant="ghost" disabled={disabled || loading || page.page === 0} onPress={() => { void load(page.page - 1); }} />
          <BodyText>Página {page.page + 1}</BodyText>
          <Button title="Siguiente" variant="ghost" disabled={disabled || loading || !page.hasMore || page.page >= 1000} onPress={() => { void load(page.page + 1); }} />
        </View> : null}
        {selected ? <View style={styles.panel}>
          <BodyText>¿Agregar «{plainText(selected.name)}» a este trabajo? Se crearán respuestas nuevas en blanco; no se copiarán evidencias.</BodyText>
          <Button title="Confirmar asociación" loading={saving} disabled={disabled || loading || alreadyQueued(selected.id)} onPress={() => { void confirm(); }} />
        </View> : null}
        <Button title="Cancelar" variant="ghost" disabled={saving} onPress={() => { generation.current++; setLoading(false); setOpened(false); setSelected(null); }} />
      </View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 }, option: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 14, gap: 6 },
  selected: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, name: { fontWeight: "700", color: palette.navy },
  error: { color: palette.danger }, pagination: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
});
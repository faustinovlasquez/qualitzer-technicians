import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import type { AssignmentGroup, Tenant, WorkStatus } from "../../domain/models";
import { assignmentWorkOrderCode } from "../../domain/assignmentCodes";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../../domain/orderLifecycle";
import type { UserSignatureAccess } from "../../domain/userSignatures";
import { Badge, BodyText, Button, Card, SectionTitle } from "../../ui/components";
import { Notice } from "../workDetail/DetailUi";
import { deleteLifecycleDraft, readLifecycleDraft, saveLifecycleDraft } from "./lifecycle/lifecycleDrafts";
import { deliveryWarnings, initialDeliveryDraft, lifecycleError, type DeliveryDraft } from "./lifecycle/lifecycleRules";
import { styles } from "./lifecycle/lifecycleStyles";
import { MaintenanceDeliveryDialog } from "./lifecycle/MaintenanceDeliveryDialog";
import { StartMaintenanceDialog } from "./lifecycle/StartMaintenanceDialog";

export { clearOrderLifecycleDrafts } from "./lifecycle/lifecycleDrafts";
export type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../../domain/orderLifecycle";

export interface OrderLifecyclePanelProps {
  dock?: boolean;
  onCreateWork?: () => void;
  group: AssignmentGroup;
  tenant?: Tenant;
  technicianName: string;
  signatureAccess?: UserSignatureAccess;
  storageKey: string;
  mode: "live" | "demo";
  busy: boolean;
  allow?: boolean;
  deliveryIntent?: "deliver" | "ready";
  onDeliveryIntentConsumed?: () => void;
  onStart: () => Promise<void>;
  onDeliver: (input: MaintenanceDeliveryInput) => Promise<void>;
  onLoad: () => Promise<MaintenanceDeliveryContext>;
}

type LifecycleAction = "load" | "start" | "deliver";

function finished(status: WorkStatus): boolean { return status === "completed" || status === "delivered"; }

export function OrderLifecyclePanel(props: OrderLifecyclePanelProps) {
  if (props.group.type !== "internal_maintenance") return null;
  const scope = `${props.storageKey}/order-lifecycle/${JSON.stringify([props.mode, props.tenant?.id, props.tenant?.portalOrigin, props.tenant?.environment, props.group.id])}`;
  return <OrderLifecycleContent key={scope} {...props} scope={scope} />;
}

function OrderLifecycleContent(props: OrderLifecyclePanelProps & { scope: string }) {
  const { group, tenant, mode, busy, allow = true, scope } = props;
  const orderLabel = assignmentWorkOrderCode(group) ?? group.code;
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(true);
  const actionRef = useRef<LifecycleAction | null>(null);
  const [action, setAction] = useState<LifecycleAction | null>(null);
  const [context, setContext] = useState<MaintenanceDeliveryContext | null>(null);
  const [dialog, setDialog] = useState<"start" | "preflight" | "ready" | "deliver" | null>(null);
  const consumedIntent = useRef<string | undefined>(undefined);
  const [draft, setDraft] = useState<DeliveryDraft | null>(() => props.storageKey.trim() ? readLifecycleDraft(scope) : null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<"start" | "deliver" | null>(null);
  const effectiveStatus = finished(group.status) ? group.status : confirmed === "deliver" ? "delivered" : context?.status ?? group.status;
  const readOnly = finished(effectiveStatus);
  const canStart = allow && !readOnly && effectiveStatus === "pending" && confirmed !== "start" && context?.canStart !== false;
  const canDeliver = allow && !readOnly && context?.canTechnicianDeliver !== false;
  const locked = busy || action !== null;
  const warnings = deliveryWarnings(group, context);

  async function loadContext(): Promise<MaintenanceDeliveryContext> {
    const loaded = await latest.current.onLoad();
    if (loaded.groupId !== latest.current.group.id) throw new Error("La respuesta pertenece a otra OT. No se han aplicado sus datos.");
    if (mounted.current) setContext(loaded);
    return loaded;
  }

  async function run(name: LifecycleAction, operation: () => Promise<void>): Promise<void> {
    if (actionRef.current !== null || latest.current.busy) return;
    actionRef.current = name;
    setAction(name);
    setError(null);
    try { await operation(); }
    catch (cause) { if (mounted.current) setError(lifecycleError(cause)); throw cause; }
    finally { actionRef.current = null; if (mounted.current) setAction(null); }
  }

  function reload(): void {
    void run("load", async () => { await loadContext(); }).catch(() => {});
  }

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; };
  }, []);

  function saveDraft(next: DeliveryDraft): void {
    setDraft(next);
    if (latest.current.storageKey.trim()) saveLifecycleDraft(scope, next);
  }

  function openDelivery(ready = false): void {
    if (locked || !canDeliver) return;
    setSuccess(null);
    void run("load", async () => {
      const loaded = await loadContext();
      if (!mounted.current) return;
      if (finished(loaded.status) || loaded.canTechnicianDeliver === false || latest.current.allow === false) throw new Error("La OT ya no permite entrega. Se actualizó su estado.");
      if (!loaded.technicianDeliverySupported) throw new Error("Actualiza el servidor para habilitar la entrega técnica simplificada.");
      if (!draft) saveDraft(initialDeliveryDraft(latest.current.group, loaded));
      if (!ready || deliveryWarnings(latest.current.group, loaded).allWorksDelivered) setDialog(ready ? "ready" : "preflight");
      latest.current.onDeliveryIntentConsumed?.();
    }).catch(() => {});
  }

  useEffect(() => {
    if (!props.deliveryIntent || consumedIntent.current === props.deliveryIntent || !context || locked || actionRef.current !== null || !canDeliver) return;
    consumedIntent.current = props.deliveryIntent;
    openDelivery(props.deliveryIntent === "ready");
  }, [props.deliveryIntent, context, locked, canDeliver]);

  async function start(): Promise<void> {
    if (!canStart) return;
    await run("start", async () => {
      const loaded = await loadContext();
      if (!mounted.current) return;
      if (loaded.status !== "pending" || loaded.canStart === false || latest.current.allow === false || finished(latest.current.group.status)) throw new Error("Esta OT ya no está pendiente o no admite inicio. Se actualizó su estado.");
      await latest.current.onStart();
      if (!mounted.current) return;
      setConfirmed("start");
      setDialog(null);
      setSuccess("Inicio de la OT confirmado.");
      try { await loadContext(); }
      catch { if (mounted.current) setError("El inicio fue confirmado, pero no se pudo actualizar la ficha. No repitas el inicio; pulsa Actualizar."); }
    });
  }

  async function deliver(input: MaintenanceDeliveryInput): Promise<void> {
    if (!canDeliver) throw new Error("La OT ya no permite entrega.");
    if (actionRef.current !== null || latest.current.busy) throw new Error("Hay una operación en curso. Espera antes de confirmar.");
    await run("deliver", async () => {
      const loaded = await loadContext();
      if (!mounted.current) return;
      if (finished(loaded.status) || loaded.canTechnicianDeliver === false || !loaded.technicianDeliverySupported || latest.current.allow === false || finished(latest.current.group.status)) throw new Error("La OT ya no permite entrega. Se actualizó su estado.");
      if (dialog !== "deliver" || input.acknowledgeDelivery !== true || !input.technicianSignature) throw new Error("Confirma el aviso previo y añade tu firma.");
      await latest.current.onDeliver(input);
      deleteLifecycleDraft(scope);
      if (!mounted.current) return;
      setDraft(null);
      setConfirmed("deliver");
      setDialog(null);
      setSuccess(mode === "demo" ? "Entrega confirmada en demostración." : "Entrega de la OT confirmada.");
      try { await loadContext(); }
      catch { if (mounted.current) setError("La entrega fue confirmada, pero no se pudo actualizar la ficha. No vuelvas a entregarla; pulsa Actualizar."); }
    });
  }

  function discardDraft(): void {
    if (locked) return;
    deleteLifecycleDraft(scope);
    setDraft(null);
  }

  const Container = props.dock ? View : Card;
  return <Container style={props.dock ? { gap: 8 } : styles.stack}>
    {!props.dock ? <>
    <View style={styles.row}>
      <View style={styles.grow}><SectionTitle title="Entrega de OT" /></View>
      <Badge label={readOnly ? "OT cerrada" : effectiveStatus === "pending" && confirmed !== "start" ? "Por iniciar" : "En ejecución"} tone={readOnly ? "success" : "teal"} />
    </View>
    {tenant ? <Text style={styles.caption}>{tenant.name} · {orderLabel}</Text> : null}
    </> : null}
    {readOnly ? <Notice message="OT entregada o finalizada." tone="success" /> : null}
    {!allow ? <Notice message="El acceso actual no habilita inicio ni entrega de esta OT." tone="warning" /> : null}
    {success ? <Notice message={success} tone="success" /> : null}
    {error ? <Notice message={error} tone="error" /> : null}
    {context?.durationMinutes !== null && context?.durationMinutes !== undefined ? <Text style={styles.label}>Duración informada: {Math.floor(context.durationMinutes / 60)} h {context.durationMinutes % 60} min</Text> : null}
    {readOnly && context?.finalizationNote ? <BodyText>{context.finalizationNote}</BodyText> : null}
    {!readOnly ? <View style={props.dock ? { flexDirection: "row", gap: 8, alignItems: "stretch" } : styles.stack}>
      {canStart || props.dock ? <Button title={canStart ? "Iniciar OT" : "OT iniciada"} icon="play-outline" variant="secondary" disabled={locked || !canStart} onPress={() => { setError(null); setSuccess(null); setDialog("start"); }} style={props.dock ? { flex: 1, minWidth: 0, flexDirection: "column", paddingHorizontal: 4 } : undefined} textStyle={props.dock ? { fontSize: 12, textAlign: "center" } : undefined} /> : null}
      <Button title="Entregar OT" icon="checkmark-circle-outline" disabled={locked || !canDeliver} onPress={() => openDelivery()} style={[{ backgroundColor: "#C4510A", borderColor: "#C4510A" }, props.dock && { flex: 1, minWidth: 0, flexDirection: "column", paddingHorizontal: 4 }]} textStyle={props.dock ? { fontSize: 12, textAlign: "center" } : undefined} />
      {props.dock && props.onCreateWork ? <Button title="Crear trabajo" icon="add-outline" variant="secondary" disabled={locked || !allow} onPress={props.onCreateWork} style={{ flex: 1, minWidth: 0, flexDirection: "column", paddingHorizontal: 4 }} textStyle={{ fontSize: 12, textAlign: "center" }} /> : null}
      {draft && !props.dock ? <Button title="Descartar borrador" variant="ghost" icon="trash-outline" disabled={locked} onPress={discardDraft} /> : null}
    </View> : null}
    {!props.dock || error ? <Button title="Actualizar estado de OT" icon="refresh-outline" variant="ghost" loading={action === "load"} disabled={locked} onPress={reload} /> : null}
    {dialog === "start" ? <StartMaintenanceDialog orderLabel={orderLabel} busy={locked} allowed={canStart} mode={mode} error={error} onClose={() => setDialog(null)} onStart={() => { void start().catch(() => {}); }} /> : null}
    {dialog === "preflight" || dialog === "ready" ? <Modal visible transparent animationType="fade" onRequestClose={() => { if (!locked) setDialog(null); }}>
      <SafeAreaView style={styles.overlay}><View style={styles.modal}>
        <View style={styles.header}>
          <Ionicons name={dialog === "ready" ? "checkmark-circle-outline" : "alert-circle-outline"} size={44} color={dialog === "ready" ? "#16805D" : "#C4510A"} accessible={false} />
          <SectionTitle title={dialog === "ready" ? "Tus trabajos ya están entregados" : "Antes de entregar la OT"} subtitle={orderLabel} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {dialog === "ready" ? <BodyText>Ya tienes todo listo para entregar la OT. ¿Quieres hacerlo ahora?</BodyText> : <View style={styles.stack}>
            {warnings.pendingWorks.length > 0 ? <View style={styles.tight}><Text style={styles.label}>{warnings.pendingWorks.length} trabajo(s) sin entregar</Text>{warnings.pendingWorks.slice(0, 3).map((name, index) => <BodyText key={`${index}:${name}`}>{name}</BodyText>)}{warnings.pendingWorks.length > 3 ? <BodyText>Y {warnings.pendingWorks.length - 3} más.</BodyText> : null}</View> : null}
            {warnings.pendingChecklists.length > 0 ? <View style={styles.tight}><Text style={styles.label}>{warnings.pendingChecklists.length} checklist(s) incompleto(s)</Text>{warnings.pendingChecklists.slice(0, 3).map(name => <BodyText key={name}>{name}</BodyText>)}{warnings.pendingChecklists.length > 3 ? <BodyText>Y {warnings.pendingChecklists.length - 3} más.</BodyText> : null}</View> : null}
            <Notice tone="warning" message="La OT y todos sus trabajos pasarán a entregados, aunque haya checklists incompletos. Sus respuestas y evidencias se conservarán tal como están." />
          </View>}
        </ScrollView>
        <View style={styles.footer}>
          <Button title={dialog === "ready" ? "Sí, entregar OT" : "Entendido, continuar"} icon="arrow-forward-outline" disabled={locked || !canDeliver} onPress={() => setDialog(dialog === "ready" ? "preflight" : "deliver")} style={{ backgroundColor: "#C4510A", borderColor: "#C4510A" }} />
          <Button title={dialog === "ready" ? "Más tarde" : "Cancelar"} variant="ghost" disabled={locked} onPress={() => setDialog(null)} />
        </View>
      </View></SafeAreaView>
    </Modal> : null}
    {dialog === "deliver" && context && draft ? <MaintenanceDeliveryDialog
      orderLabel={orderLabel}
      tenantName={tenant?.name}
      technicianName={props.technicianName}
      signatureAccess={props.signatureAccess}
      mode={mode}
      context={context}
      draft={draft}
      busy={locked}
      unavailable={!canDeliver}
      reasons={[]}
      error={error}
      onChange={saveDraft}
      onClose={() => setDialog(null)}
      onSubmit={deliver}
      onReload={reload}
    /> : null}
  </Container>;
}

export default OrderLifecyclePanel;
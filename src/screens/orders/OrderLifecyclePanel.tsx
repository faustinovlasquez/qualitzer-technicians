import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { AssignmentGroup, Tenant, WorkStatus } from "../../domain/models";
import { assignmentWorkOrderCode } from "../../domain/assignmentCodes";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../../domain/orderLifecycle";
import type { UserSignatureAccess } from "../../domain/userSignatures";
import { Badge, BodyText, Button, Card, SectionTitle } from "../../ui/components";
import { Notice } from "../workDetail/DetailUi";
import { deleteLifecycleDraft, readLifecycleDraft, saveLifecycleDraft } from "./lifecycle/lifecycleDrafts";
import { incompleteDeliveryChecklists, initialDeliveryDraft, lifecycleError, requiresClientSignature, type DeliveryDraft } from "./lifecycle/lifecycleRules";
import { styles } from "./lifecycle/lifecycleStyles";
import { MaintenanceDeliveryDialog } from "./lifecycle/MaintenanceDeliveryDialog";
import { StartMaintenanceDialog } from "./lifecycle/StartMaintenanceDialog";

export { clearOrderLifecycleDrafts } from "./lifecycle/lifecycleDrafts";
export type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../../domain/orderLifecycle";

export interface OrderLifecyclePanelProps {
  group: AssignmentGroup;
  tenant?: Tenant;
  technicianName: string;
  signatureAccess?: UserSignatureAccess;
  storageKey: string;
  mode: "live" | "demo";
  busy: boolean;
  allow?: boolean;
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
  const [dialog, setDialog] = useState<"start" | "deliver" | null>(null);
  const [draft, setDraft] = useState<DeliveryDraft | null>(() => props.storageKey.trim() ? readLifecycleDraft(scope) : null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<"start" | "deliver" | null>(null);
  const effectiveStatus = finished(group.status) ? group.status : confirmed === "deliver" ? "delivered" : context?.status ?? group.status;
  const readOnly = finished(effectiveStatus);
  const canStart = allow && !readOnly && effectiveStatus === "pending" && confirmed !== "start" && context?.canStart !== false;
  const canDeliver = allow && !readOnly && context?.canDeliver !== false;
  const locked = busy || action !== null;
  const reasons = [...new Set([...incompleteDeliveryChecklists(group), ...(context?.incompleteChecklists ?? [])])];

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

  function openDelivery(): void {
    if (locked || !canDeliver) return;
    setSuccess(null);
    void run("load", async () => {
      const loaded = await loadContext();
      if (!mounted.current) return;
      if (finished(loaded.status) || loaded.canDeliver === false) throw new Error("La OT ya no permite entrega. Se actualizó su estado.");
      if (!draft) saveDraft(initialDeliveryDraft(latest.current.group, loaded));
      setDialog("deliver");
    }).catch(() => {});
  }

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
      if (finished(loaded.status) || loaded.canDeliver === false || latest.current.allow === false || finished(latest.current.group.status)) throw new Error("La OT ya no permite entrega. Se actualizó su estado.");
      const pending = [...new Set([...loaded.incompleteChecklists, ...incompleteDeliveryChecklists(latest.current.group)])];
      if (pending.length > 0) throw new Error(`REQUIRED_CHECKLISTS_INCOMPLETE:${pending.join("; ")}`);
      if (requiresClientSignature(loaded.maintenanceType) && (!input.clientSignature || !input.receivedByName?.trim() || (input.faultType !== "operative" && input.faultType !== "wear"))) throw new Error("Los requisitos de recepción cambiaron. Vuelve a editar y completa el tipo de falla, receptor y firma.");
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

  return <Card style={styles.stack}>
    <View style={styles.row}>
      <View style={styles.grow}><SectionTitle title="Inicio y entrega de OT" subtitle="Gestión de la orden de mantenimiento" /></View>
      <Badge label={readOnly ? "OT cerrada" : effectiveStatus === "pending" && confirmed !== "start" ? "Por iniciar" : "En ejecución"} tone={readOnly ? "success" : "teal"} />
    </View>
    {tenant ? <Text style={styles.caption}>{tenant.name} · {orderLabel}</Text> : null}
    {readOnly ? <Notice message="La OT está entregada o finalizada. Este panel no admite otro inicio ni otra entrega; los permisos de los trabajos, comentarios y archivos se gestionan en sus propias secciones." tone="success" /> : <BodyText>Inicia la reparación o prepara su entrega con observaciones y firmas. Puedes entregar desde pendiente si los requisitos obligatorios están completos.</BodyText>}
    {!allow ? <Notice message="El acceso actual no habilita inicio ni entrega de esta OT." tone="warning" /> : null}
    {success ? <Notice message={success} tone="success" /> : null}
    {error ? <Notice message={error} tone="error" /> : null}
    {context?.durationMinutes !== null && context?.durationMinutes !== undefined ? <Text style={styles.label}>Duración informada: {Math.floor(context.durationMinutes / 60)} h {context.durationMinutes % 60} min</Text> : null}
    {readOnly && context?.finalizationNote ? <BodyText>{context.finalizationNote}</BodyText> : null}
    {!readOnly ? <View style={styles.stack}>
      {canStart ? <Button title="Iniciar OT" icon="play-outline" variant="secondary" disabled={locked} onPress={() => { setError(null); setSuccess(null); setDialog("start"); }} /> : null}
      <Button title={draft ? "Continuar borrador de entrega" : "Preparar entrega de OT"} icon="create-outline" disabled={locked || !canDeliver} onPress={openDelivery} />
      {reasons.length > 0 ? <Text style={styles.caption}>{reasons.length} checklist(s) obligatorio(s) pendiente(s). Puedes revisar el formulario antes de completarlos.</Text> : null}
      {draft ? <><Notice message="Hay un borrador de entrega en esta sesión. Se conserva al cambiar de pestaña; no se ha enviado." /><Button title="Descartar borrador de entrega" variant="ghost" icon="trash-outline" disabled={locked} onPress={discardDraft} /></> : null}
    </View> : null}
    <Button title="Actualizar estado de OT" icon="refresh-outline" variant="ghost" loading={action === "load"} disabled={locked} onPress={reload} />
    {dialog === "start" ? <StartMaintenanceDialog orderLabel={orderLabel} busy={locked} allowed={canStart} mode={mode} error={error} onClose={() => setDialog(null)} onStart={() => { void start().catch(() => {}); }} /> : null}
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
      reasons={reasons}
      error={error}
      onChange={saveDraft}
      onClose={() => setDialog(null)}
      onSubmit={deliver}
      onReload={reload}
    /> : null}
  </Card>;
}

export default OrderLifecyclePanel;
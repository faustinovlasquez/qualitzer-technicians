import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Assignments as AssignmentData, AssignmentGroup, AssignmentWork, DateRange, StatusInput, WorkOpenOptions } from "../domain/models";
import type { OfflineSnapshot } from "../domain/offline";
import { assignmentWorkQueryRange } from "../domain/assignmentSchedule";
import { isFinished } from "../domain/format";
import { AssignmentWorkCard } from "../screens/orders/AssignmentWorkCard";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAppPermission } from "../application/appPermissions";
import { evaluateInspection } from "../domain/workshopEntry";
import { palette } from "../ui/theme";
import { FileDrive } from "../files/FileDrive";
import { ChatThread } from "../chat/ChatThread";
import type { WorkshopArea, WorkshopEntry } from "../domain/workshopBoard";
import type { InspectionKind } from "../domain/workshopInspection";
import { CreationScreen, type CreationScreenProps } from "../screens/creation/CreationScreen";
import type { useWorkshopBoard } from "./useWorkshopBoard";
import { WorkshopBoardScreen } from "./WorkshopBoardScreen";
import { WorkshopEntryScreen } from "./WorkshopEntryScreen";
import { WorkshopIntakeScreen } from "./intake/WorkshopIntakeScreen";
import { WorkshopInspectionScreen } from "./inspection/WorkshopInspectionScreen";
import { WorkshopReceptionScreen } from "./reception/WorkshopReceptionScreen";
import { ReceptionDoneModal } from "./emails/ReceptionDoneModal";
import { WorkshopDeliveryScreen } from "./delivery/WorkshopDeliveryScreen";
import { WorkshopOrderScreen, type Section } from "./order/WorkshopOrderScreen";

type WorkshopModel = ReturnType<typeof useWorkshopBoard>;
interface EntryRef { entry: WorkshopEntry; area: WorkshopArea }
type Opened =
  | { kind: "entry"; ref: EntryRef; revision: number; notice?: string }
  | { kind: "intake"; entryId: number | null; areaId: number | null; areaTitle: string | null; back: EntryRef | null; thenInspection: boolean }
  | { kind: "inspection"; ref: EntryRef; inspection: InspectionKind; next: "reception" | "delivery" | null }
  | { kind: "reception"; ref: EntryRef }
  | { kind: "resume"; ref: EntryRef }
  | { kind: "files"; ref: EntryRef }
  | { kind: "comments"; ref: EntryRef }
  | { kind: "delivery"; ref: EntryRef }
  | { kind: "create-work"; ref: EntryRef; code: string; equipmentLabel: string; creating?: "work" | "maintenance"; order?: { orderId: number; entryCode: string } }
  | { kind: "order"; ref: EntryRef; orderId: number; entryCode: string; notice?: string };

/** Última pestaña usada en cada ingreso y OT: al volver (de un trabajo, al guardar…) se abre en la misma. Dura mientras la app está abierta. */
const rememberedTabs = new Map<string, string>();

export interface WorkshopAssignments {
  data: AssignmentData | null; range: DateRange; busy: boolean; workerId: number | null | undefined; companyBranchId: number | null;
  offline?: OfflineSnapshot | null;
  openWork: (group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions) => void;
  onWorkStatus: (group: AssignmentGroup, work: AssignmentWork, input: StatusInput) => Promise<void>;
  /** Vuelve a cargar Mi jornada (después de crear o unir trabajos desde el Taller). */
  refresh?: () => void;
  /** Asignaciones de 15 días atrás a 15 adelante y su cambio de estado: tarjeta completa aunque el trabajo no esté en los días de Mi jornada. */
  loadWide?: () => Promise<AssignmentData>;
  wideStatus?: (group: AssignmentGroup, work: AssignmentWork, input: StatusInput) => Promise<void>;
}

/** Vista de los trabajos en el ingreso y la OT: compacta (fila pequeña) o extendida (tarjeta de Mi jornada). Se recuerda. */
export type WorkLayout = "compact" | "extended";
const WORK_LAYOUT_KEY = "qualitzer.workshop.workLayout";

/** Avance de los trabajos de una OT según Mi jornada (o las asignaciones amplias del Taller); sin dato si alguno no está. */
function assignmentProgress(sources: Array<AssignmentData | null | undefined>, workIds: number[]): { completed: number; total: number } | null {
  const works = sources.flatMap((data) => data?.groups.flatMap((group) => group.works) ?? []);
  const found = workIds.map((workId) => works.find((work) => work.id === String(workId)));
  if (workIds.length === 0 || found.some((work) => !work)) return null;
  return { completed: found.filter((work) => work && isFinished(work)).length, total: workIds.length };
}

/** Formulario normal de creación de trabajos de la app, con lo que el Taller necesita para usarlo. */
export type WorkshopCreation = Pick<CreationScreenProps, "user" | "tenant" | "companyBranchId" | "initialDate" | "mode" | "storageKey" | "offline" | "busy" | "onLoadOptions" | "onSubmit">;

/** Mientras llega la ficha de un ingreso recién guardado se muestra con lo mínimo; la ficha completa lo reemplaza. */
const placeholderEntry = (entryId: number): WorkshopEntry => ({
  id: entryId, code: `ING-${String(entryId).padStart(5, "0")}`, title: null, statusKey: null, statusColor: null, subStatusName: null, equipmentLabel: "Cargando…",
  equipmentCode: null, customerName: null, isInternalEntry: false, daysInArea: 0, estimatedDeliveryAt: null, isReceptionPending: true, negotiationsCount: 0, imageUrl: null
});
const placeholderArea = (areaId: number | null, title: string | null): WorkshopArea => ({ id: areaId ?? 1, title: title ?? "", maxSlots: 0, occupiedSlots: 0, hasUnlimitedSlots: true, entries: [] });

/**
 * Pestaña Taller: tablero y, encima, la ficha del ingreso, el formulario, la inspección o la firma. El tablero queda
 * montado (oculto) para conservar el desplazamiento, la búsqueda y el filtro. Lo abierto se recuerda mientras se usa la
 * ficha normal de un trabajo (cronómetro, archivos…) para volver al mismo ingreso. Avisa a la app cuándo hay algo
 * abierto para que el botón atrás del teléfono lo cierre y no cambie de pestaña.
 */
export function WorkshopScreen({ workshop, onSectionChange, onOpenWork, creation, memory, memoryKey, query, assignments, onLocationHistory, mode = "live", detailQuery = "", onViewChange }: {
  /** Búsqueda del encabezado dentro del ingreso o la OT abierta. */
  detailQuery?: string; onViewChange?: (kind: string | null) => void;
  onLocationHistory?: () => void; mode?: "live" | "demo";
  /** Datos de Mi jornada: los trabajos de una OT que estén ahí se muestran con la misma tarjeta (iniciar, entregar, archivos…). */
  assignments?: WorkshopAssignments;
  workshop: WorkshopModel; onSectionChange?: (open: boolean) => void; onOpenWork: (workId: number, options?: WorkOpenOptions) => Promise<string | null>;
  creation?: WorkshopCreation; memory: MutableRefObject<{ key: string; view: unknown } | null>; memoryKey: string; query?: string;
}) {
  const [view, setView] = useState<Opened | null>(() => memory.current?.key === memoryKey ? memory.current.view as Opened | null : null);
  const can = { inspections: useAppPermission("workshopInspections"), reception: useAppPermission("workshopReception") };
  useEffect(() => { memory.current = { key: memoryKey, view }; }, [view, memoryKey]);
  /** Ingreso recién terminado: se celebra y se muestra el correo al cliente antes de dejar la ficha a la vista. */
  const [receptionDone, setReceptionDone] = useState<WorkshopEntry | null>(null);
  useEffect(() => { onSectionChange?.(view !== null); }, [view !== null]);
  useEffect(() => { onViewChange?.(view?.kind ?? null); }, [view?.kind]);
  useEffect(() => () => { onSectionChange?.(false); }, []);
  // Otro taller: lo abierto ya no corresponde (no al volver de la ficha de un trabajo).
  const workshopId = useRef(workshop.workshopId);
  useEffect(() => {
    if (workshopId.current !== null && workshop.workshopId !== null && workshopId.current !== workshop.workshopId) setView(null);
    if (workshop.workshopId !== null) workshopId.current = workshop.workshopId;
  }, [workshop.workshopId]);

  // Asignaciones amplias (±15 días) para la tarjeta completa de los trabajos del ingreso o la OT abierta.
  const [wide, setWide] = useState<AssignmentData | null>(null);
  const wideRequest = useRef(0);
  const reloadWide = () => {
    if (!assignments?.loadWide) return;
    const request = ++wideRequest.current;
    assignments.loadWide().then((data) => { if (request === wideRequest.current) setWide(data); }, () => undefined);
  };
  const openedEntry = view && "ref" in view ? view.ref.entry.id : null;
  useEffect(() => { if (view?.kind === "entry" || view?.kind === "order") reloadWide(); }, [view?.kind, openedEntry, assignments?.data?.generatedAt]);

  const [workLayout, setWorkLayoutState] = useState<WorkLayout>("extended");
  useEffect(() => {
    AsyncStorage.getItem(WORK_LAYOUT_KEY).then((saved) => { if (saved === "compact" || saved === "extended") setWorkLayoutState(saved); }, () => undefined);
  }, []);
  const setWorkLayout = (layout: WorkLayout) => { setWorkLayoutState(layout); void AsyncStorage.setItem(WORK_LAYOUT_KEY, layout).catch(() => undefined); };

  /** Tarjeta de Mi jornada del trabajo: con los días cargados en Mi jornada o, si no está ahí, con las asignaciones amplias. */
  function assignmentCard(workId: number): ReactNode | null {
    if (!assignments) return null;
    const data = assignments.data;
    for (const group of data?.groups ?? []) {
      const work = group.works.find((item) => item.id === String(workId));
      if (!work || !data) continue;
      return <AssignmentWorkCard key={JSON.stringify([group.id, work.id])} group={group} work={work} currentWorkerId={assignments.workerId}
        manualHours={data.technician.showWorkTimer === false && data.technician.allowEditExecutionTime}
        queryDate={assignmentWorkQueryRange(work, assignments.range).startDate} companyBranchId={assignments.companyBranchId ?? undefined}
        onOpenWork={assignments.openWork} onWorkStatus={assignments.onWorkStatus} busy={assignments.busy} generatedAt={data.generatedAt}
        offline={assignments.offline} online={assignments.offline?.online ?? true} />;
    }
    for (const group of wide?.groups ?? []) {
      const work = group.works.find((item) => item.id === String(workId));
      if (!work || !wide || !assignments.wideStatus) continue;
      const wideStatus = assignments.wideStatus;
      return <AssignmentWorkCard key={JSON.stringify(["wide", group.id, work.id])} group={group} work={work} currentWorkerId={assignments.workerId}
        manualHours={wide.technician.showWorkTimer === false && wide.technician.allowEditExecutionTime}
        companyBranchId={assignments.companyBranchId ?? undefined} busy={assignments.busy} generatedAt={wide.generatedAt}
        offline={assignments.offline} online={assignments.offline?.online ?? true}
        // Fuera de los días de Mi jornada se abre como desde el Taller (busca el día del trabajo) y el estado se cambia en su día.
        onOpenWork={(_group, selected, options) => {
          void onOpenWork(Number(selected.id), options).then((problem) => {
            if (problem) setView((current) => current?.kind === "entry" || current?.kind === "order" ? { ...current, notice: problem } : current);
          });
        }}
        onWorkStatus={async (selectedGroup, selected, input) => { await wideStatus(selectedGroup, selected, input); reloadWide(); }} />;
    }
    return null;
  }

  // Trabajos creados desde una OT: su unión a la OT (el aviso si falló), para no unirlos dos veces.
  const orderLinks = useRef(new Map<number, Promise<string | undefined>>());
  const linkToOrder = (entryId: number, orderId: number, workId: number): Promise<string | undefined> =>
    workshop.orders.addWorks(entryId, orderId, [workId]).then(() => undefined,
      (failure: unknown) => `El trabajo se creó en el ingreso, pero no se pudo unir a la OT: ${failure instanceof Error ? failure.message : "revisa tu conexión"}. Únelo con «Unir trabajos sueltos».`);
  const showEntry = (ref: EntryRef) => { void workshop.refresh(); setView({ kind: "entry", ref, revision: Date.now() }); };
  // Ingreso sin terminar: se abre directo el paso que falta (inspección o firma); al terminar se ve la ficha.
  const openEntry = (entry: WorkshopEntry, area: WorkshopArea) => setView(entry.isReceptionPending && can.reception
    ? { kind: "resume", ref: { entry, area } } : { kind: "entry", ref: { entry, area }, revision: 0 });
  const resumeRef = view?.kind === "resume" ? view.ref : null;
  useEffect(() => {
    if (!resumeRef) return;
    let active = true;
    workshop.loadEntry(resumeRef.entry.id).then((detail) => {
      if (!active) return;
      if (detail.reception.signed || detail.delivery) { showEntry(resumeRef); return; }
      const inspected = detail.inspections.available && evaluateInspection(detail.inspections.entryRequirement, detail.inspections.entry, detail.inspections.photoSlots).met;
      if (!inspected && can.inspections) setView({ kind: "inspection", ref: resumeRef, inspection: "entry", next: "reception" });
      else setView({ kind: "reception", ref: resumeRef });
    }, () => { if (active) showEntry(resumeRef); });
    return () => { active = false; };
  }, [resumeRef?.entry.id]);
  const newEntry = (area: WorkshopArea | null) => setView({ kind: "intake", entryId: null, areaId: area?.id ?? null, areaTitle: area?.title ?? null, back: null, thenInspection: true });

  return <View style={styles.screen}>
    <View style={[styles.screen, view !== null && styles.hidden]}>
      <WorkshopBoardScreen workshop={workshop} onOpenEntry={openEntry} onNewEntry={newEntry} query={query} />
    </View>
    {view?.kind === "files" ? (() => {
      const api = workshop.drive.entry(view.ref.entry.id);
      return api ? <FileDrive key={view.ref.entry.id} api={api} title="Archivos del ingreso" subtitle={view.ref.entry.code} onClose={() => showEntry(view.ref)} /> : null;
    })() : null}
    {view?.kind === "comments" ? (() => {
      const api = workshop.threads.entry(view.ref.entry.id);
      return api ? <ChatThread key={view.ref.entry.id} api={api} title="Comentarios del ingreso" subtitle={view.ref.entry.code} onClose={() => showEntry(view.ref)} draftKey={`${memoryKey}:entry:${view.ref.entry.id}`} /> : null;
    })() : null}
    {view?.kind === "resume" ? <View style={styles.resume}>
      <ActivityIndicator color={palette.primary} />
      <Text style={styles.resumeText}>Abriendo lo que falta del ingreso {view.ref.entry.code}…</Text>
    </View> : null}
    {view?.kind === "entry" ? <WorkshopEntryScreen query={detailQuery} key={`${view.ref.entry.id}:${view.revision}`} entry={view.ref.entry} area={view.ref.area} load={workshop.loadEntry}
      initialNotice={view.notice}
      onBack={() => { setView(null); void workshop.refresh(); }}
      onEditIntake={(areaId, areaTitle, pending) => setView({ kind: "intake", entryId: view.ref.entry.id, areaId, areaTitle, back: view.ref, thenInspection: pending })}
      onOpenInspection={(inspection) => setView({ kind: "inspection", ref: view.ref, inspection, next: null })}
      onSign={() => setView({ kind: "reception", ref: view.ref })} works={workshop.works} orders={workshop.orders} onOpenWork={onOpenWork}
      manage={workshop.manage} workshopId={workshop.workshopId}
      onDeliver={() => setView({ kind: "delivery", ref: view.ref })}
      onOpenFiles={workshop.drive.available ? () => setView({ kind: "files", ref: view.ref }) : undefined}
      onOpenComments={workshop.threads.available ? () => setView({ kind: "comments", ref: view.ref }) : undefined}
      emails={workshop.emails.available ? workshop.emails : undefined} emailContacts={workshop.intake}
      orderDrive={workshop.drive.available ? (orderId) => workshop.drive.order(view.ref.entry.id, orderId) : undefined}
      orderThread={workshop.threads.available ? (orderId) => workshop.threads.order(view.ref.entry.id, orderId) : undefined}
      workCard={assignmentCard} workLayout={workLayout} onWorkLayout={setWorkLayout}
      rememberedTab={(entryId) => rememberedTabs.get(`entry:${entryId}`)} onTabChange={(entryId, tab) => rememberedTabs.set(`entry:${entryId}`, tab)}
      onOpenOrder={(orderId, entryCode) => setView({ kind: "order", ref: view.ref, orderId, entryCode })}
      onAddWork={creation ? (code, equipmentLabel) => setView({ kind: "create-work", ref: view.ref, code, equipmentLabel }) : undefined}
      onAddMaintenance={creation ? (code, equipmentLabel) => setView({ kind: "create-work", ref: view.ref, code, equipmentLabel, creating: "maintenance" }) : undefined} /> : null}
    {view?.kind === "create-work" && creation ? <CreationScreen kind={view.creating ?? "work"} {...creation} data={null} parentEntry={{ id: view.ref.entry.id, code: view.code, equipmentLabel: view.equipmentLabel }}
      onBack={() => view.order ? setView({ kind: "order", ref: view.ref, ...view.order }) : showEntry(view.ref)}
      successFlow={view.order ? {
        // Trabajo nuevo desde la OT: al confirmar se une a la OT; luego se elige volver a la OT o crear otro.
        viewLabel: "Ver trabajos de la OT", subtitle: `Quedó en la OT del ingreso ${view.code} y asignado a ti.`,
        onConfirmed: (result) => {
          workshop.works.noteCreated(view.ref.entry.id, result.workId); assignments?.refresh?.();
          orderLinks.current.set(result.workId, linkToOrder(view.ref.entry.id, view.order!.orderId, result.workId));
        },
        onView: (result) => { const ref = view.ref; const order = view.order!; void (orderLinks.current.get(result.workId) ?? Promise.resolve(undefined)).then((notice) => setView({ kind: "order", ref, ...order, notice })); }
      } : {
        viewLabel: view.creating === "maintenance" ? "Ver mantenimientos del ingreso" : "Ver trabajos del ingreso",
        onConfirmed: (result) => { workshop.works.noteCreated(view.ref.entry.id, result.workId); assignments?.refresh?.(); },
        onView: () => showEntry(view.ref)
      }}
      onCreated={async (result) => {
        workshop.works.noteCreated(view.ref.entry.id, result.workId);
        assignments?.refresh?.();
        const ref = view.ref;
        if (view.order) {
          // Abrir el trabajo creado desde la OT: se espera a que quede unido a la OT y se abre su ficha.
          const order = view.order;
          const notice = await (orderLinks.current.get(result.workId) ?? linkToOrder(ref.entry.id, order.orderId, result.workId));
          setView({ kind: "order", ref, ...order, notice });
          const problem = await onOpenWork(result.workId);
          if (problem) setView({ kind: "order", ref, ...order, notice: problem });
          return;
        }
        showEntry(ref);
        // Igual que al crear desde Mi jornada: se abre la ficha del trabajo recién creado. Si no se puede, se avisa en la ficha.
        const problem = await onOpenWork(result.workId);
        if (problem) setView({ kind: "entry", ref, revision: Date.now(), notice: `${view.creating === "maintenance" ? "El mantenimiento" : "El trabajo"} se creó, pero no se pudo abrir: ${problem}` });
      }} /> : null}
    {view?.kind === "order" ? <WorkshopOrderScreen query={detailQuery} key={view.orderId} initialSection={rememberedTabs.get(`order:${view.orderId}`) as Section | undefined}
      onSectionChange={(section) => rememberedTabs.set(`order:${view.orderId}`, section)} workCard={assignmentCard} workLayout={workLayout} onWorkLayout={setWorkLayout} entryCode={view.entryCode} load={() => workshop.orders.detail(view.ref.entry.id, view.orderId)}
      onClose={() => showEntry(view.ref)} onOpenWork={(workId) => {
        // Igual que desde la ficha: la ficha normal del trabajo; si no se puede abrir, se avisa en la OT.
        void onOpenWork(workId).then((problem) => { if (problem) setView({ ...view, notice: problem }); });
      }} notice={view.notice} onSaveGeneral={(input) => workshop.orders.updateGeneral(view.ref.entry.id, view.orderId, input)}
      onNewWork={creation && !view.ref.entry.isInternalEntry ? (equipmentLabel) => setView({ kind: "create-work", ref: view.ref, code: view.entryCode, equipmentLabel,
        order: { orderId: view.orderId, entryCode: view.entryCode } }) : undefined}
      looseWorks={view.ref.entry.isInternalEntry ? undefined : () => workshop.loadEntry(view.ref.entry.id).then((entry) => entry.works.items.filter((work) => work.loose))}
      onLinkWorks={(workIds) => workshop.orders.addWorks(view.ref.entry.id, view.orderId, workIds).then((result) => { assignments?.refresh?.(); return result.linked; })}
      items={{
        products: workshop.orders.products, transports: workshop.orders.transports,
        add: (input) => workshop.orders.addItem(view.ref.entry.id, view.orderId, input),
        update: (section, rowId, quantity, note) => workshop.orders.updateItem(view.ref.entry.id, view.orderId, section, rowId, quantity, note),
        remove: (section, rowId) => workshop.orders.removeItem(view.ref.entry.id, view.orderId, section, rowId)
      }}
      files={{
        load: () => workshop.orders.files(view.ref.entry.id, view.orderId), upload: (files) => workshop.orders.uploadFiles(view.ref.entry.id, view.orderId, files),
        remove: (fileId) => workshop.orders.deleteFile(view.ref.entry.id, view.orderId, fileId), mode, scopeKey: memoryKey,
        drive: workshop.drive.order(view.ref.entry.id, view.orderId)
      }}
      comments={workshop.threads.order(view.ref.entry.id, view.orderId)}
      onLocationHistory={onLocationHistory} workProgress={(workIds) => assignmentProgress([assignments?.data, wide], workIds)}
      onSend={view.ref.entry.isInternalEntry ? undefined : () => workshop.orders.send(view.ref.entry.id, view.orderId).then(() => { assignments?.refresh?.(); })} /> : null}
    {view?.kind === "intake" ?<WorkshopIntakeScreen key={view.entryId ?? "new"} intake={workshop.intake} workshopId={workshop.workshopId} entryId={view.entryId}
      areaId={view.areaId} areaTitle={view.areaTitle}
      onClose={() => view.back ? showEntry(view.back) : setView(null)}
      onSaved={(entryId, next) => {
        const ref = view.back ?? { entry: placeholderEntry(entryId), area: placeholderArea(view.areaId, view.areaTitle) };
        void workshop.refresh();
        // Igual que la web: después de los datos sigue la inspección de ingreso y, si falta, la firma.
        if (next) setView({ kind: "inspection", ref, inspection: "entry", next: view.thenInspection ? "reception" : null }); else showEntry(ref);
      }}
      onContinue={view.back ? (entryId) => setView({ kind: "inspection", ref: view.back ?? { entry: placeholderEntry(entryId), area: placeholderArea(view.areaId, view.areaTitle) },
        inspection: "entry", next: view.thenInspection ? "reception" : null }) : undefined} /> : null}
    {view?.kind === "inspection" ? <WorkshopInspectionScreen key={`${view.ref.entry.id}:${view.inspection}`} api={workshop.inspection} entryId={view.ref.entry.id} kind={view.inspection}
      onClose={() => view.next === "delivery" ? setView({ kind: "delivery", ref: view.ref }) : showEntry(view.ref)}
      onDone={() => view.next === "reception" ? setView({ kind: "reception", ref: view.ref }) : view.next === "delivery" ? setView({ kind: "delivery", ref: view.ref }) : showEntry(view.ref)} /> : null}
    {view?.kind === "delivery" ? <WorkshopDeliveryScreen key={view.ref.entry.id} workshop={workshop} entryId={view.ref.entry.id}
      onClose={() => showEntry(view.ref)} onGoEntry={() => showEntry(view.ref)} onGoBoard={() => { setView(null); void workshop.refresh(); }}
      onExitInspection={() => setView({ kind: "inspection", ref: view.ref, inspection: "exit", next: "delivery" })} /> : null}
    {view?.kind === "reception" ? <WorkshopReceptionScreen key={view.ref.entry.id} api={workshop.reception} load={workshop.loadEntry} entryId={view.ref.entry.id}
      onClose={() => showEntry(view.ref)} onDone={() => { showEntry(view.ref); setReceptionDone(view.ref.entry); }}
      onOpenInspection={() => setView({ kind: "inspection", ref: view.ref, inspection: "entry", next: "reception" })} /> : null}
    {/* Al terminar la recepción: «¡Ingreso realizado!» con el correo al cliente (automático o para enviarlo). */}
    {receptionDone ? <ReceptionDoneModal api={workshop.emails} contacts={workshop.intake} entryId={receptionDone.id} entryCode={receptionDone.code}
      equipmentLabel={receptionDone.equipmentLabel !== "Cargando…" ? receptionDone.equipmentLabel : null} onClose={() => setReceptionDone(null)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hidden: { display: "none" },
  resume: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, backgroundColor: palette.background },
  resumeText: { fontSize: 14, color: palette.textSecondary, textAlign: "center" }
});

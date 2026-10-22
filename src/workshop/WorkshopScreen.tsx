import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { StyleSheet, View } from "react-native";
import type { WorkshopArea, WorkshopEntry } from "../domain/workshopBoard";
import type { InspectionKind } from "../domain/workshopInspection";
import { CreationScreen, type CreationScreenProps } from "../screens/creation/CreationScreen";
import type { useWorkshopBoard } from "./useWorkshopBoard";
import { WorkshopBoardScreen } from "./WorkshopBoardScreen";
import { WorkshopEntryScreen } from "./WorkshopEntryScreen";
import { WorkshopIntakeScreen } from "./intake/WorkshopIntakeScreen";
import { WorkshopInspectionScreen } from "./inspection/WorkshopInspectionScreen";
import { WorkshopReceptionScreen } from "./reception/WorkshopReceptionScreen";
import { WorkshopDeliveryScreen } from "./delivery/WorkshopDeliveryScreen";

type WorkshopModel = ReturnType<typeof useWorkshopBoard>;
interface EntryRef { entry: WorkshopEntry; area: WorkshopArea }
type Opened =
  | { kind: "entry"; ref: EntryRef; revision: number; notice?: string }
  | { kind: "intake"; entryId: number | null; areaId: number | null; areaTitle: string | null; back: EntryRef | null; thenInspection: boolean }
  | { kind: "inspection"; ref: EntryRef; inspection: InspectionKind; next: "reception" | "delivery" | null }
  | { kind: "reception"; ref: EntryRef }
  | { kind: "delivery"; ref: EntryRef }
  | { kind: "create-work"; ref: EntryRef; code: string; equipmentLabel: string; creating?: "work" | "maintenance" };

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
export function WorkshopScreen({ workshop, onSectionChange, onOpenWork, creation, memory, memoryKey, query }: {
  workshop: WorkshopModel; onSectionChange?: (open: boolean) => void; onOpenWork: (workId: number) => Promise<string | null>;
  creation?: WorkshopCreation; memory: MutableRefObject<{ key: string; view: unknown } | null>; memoryKey: string; query?: string;
}) {
  const [view, setView] = useState<Opened | null>(() => memory.current?.key === memoryKey ? memory.current.view as Opened | null : null);
  useEffect(() => { memory.current = { key: memoryKey, view }; }, [view, memoryKey]);
  useEffect(() => { onSectionChange?.(view !== null); }, [view !== null]);
  useEffect(() => () => { onSectionChange?.(false); }, []);
  // Otro taller: lo abierto ya no corresponde (no al volver de la ficha de un trabajo).
  const workshopId = useRef(workshop.workshopId);
  useEffect(() => {
    if (workshopId.current !== null && workshop.workshopId !== null && workshopId.current !== workshop.workshopId) setView(null);
    if (workshop.workshopId !== null) workshopId.current = workshop.workshopId;
  }, [workshop.workshopId]);

  const showEntry = (ref: EntryRef) => { void workshop.refresh(); setView({ kind: "entry", ref, revision: Date.now() }); };
  const newEntry = (area: WorkshopArea | null) => setView({ kind: "intake", entryId: null, areaId: area?.id ?? null, areaTitle: area?.title ?? null, back: null, thenInspection: true });

  return <View style={styles.screen}>
    <View style={[styles.screen, view !== null && styles.hidden]}>
      <WorkshopBoardScreen workshop={workshop} onOpenEntry={(entry, area) => setView({ kind: "entry", ref: { entry, area }, revision: 0 })} onNewEntry={newEntry} query={query} />
    </View>
    {view?.kind === "entry" ? <WorkshopEntryScreen key={`${view.ref.entry.id}:${view.revision}`} entry={view.ref.entry} area={view.ref.area} load={workshop.loadEntry}
      initialNotice={view.notice}
      onBack={() => { setView(null); void workshop.refresh(); }}
      onEditIntake={(areaId, areaTitle, pending) => setView({ kind: "intake", entryId: view.ref.entry.id, areaId, areaTitle, back: view.ref, thenInspection: pending })}
      onOpenInspection={(inspection) => setView({ kind: "inspection", ref: view.ref, inspection, next: null })}
      onSign={() => setView({ kind: "reception", ref: view.ref })} works={workshop.works} orders={workshop.orders} onOpenWork={onOpenWork}
      manage={workshop.manage} workshopId={workshop.workshopId}
      onDeliver={() => setView({ kind: "delivery", ref: view.ref })}
      onAddWork={creation ? (code, equipmentLabel) => setView({ kind: "create-work", ref: view.ref, code, equipmentLabel }) : undefined}
      onAddMaintenance={creation ? (code, equipmentLabel) => setView({ kind: "create-work", ref: view.ref, code, equipmentLabel, creating: "maintenance" }) : undefined} /> : null}
    {view?.kind === "create-work" && creation ? <CreationScreen kind={view.creating ?? "work"} {...creation} data={null} parentEntry={{ id: view.ref.entry.id, code: view.code, equipmentLabel: view.equipmentLabel }}
      onBack={() => showEntry(view.ref)}
      onCreated={async (result) => {
        workshop.works.noteCreated(view.ref.entry.id, result.workId);
        const ref = view.ref;
        showEntry(ref);
        // Igual que al crear desde Mi jornada: se abre la ficha del trabajo recién creado. Si no se puede, se avisa en la ficha.
        const problem = await onOpenWork(result.workId);
        if (problem) setView({ kind: "entry", ref, revision: Date.now(), notice: `${view.creating === "maintenance" ? "El mantenimiento" : "El trabajo"} se creó, pero no se pudo abrir: ${problem}` });
      }} /> : null}
    {view?.kind === "intake" ? <WorkshopIntakeScreen key={view.entryId ?? "new"} intake={workshop.intake} workshopId={workshop.workshopId} entryId={view.entryId}
      areaId={view.areaId} areaTitle={view.areaTitle}
      onClose={() => view.back ? showEntry(view.back) : setView(null)}
      onSaved={(entryId) => {
        const ref = view.back ?? { entry: placeholderEntry(entryId), area: placeholderArea(view.areaId, view.areaTitle) };
        void workshop.refresh();
        // Igual que la web: después de los datos sigue la inspección de ingreso.
        if (view.thenInspection) setView({ kind: "inspection", ref, inspection: "entry", next: "reception" }); else showEntry(ref);
      }} /> : null}
    {view?.kind === "inspection" ? <WorkshopInspectionScreen key={`${view.ref.entry.id}:${view.inspection}`} api={workshop.inspection} entryId={view.ref.entry.id} kind={view.inspection}
      onClose={() => view.next === "delivery" ? setView({ kind: "delivery", ref: view.ref }) : showEntry(view.ref)}
      onDone={() => view.next === "reception" ? setView({ kind: "reception", ref: view.ref }) : view.next === "delivery" ? setView({ kind: "delivery", ref: view.ref }) : showEntry(view.ref)} /> : null}
    {view?.kind === "delivery" ? <WorkshopDeliveryScreen key={view.ref.entry.id} workshop={workshop} entryId={view.ref.entry.id}
      onClose={() => showEntry(view.ref)} onGoEntry={() => showEntry(view.ref)} onGoBoard={() => { setView(null); void workshop.refresh(); }}
      onExitInspection={() => setView({ kind: "inspection", ref: view.ref, inspection: "exit", next: "delivery" })} /> : null}
    {view?.kind === "reception" ? <WorkshopReceptionScreen key={view.ref.entry.id} api={workshop.reception} load={workshop.loadEntry} entryId={view.ref.entry.id}
      onClose={() => showEntry(view.ref)} onDone={() => showEntry(view.ref)}
      onOpenInspection={() => setView({ kind: "inspection", ref: view.ref, inspection: "entry", next: "reception" })} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hidden: { display: "none" }
});

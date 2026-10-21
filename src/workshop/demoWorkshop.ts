import type { WorkshopBoard, WorkshopBoardPort, WorkshopEntry, WorkshopList } from "../domain/workshopBoard";

/** Taller de ejemplo para el modo demostración: vive en memoria y nunca llega a Qualitzer. */
export function createDemoWorkshopPort(now: Date = new Date()): WorkshopBoardPort {
  const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const entry = (value: Partial<WorkshopEntry> & Pick<WorkshopEntry, "id" | "equipmentLabel">): WorkshopEntry => ({
    code: `ING-${String(value.id).padStart(5, "0")}`, title: null, statusKey: "IN_PROGRESS", statusColor: "#8E44AD", subStatusName: null,
    equipmentCode: null, customerName: null, isInternalEntry: false, daysInArea: 0, estimatedDeliveryAt: null, isReceptionPending: false,
    negotiationsCount: 0, imageUrl: null, ...value
  });
  const workshops: WorkshopList = { items: [{ id: 1, name: "Taller Cristian Meza" }, { id: 2, name: "Taller Faena Norte" }] };
  const boards: Record<number, WorkshopBoard> = {
    1: { workshopId: 1, areas: [
      { id: 3, title: "Patio", maxSlots: 4, occupiedSlots: 2, hasUnlimitedSlots: false, entries: [
        entry({ id: 5, title: "Reparación de emergencia a tractor", equipmentLabel: "CLARKE · BOMBA · DQ6HUFAA60", equipmentCode: "416545",
          customerName: "Centro de Estudios Reproductivos", daysInArea: 4, estimatedDeliveryAt: inDays(38), negotiationsCount: 2 }),
        entry({ id: 6, title: "Mantención preventiva", equipmentLabel: "MAXUS · CAMIONETA · T 60", equipmentCode: "MTTO 3",
          isInternalEntry: true, statusKey: "PENDING", statusColor: "#3498DB", isReceptionPending: true })
      ] },
      { id: 2, title: "Bombas", maxSlots: 3, occupiedSlots: 1, hasUnlimitedSlots: false, entries: [
        entry({ id: 3, title: "Cambio de sellos", equipmentLabel: "CAT · RETROEXCAVADORA · 420", equipmentCode: "HLYV-201",
          customerName: "Constructora DLB SpA", statusKey: "COMPLETED", statusColor: "#E67E22", daysInArea: 12, estimatedDeliveryAt: inDays(-2), negotiationsCount: 1 })
      ] },
      { id: 4, title: "Motores", maxSlots: 2, occupiedSlots: 0, hasUnlimitedSlots: false, entries: [] }
    ] },
    2: { workshopId: 2, areas: [
      { id: 10, title: "Nave 1", maxSlots: 0, occupiedSlots: 1, hasUnlimitedSlots: true, entries: [
        entry({ id: 31, title: "Ingreso a taller reparación", equipmentLabel: "CLARKE · MOTOR · JU4H-UF14", equipmentCode: "123456",
          customerName: "3M Chile S.A.", statusKey: "UNDER_REVIEW", statusColor: "#F1C40F", daysInArea: 1, estimatedDeliveryAt: inDays(10) })
      ] }
    ] }
  };
  return {
    async workshops() { return workshops; },
    async workshopBoard(_branchId: number, workshopId: number) { return boards[workshopId] ?? { workshopId, areas: [] }; }
  };
}

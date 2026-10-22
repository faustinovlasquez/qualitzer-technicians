import { workshopAreaHasRoom, type WorkshopArea, type WorkshopBoard, type WorkshopBoardPort, type WorkshopEntry, type WorkshopList } from "../domain/workshopBoard";
import type { WorkshopEntryDetail, WorkshopEntryPort, WorkshopOrder, WorkshopWork } from "../domain/workshopEntry";
import type { WorkshopCustomerDetail, WorkshopEquipmentOption, WorkshopEquipmentQuery, WorkshopImageInput, WorkshopIntakeForm, WorkshopIntakeInput, WorkshopIntakePort } from "../domain/workshopIntake";
import { CUSTOM_SLOT_KEY, isInspectionStepCompleted, type InspectionStep, type WorkshopInspectionPort, type WorkshopInspectionState } from "../domain/workshopInspection";

import { shouldMoveToStatus, type WorkshopReceptionPort, type WorkshopWorker } from "../domain/workshopReception";
import { evaluateInspection } from "../domain/workshopEntry";

import type { WorkshopWorksPort } from "../domain/workshopWorks";
import type { WorkshopOrdersPort } from "../domain/workshopOrders";
import { deliveryBlockers, type WorkshopDeliveryPort } from "../domain/workshopDelivery";
import type { WorkshopManagePort } from "../domain/workshopManage";
import { formatRut, isValidRut, type WorkshopCustomersPort } from "../domain/workshopCustomers";

export type DemoWorkshopPort = WorkshopBoardPort & WorkshopEntryPort & WorkshopIntakePort & WorkshopInspectionPort & WorkshopReceptionPort & WorkshopWorksPort & WorkshopOrdersPort & WorkshopDeliveryPort & WorkshopManagePort & WorkshopCustomersPort;
const structuredCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Taller de ejemplo para el modo demostración: vive en memoria y nunca llega a Qualitzer. */
export function createDemoWorkshopPort(now: Date = new Date()): DemoWorkshopPort {
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
  const order = (value: Partial<WorkshopOrder> & Pick<WorkshopOrder, "id" | "code">): WorkshopOrder => ({
    kind: "quote", workOrderCode: null, title: null, statusLabel: "Pendiente", stage: "draft", sentToCommercial: true, quoted: false, finished: false, ...value
  });
  const work = (value: Partial<WorkshopWork> & Pick<WorkshopWork, "id" | "title">): WorkshopWork => ({
    code: `TR-${String(value.id).padStart(5, "0")}`, priority: "medium", statusName: "En proceso", statusColor: "#2D9CDB", progress: 0, finished: false,
    orderId: null, maintenanceCode: null, loose: false, ...value
  });
  const slots = [{ key: "front", name: "Frente", isRequired: true }, { key: "back", name: "Atrás", isRequired: true }, { key: "plate", name: "Placa", isRequired: false }];
  const inspection = (percentage: number, photoTypes: string[], checklistCompleted: number) => ({
    id: 900 + percentage, percentage, photoTypes, photosCount: photoTypes.length, checklistTotal: 6, checklistCompleted, completedAt: null
  });
  /** Contenido de la ficha por ingreso: un caso listo para entregar, uno con pendientes y uno sin terminar. */
  const extras: Record<number, Pick<WorkshopEntryDetail, "notes" | "reception" | "inspections" | "works" | "orders">> = {
    5: {
      notes: "Ingresa con fuga de aceite en el sello principal.",
      reception: { signed: true, receiverName: "Pedro Soto", signedAt: inDays(-4) },
      inspections: { available: true, entryRequirement: "full", exitRequirement: "photos", entry: inspection(100, ["front", "back"], 6), exit: null, photoSlots: slots },
      works: { available: true, items: [
        work({ id: 41, title: "Cambio de sello principal", priority: "high", progress: 60, orderId: 81 }),
        work({ id: 42, title: "Prueba de presión", statusName: "Por hacer", statusColor: "#95A5A6", loose: true })
      ] },
      orders: { available: true, items: [
        order({ id: 81, code: "COT-PRO-0042", title: "Reparación de bomba", statusLabel: "Aprobada", stage: "approved", quoted: true }),
        order({ id: 82, kind: "workOrder", code: "OT-00012", workOrderCode: "OT-00012", title: "Repuestos adicionales", statusLabel: "Sin enviar a comercial", sentToCommercial: false })
      ] }
    },
    6: {
      notes: null,
      reception: { signed: false, receiverName: null, signedAt: null },
      inspections: { available: true, entryRequirement: "photos", exitRequirement: "none", entry: inspection(50, ["front"], 0), exit: null, photoSlots: slots },
      works: { available: true, items: [] },
      orders: { available: true, items: [] }
    },
    3: {
      notes: "Cliente pide entrega con informe.",
      reception: { signed: true, receiverName: "Ana Rojas", signedAt: inDays(-12) },
      inspections: { available: true, entryRequirement: "none", exitRequirement: "none", entry: null, exit: null, photoSlots: slots },
      works: { available: true, items: [work({ id: 30, title: "Cambio de sellos hidráulicos", statusName: "Terminado", statusColor: "#27AE60", progress: 100, finished: true, orderId: 70 })] },
      orders: { available: true, items: [order({ id: 70, code: "COT-SER-0031", title: "Cambio de sellos", statusLabel: "Aprobada", stage: "approved", quoted: true, finished: true })] }
    }
  };
  /** Equipos entregados: salen de la nave pero su ficha sigue disponible como "Entregado". */
  const delivered: Record<number, { entry: WorkshopEntry; area: WorkshopArea; at: string; to: string; note: string | null }> = {};
  const detailOf = (entryId: number): WorkshopEntryDetail => {
    const places = Object.values(boards).flatMap((board) => board.areas.map((area) => ({ area, entries: area.entries })));
    const departed = delivered[entryId];
    if (departed) places.unshift({ area: departed.area, entries: [departed.entry] });
    for (const { area, entries } of places) {
      const found = entries.find((item) => item.id === entryId);
      if (!found) continue;
      const extra = extras[entryId] ?? {
        notes: null, reception: { signed: true, receiverName: "Luis Mena", signedAt: inDays(-1) },
        inspections: { available: true, entryRequirement: "none", exitRequirement: "none", entry: null, exit: null, photoSlots: slots },
        works: { available: true, items: [] },
        orders: { available: true, items: [order({ id: 90, code: "COT-SER-0050", title: "Diagnóstico de motor", statusLabel: "En revisión", stage: "review" })] }
      };
      return {
        id: found.id, code: found.code, title: found.title, areaId: area.id, areaTitle: area.title, statusKey: found.statusKey, statusColor: found.statusColor,
        subStatusName: found.subStatusName, isInternalEntry: found.isInternalEntry, customerName: found.customerName, equipmentLabel: found.equipmentLabel,
        equipmentCode: found.equipmentCode, imageUrl: found.imageUrl, entryAt: inDays(-found.daysInArea), estimatedDeliveryAt: found.estimatedDeliveryAt,
        delivery: departed ? { at: departed.at, to: departed.to, note: departed.note } : null, ...extra
      };
    }
    throw new Error("WORKSHOP_ENTRY_NOT_FOUND");
  };
  const customers: WorkshopCustomerDetail[] = [
    { id: 1, name: "Centro de Estudios Reproductivos", contacts: [{ id: 11, fullName: "Pedro Soto", email: "psoto@cer.cl", phone: "+56 9 1111 2222", position: "Jefe de mantención" }],
      branches: [{ id: 21, name: "Casa matriz" }, { id: 22, name: "Planta Lampa" }] },
    { id: 2, name: "Constructora DLB SpA", contacts: [{ id: 12, fullName: "Ana Rojas", email: "arojas@dlb.cl", phone: null, position: "Administradora de obra" }], branches: [] },
    { id: 3, name: "3M Chile S.A.", contacts: [], branches: [{ id: 23, name: "Bodega central" }] }
  ];
  const equipment: WorkshopEquipmentOption[] = [
    { id: 101, source: "customer", label: "CLARKE · BOMBA · DQ6HUFAA60", code: "416545", typeName: "BOMBA", detail: "2020", imageUrl: null },
    { id: 102, source: "customer", label: "CAT · RETROEXCAVADORA · 420", code: "HLYV-201", typeName: "RETROEXCAVADORA", detail: "2018", imageUrl: null },
    { id: 103, source: "customer", label: "CLARKE · MOTOR · JU4H-UF14", code: "123456", typeName: "MOTOR", detail: null, imageUrl: null },
    { id: 201, source: "own", label: "MAXUS · CAMIONETA · T 60", code: "MTTO 3", typeName: "CAMIONETA", detail: "2022", imageUrl: null },
    { id: 202, source: "own", label: "HONDA · GENERADOR · EU70", code: "GEN-07", typeName: "GENERADOR", detail: null, imageUrl: null }
  ];
  const equipmentOwner: Record<number, number> = { 101: 1, 102: 2, 103: 3 };
  const forms: Record<number, WorkshopIntakeForm> = {};
  let nextId = 40;
  const findArea = (areaId: number) => {
    for (const board of Object.values(boards)) { const area = board.areas.find((item) => item.id === areaId); if (area) return area; }
    throw new Error("WORKSHOP_AREA_NOT_FOUND");
  };
  const placeEntry = (entryId: number, input: WorkshopIntakeInput, imageUrl: string | null) => {
    for (const board of Object.values(boards)) for (const area of board.areas) area.entries = area.entries.filter((item) => item.id !== entryId);
    const area = findArea(input.operationAreaId);
    const chosen = equipment.find((item) => item.id === (input.isInternalEntry ? input.rentalEquipmentId : input.customerEquipmentId));
    const customer = customers.find((item) => item.id === input.customerId);
    area.entries.push(entry({ id: entryId, title: input.title, equipmentLabel: chosen?.label ?? "Sin equipo", equipmentCode: chosen?.code ?? null,
      customerName: input.isInternalEntry ? null : customer?.name ?? null, isInternalEntry: input.isInternalEntry, statusKey: null, statusColor: null,
      isReceptionPending: true, estimatedDeliveryAt: input.estimatedDeliveryAt, imageUrl }));
    area.occupiedSlots = area.entries.length;
    forms[entryId] = {
      entryId, operationAreaId: area.id, areaTitle: area.title, title: input.title, notes: input.notes, isInternalEntry: input.isInternalEntry,
      customer: customer && !input.isInternalEntry ? { id: customer.id, name: customer.name } : null, equipment: chosen ?? null,
      branches: customer?.branches.filter((item) => input.branchIds.includes(item.id)) ?? [], contacts: customer?.contacts.filter((item) => input.contactIds.includes(item.id)) ?? [],
      entryAt: forms[entryId]?.entryAt ?? input.entryAt, estimatedDeliveryAt: forms[entryId]?.estimatedDeliveryAt ?? input.estimatedDeliveryAt, imageUrl, signed: false
    };
    extras[entryId] ??= {
      notes: input.notes, reception: { signed: false, receiverName: null, signedAt: null },
      inspections: { available: true, entryRequirement: "photos", exitRequirement: "none", entry: null, exit: null, photoSlots: slots },
      works: { available: true, items: [] }, orders: { available: true, items: [] }
    };
    extras[entryId].notes = input.notes;
  };
  const delay = () => new Promise((resolve) => setTimeout(resolve, 350));
  // Inspecciones de ejemplo: una por ingreso y tipo, con listas de revisión de muestra.
  const demoSteps = (base: number): InspectionStep[] => [
    { checklistStepId: base + 1, order: 1, title: "¿Llega con fugas de aceite?", description: null, type: "validation", options: [], isRequired: true, isFilesRequired: false, answer: null },
    { checklistStepId: base + 2, order: 2, title: "Estado general de la carcasa", description: "Si está malo, agrega una foto.", type: "select",
      options: [{ value: "bueno", label: "Bueno" }, { value: "regular", label: "Regular" }, { value: "malo", label: "Malo" }], isRequired: true, isFilesRequired: true, answer: null },
    { checklistStepId: base + 3, order: 3, title: "Accesorios que llegan", description: null, type: "multiselect",
      options: [{ value: "llaves", label: "Llaves" }, { value: "manual", label: "Manual" }, { value: "cables", label: "Cables" }], isRequired: false, isFilesRequired: false, answer: null },
    { checklistStepId: base + 4, order: 4, title: "Horómetro", description: null, type: "number", options: [], isRequired: true, isFilesRequired: false, answer: null },
    { checklistStepId: base + 5, order: 5, title: "Aprobación visual", description: null, type: "approval", options: [], isRequired: true, isFilesRequired: false, answer: null },
    { checklistStepId: base + 6, order: 6, title: "Comentarios del cliente", description: null, type: "text", options: [], isRequired: false, isFilesRequired: false, answer: null }
  ];
  const catalog = [{ id: 1, name: "Recepción de equipo" }, { id: 2, name: "Revisión eléctrica" }, { id: 3, name: "Revisión de motor" }];
  const inspections: Record<number, WorkshopInspectionState> = {};
  let nextFile = 1000;
  let nextDamage = 1;
  const inspectionOf = (inspectionId: number) => {
    const found = inspections[inspectionId];
    if (!found) throw new Error("La inspección ya no existe.");
    return found;
  };
  /** La ficha refleja el avance de la inspección de ejemplo. */
  const syncCompliance = (state: WorkshopInspectionState) => {
    const extra = extras[state.entryId];
    if (!extra) return;
    const steps = state.checklists.flatMap((checklist) => checklist.steps);
    const summary = { id: state.inspectionId, percentage: 0, photoTypes: state.slots.flatMap((slot) => slot.photo ? [slot.key] : []), photosCount: state.slots.filter((slot) => slot.photo).length,
      checklistTotal: steps.filter((step) => step.answer).length, checklistCompleted: steps.filter((step) => step.answer?.isCompleted).length, completedAt: state.completedAt };
    const total = summary.photosCount + summary.checklistTotal;
    summary.percentage = total === 0 ? 0 : Math.round(((summary.photosCount + summary.checklistCompleted) / total) * 100);
    extra.inspections = { ...extra.inspections, [state.kind]: summary };
  };
  const shareUntil: Record<number, number> = {};
  const inspectionPort: WorkshopInspectionPort = {
    async openInspection(entryId, input) {
      await delay();
      // Igual que el conector: si ya hay una (aunque esté terminada) se abre esa.
      const existing = Object.values(inspections).find((item) => item.entryId === entryId && item.kind === input.kind);
      if (existing) return structuredCopy(existing);
      const inspectionId = 300 + Object.keys(inspections).length;
      inspections[inspectionId] = { inspectionId, entryId, kind: input.kind, requirement: extras[entryId]?.inspections[input.kind === "entry" ? "entryRequirement" : "exitRequirement"] ?? "photos",
        completedAt: null, observation: null, slots: slots.map((slot) => ({ ...slot, photo: null })),
        checklists: [{ checklistId: 1, name: "Recepción de equipo", isRequired: true, locked: true, steps: demoSteps(100) }], damages: [] };
      return structuredCopy(inspections[inspectionId]);
    },
    async inspection(_entryId, inspectionId) { return structuredCopy(inspectionOf(inspectionId)); },
    async inspectionChecklistOptions() { return { items: catalog }; },
    async setInspectionChecklists(_entryId, inspectionId, input) {
      await delay();
      const state = inspectionOf(inspectionId);
      const keep = state.checklists.filter((checklist) => checklist.locked || input.checklistIds.includes(checklist.checklistId));
      for (const checklistId of input.checklistIds) {
        const found = catalog.find((item) => item.id === checklistId);
        if (found && !keep.some((checklist) => checklist.checklistId === checklistId)) keep.push({ checklistId, name: found.name, isRequired: false, locked: false, steps: demoSteps(checklistId * 100) });
      }
      state.checklists = keep;
      return structuredCopy(state);
    },
    async answerInspectionStep(_entryId, inspectionId, input) {
      await delay();
      const state = inspectionOf(inspectionId);
      const step = state.checklists.find((checklist) => checklist.checklistId === input.checklistId)?.steps.find((item) => item.checklistStepId === input.checklistStepId);
      if (!step) throw new Error("Esa pregunta ya no está en la lista.");
      const files = step.answer?.files ?? [];
      step.answer = { stepId: step.answer?.stepId ?? step.checklistStepId + 5000, responseValue: input.responseValue, comment: input.comment || null,
        isCompleted: isInspectionStepCompleted(step, input.responseValue, files.length), files };
      syncCompliance(state);
      return { id: step.answer.stepId };
    },
    async uploadInspectionPhoto(_entryId, inspectionId, slotKey, input) {
      await delay();
      const state = inspectionOf(inspectionId);
      let slot = state.slots.find((item) => item.key === slotKey);
      // Foto adicional nueva ("Agregar foto"), como en la web.
      if (!slot && CUSTOM_SLOT_KEY.test(slotKey) && input.label) {
        slot = { key: slotKey, name: input.label, isRequired: false, photo: null, custom: true, reference: null };
        state.slots.push(slot);
      }
      if (!slot) throw new Error("Ese ángulo de foto no corresponde a este equipo.");
      slot.photo = { fileId: nextFile++, url: input.image, fullUrl: input.image };
      syncCompliance(state);
      return { id: slot.photo.fileId };
    },
    async deleteInspectionPhoto(_entryId, inspectionId, slotKey) {
      const state = inspectionOf(inspectionId);
      const slot = state.slots.find((item) => item.key === slotKey);
      if (slot) slot.photo = null;
      syncCompliance(state);
      return { id: inspectionId };
    },
    async uploadInspectionStepFile(_entryId, inspectionId, stepId, input) {
      await delay();
      const state = inspectionOf(inspectionId);
      const step = state.checklists.flatMap((checklist) => checklist.steps).find((item) => item.answer?.stepId === stepId);
      if (!step?.answer) throw new Error("Responde la pregunta antes de agregarle fotos.");
      const file = { fileId: nextFile++, url: input.image };
      step.answer.files = [...step.answer.files, file];
      step.answer.isCompleted = isInspectionStepCompleted(step, step.answer.responseValue, step.answer.files.length);
      syncCompliance(state);
      return { id: file.fileId };
    },
    async deleteInspectionStepFile(_entryId, inspectionId, fileId) {
      const state = inspectionOf(inspectionId);
      for (const step of state.checklists.flatMap((checklist) => checklist.steps)) if (step.answer?.files.some((file) => file.fileId === fileId)) {
        step.answer.files = step.answer.files.filter((file) => file.fileId !== fileId);
        step.answer.isCompleted = isInspectionStepCompleted(step, step.answer.responseValue, step.answer.files.length);
      }
      syncCompliance(state);
      return { id: fileId };
    },
    async saveInspectionDamage(_entryId, inspectionId, input) {
      await delay();
      const state = inspectionOf(inspectionId);
      const damageId = input.id ?? nextDamage++;
      const photos = state.damages.find((damage) => damage.id === damageId)?.photos ?? [];
      state.damages = [...state.damages.filter((damage) => damage.id !== damageId), { id: damageId, description: input.description, severity: input.severity,
        responsibility: input.responsibility, location: input.location, isAdditional: input.isAdditional, photos }];
      return { id: damageId };
    },
    async deleteInspectionDamage(_entryId, inspectionId, damageId) {
      const state = inspectionOf(inspectionId);
      state.damages = state.damages.filter((damage) => damage.id !== damageId);
      return { id: damageId };
    },
    async uploadInspectionDamagePhoto(_entryId, inspectionId, damageId, input) {
      await delay();
      const damage = inspectionOf(inspectionId).damages.find((item) => item.id === damageId);
      if (!damage) throw new Error("El daño ya no está en esta inspección.");
      const file = { fileId: nextFile++, url: input.image };
      damage.photos = [...damage.photos, file];
      return { id: file.fileId };
    },
    async saveInspectionMeta(_entryId, inspectionId, input) {
      inspectionOf(inspectionId).observation = input.observation;
      return { id: inspectionId };
    },
    async completeInspection(_entryId, inspectionId) {
      await delay();
      const state = inspectionOf(inspectionId);
      state.completedAt = new Date().toISOString();
      syncCompliance(state);
      return { id: inspectionId };
    },
    async inspectionShare(_entryId, inspectionId) {
      const remaining = Math.max(0, Math.floor((shareUntil[inspectionId] ?? now.getTime() + 86_400_000 - 3_600_000) - Date.now()) / 1000);
      return { url: `https://demo.qualitzer.com/es/patio-preview?inspectionId=${inspectionId}&token=demo`, expiresAt: new Date(Date.now() + remaining * 1000).toISOString(),
        remainingSeconds: Math.floor(remaining), active: remaining > 0 };
    },
    async extendInspectionShare(entryId, inspectionId, branchId) {
      await delay();
      shareUntil[inspectionId] = Date.now() + 86_400_000;
      return inspectionPort.inspectionShare(entryId, inspectionId, branchId);
    },
    async downloadInspectionPhotos() {
      await delay();
      throw new Error("En la demostración no se generan comprimidos. Con una sesión real se descarga el .zip con las fotos subidas.");
    }
  };
  const workers: WorkshopWorker[] = [
    { id: 1, name: "Andrés Molina", userId: 501, email: "amolina@demo.cl", phone: "+56 9 5555 1111" },
    { id: 2, name: "Carla Fuentes", userId: null, email: null, phone: "+56 9 5555 2222" }
  ];
  // Firma de ejemplo guardada en el perfil de Andrés (una línea azul sobre blanco).
  const demoSignature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAAA8CAIAAABuCSZCAAABnElEQVR42u3bbZaEIAxE0WxktjTrn904K7CPjSSpCq9O/1RBrh+AdFxkdIImAJgATO7z8/t39wN4LG0ZM8DNutnMABfRLmwDsIfuro0BNtO92wtgD92yfQFuAC6+PlyBK8eLvbp5xqHcUl2TAy26ScZhRKvJvL1iew8Yjro6xklV2njY0NTtGjU2PpyTjhx2N4GOcXY1thw/vHR1jGsq8L6UsNMVMa4HXisoHHXbjSvLfXmaYarbaNxb4reF9gNrDlTUHhvL5Ya1bn2jN774104z3HUrjaW67g/rEPrXoIix4OD7SWViwO1bPK/UPoP2lXGM0S17BVwCeT45H5N0Czpxl1JUgK1HMu6fomPY7TtgImVvYp7uLpsBuunAOt8D7D5mAJwyahymmwvsODNgscZPAlh2YU37n4UmAGs2k+OiPkVg5WY6irYCWPOcD6FNAZ7dWKcDo2sD/HIdK8A2wAsr0dE1A/5shq7rO/hzJ/OQLujwTtaB0wIn9qLRPWKYhCvjYAIwAZgATAAmAANMACYAE4AJwARgAvCJ+Qc9zZK03Ka62AAAAABJRU5ErkJggg==";
  const receptionPort: WorkshopReceptionPort = {
    async workshopWorkers() { return { items: workers }; },
    async workshopSavedSignatures(_branchId, userId) {
      return { items: userId === 501 ? [{ id: 7, name: "Andrés Molina", email: "amolina@demo.cl", phone: "+56 9 5555 1111", image: demoSignature, isDefault: true }] : [] };
    },
    async signWorkshopReception(entryId, input) {
      await delay();
      const detail = detailOf(entryId);
      const check = evaluateInspection(detail.inspections.entryRequirement, detail.inspections.entry, detail.inspections.photoSlots);
      if (!check.met) throw new Error(`Antes de firmar completa la inspección de ingreso: ${check.missing.join(" · ")}.`);
      const extra = extras[entryId];
      if (extra) extra.reception = { signed: true, receiverName: input.name, signedAt: new Date().toISOString() };
      for (const board of Object.values(boards)) for (const area of board.areas) for (const item of area.entries) if (item.id === entryId) {
        item.isReceptionPending = false;
        if (shouldMoveToStatus(item.statusKey, "IN_PROGRESS")) { item.statusKey = "IN_PROGRESS"; item.statusColor = "#8E44AD"; }
      }
      if (forms[entryId]) forms[entryId].signed = true;
      return { id: entryId, observationSaved: true, statusUpdated: true };
    }
  };
  let freeWorks = [{ id: 701, code: "TR-00701", title: "Revisión de sistema hidráulico", statusName: "Por hacer" }, { id: 702, code: "TR-00702", title: "Cambio de filtros", statusName: null }];
  const extraOf = (entryId: number) => {
    const extra = extras[entryId];
    if (!extra) throw new Error("El ingreso ya no existe. Actualiza el tablero.");
    return extra;
  };
  const worksPort: WorkshopWorksPort = {
    noteCreatedWork(entryId, workId) {
      const extra = extras[entryId];
      if (extra && !extra.works.items.some((item) => item.id === workId)) {
        extra.works = { available: true, items: [...extra.works.items, work({ id: workId, title: "Trabajo creado en la app", statusName: "Por hacer", statusColor: "#95A5A6", loose: true })] };
      }
    },
    async workshopFreeWorks(_entryId, _branchId, search) {
      const term = search.trim().toLowerCase();
      return { items: freeWorks.filter((item) => !term || item.title.toLowerCase().includes(term)) };
    },
    async linkWorkshopWorks(entryId, input) {
      await delay();
      const extra = extraOf(entryId);
      const chosen = freeWorks.filter((item) => input.workIds.includes(item.id));
      freeWorks = freeWorks.filter((item) => !input.workIds.includes(item.id));
      extra.works = { available: true, items: [...extra.works.items, ...chosen.map((item) => work({ id: item.id, title: item.title, statusName: item.statusName, loose: true }))] };
      return { linked: chosen.length, skipped: input.workIds.length - chosen.length };
    }
  };
  let nextOrder = 120;
  let nextCorrelative = 60;
  const ordersPort: WorkshopOrdersPort = {
    async workshopOrderRules() { return { blockingFields: [], descriptionRequired: false }; },
    async createWorkshopOrder(entryId, input) {
      await delay();
      const extra = extraOf(entryId);
      const orderId = nextOrder++;
      const sent = input.sendToCommercial;
      const code = sent ? `COT-SER-${String(nextCorrelative++).padStart(4, "0")}` : "OT sin código";
      extra.orders = { available: true, items: [...extra.orders.items, order({ id: orderId, kind: "workOrder", code, title: input.title,
        statusLabel: sent ? "Pendiente" : "Sin enviar a comercial", sentToCommercial: sent })] };
      extra.works = { available: true, items: extra.works.items.map((item) => input.workIds.includes(item.id) ? { ...item, orderId, loose: false } : item) };
      return { id: orderId, sent };
    },
    async addWorksToOrder(entryId, orderId, input) {
      await delay();
      const extra = extraOf(entryId);
      extra.works = { available: true, items: extra.works.items.map((item) => input.workIds.includes(item.id) ? { ...item, orderId, loose: false } : item) };
      return { linked: input.workIds.length, skipped: 0 };
    },
    async sendOrderToCommercial(entryId, orderId) {
      await delay();
      const extra = extraOf(entryId);
      extra.orders = { available: true, items: extra.orders.items.map((item) => item.id === orderId
        ? { ...item, sentToCommercial: true, statusLabel: "Pendiente", code: item.code.startsWith("COT-") ? item.code : `COT-SER-${String(nextCorrelative++).padStart(4, "0")}` } : item) };
      return { id: orderId };
    },
    async deleteWorkshopOrder(entryId, orderId) {
      await delay();
      const extra = extraOf(entryId);
      const removed = extra.works.items.filter((item) => item.orderId === orderId).length;
      extra.orders = { available: true, items: extra.orders.items.filter((item) => item.id !== orderId) };
      // Igual que el servidor: al eliminar una OT no enviada también se eliminan sus trabajos.
      extra.works = { available: true, items: extra.works.items.filter((item) => item.orderId !== orderId) };
      return { id: orderId, deletedWorks: removed };
    }
  };
  const deliveryPort: WorkshopDeliveryPort = {
    async deliverWorkshopEntry(entryId, input) {
      await delay();
      const detail = detailOf(entryId);
      const { pending } = deliveryBlockers(detail);
      if (pending.length > 0) throw new Error(`Falta cumplir: ${pending.map((condition) => condition.title).join(", ")}.`);
      // El equipo sale de la nave y queda como entregado.
      for (const board of Object.values(boards)) for (const area of board.areas) {
        const found = area.entries.find((item) => item.id === entryId);
        if (found) delivered[entryId] = { entry: found, area: { ...area, entries: [] }, at: input.deliveredAt, to: input.receiverName, note: input.note };
        area.entries = area.entries.filter((item) => item.id !== entryId);
        area.occupiedSlots = area.entries.length;
      }
      return { id: entryId, deliveredAt: input.deliveredAt };
    }
  };
  const statuses = [
    { id: 1, key: "PENDING", name: "Pendiente", color: "#3498DB", subStatuses: [] },
    { id: 2, key: "IN_PROGRESS", name: "En proceso", color: "#8E44AD", subStatuses: [{ id: 21, name: "Esperando repuesto", color: null }, { id: 22, name: "En desarme", color: null }] },
    { id: 3, key: "UNDER_REVIEW", name: "En revisión", color: "#F1C40F", subStatuses: [] },
    { id: 4, key: "COMPLETED", name: "Terminado", color: "#E67E22", subStatuses: [{ id: 41, name: "Listo para entregar", color: null }] }
  ];
  const placed = (entryId: number) => {
    for (const board of Object.values(boards)) for (const area of board.areas) {
      const found = area.entries.find((item) => item.id === entryId);
      if (found) return { board, area, found };
    }
    throw new Error("El ingreso ya no existe. Actualiza el tablero.");
  };
  const managePort: WorkshopManagePort = {
    async workshopStatuses() { return { items: statuses.map(({ key: _key, ...status }) => status) }; },
    async moveWorkshopEntry(entryId, input) {
      await delay();
      const { area, found } = placed(entryId);
      const target = findArea(input.toAreaId);
      if (target.id === area.id) throw new Error("El equipo ya está en esa nave.");
      if (!workshopAreaHasRoom(target)) throw new Error("La nave de destino está llena. Elige otra.");
      area.entries = area.entries.filter((item) => item.id !== entryId);
      area.occupiedSlots = area.entries.length;
      target.entries.push({ ...found, daysInArea: 0 });
      target.occupiedSlots = target.entries.length;
      if (forms[entryId]) { forms[entryId].operationAreaId = target.id; forms[entryId].areaTitle = target.title; }
      return { id: entryId };
    },
    async changeEstimatedDelivery(entryId, input) {
      await delay();
      placed(entryId).found.estimatedDeliveryAt = input.estimatedDeliveryAt;
      return { id: entryId };
    },
    async changeEntryStatus(entryId, input) {
      await delay();
      const { found } = placed(entryId);
      const status = statuses.find((item) => item.id === input.statusId);
      if (!status) throw new Error("Ese estado ya no está disponible. Actualiza la lista.");
      found.statusKey = status.key; found.statusColor = status.color;
      found.subStatusName = status.subStatuses.find((sub) => sub.id === input.subStatusId)?.name ?? null;
      return { id: entryId };
    }
  };
  let nextCustomerItem = 500;
  const customerOf = (customerId: number) => {
    const found = customers.find((item) => item.id === customerId);
    if (!found) throw new Error("El cliente ya no existe.");
    return found;
  };
  const customersPort: WorkshopCustomersPort = {
    async workshopIdentificationTypes() { return { items: [{ id: 1, label: "RUT", isRut: true }, { id: 2, label: "Pasaporte", isRut: false }] }; },
    async createWorkshopCustomer(input) {
      await delay();
      const number = input.identificationTypeId === 1 ? formatRut(input.number) : input.number.trim();
      if (input.identificationTypeId === 1 && !isValidRut(input.number)) throw new Error("El RUT no es válido. Revisa el número y el dígito verificador.");
      const created = { id: nextCustomerItem++, name: input.name.trim(), contacts: [], branches: [] };
      customers.push(created);
      documents[created.id] = number;
      return { id: created.id, name: created.name, document: number };
    },
    async createWorkshopCustomerBranch(customerId, input) {
      await delay();
      const branch = { id: nextCustomerItem++, name: input.name.trim() };
      customerOf(customerId).branches.push(branch);
      return branch;
    },
    async createWorkshopCustomerContact(customerId, input) {
      await delay();
      const created = { id: nextCustomerItem++, fullName: `${input.firstName.trim()} ${input.lastName.trim()}`, email: input.email?.trim() || null,
        phone: input.phone?.trim() || null, position: input.position?.trim() || null };
      customerOf(customerId).contacts.push(created);
      return created;
    }
  };
  const documents: Record<number, string> = {};
  return {
    ...customersPort,
    ...inspectionPort,
    ...receptionPort,
    ...worksPort,
    ...ordersPort,
    ...deliveryPort,
    ...managePort,
    async workshops() { return workshops; },
    async workshopBoard(_branchId: number, workshopId: number) { return JSON.parse(JSON.stringify(boards[workshopId] ?? { workshopId, areas: [] })) as WorkshopBoard; },
    async workshopEntry(_branchId: number, entryId: number) { return detailOf(entryId); },
    async workshopCustomers() { return { items: customers.map(({ id, name }) => ({ id, name, document: documents[id] ?? null })) }; },
    async workshopCustomer(_branchId: number, customerId: number) {
      const found = customers.find((item) => item.id === customerId);
      if (!found) throw new Error("WORKSHOP_CUSTOMER_NOT_FOUND");
      return found;
    },
    async workshopEquipment(query: WorkshopEquipmentQuery) {
      const search = query.search?.trim().toLowerCase() ?? "";
      const items = equipment.filter((item) => item.source === query.source && (query.source === "own" || equipmentOwner[item.id] === query.customerId)
        && (!search || `${item.label} ${item.code ?? ""}`.toLowerCase().includes(search)));
      return { items, hasMore: false };
    },
    async workshopAreas(_branchId: number, workshopId: number) {
      return { items: (boards[workshopId]?.areas ?? []).filter(workshopAreaHasRoom).map(({ id, title }) => ({ id, title })) };
    },
    async workshopIntakeForm(_branchId: number, entryId: number) {
      const form = forms[entryId];
      if (form) return form;
      const detail = detailOf(entryId);
      return { entryId, operationAreaId: detail.areaId, areaTitle: detail.areaTitle, title: detail.title ?? "", notes: detail.notes, isInternalEntry: detail.isInternalEntry,
        customer: null, equipment: equipment.find((item) => item.label === detail.equipmentLabel) ?? null, branches: [], contacts: [],
        entryAt: detail.entryAt, estimatedDeliveryAt: detail.estimatedDeliveryAt, imageUrl: detail.imageUrl, signed: detail.reception.signed };
    },
    async createWorkshopEntry(input: WorkshopIntakeInput) {
      await delay();
      const area = findArea(input.operationAreaId);
      if (!workshopAreaHasRoom(area)) throw new Error("La nave está llena. Elige otra nave o libera un espacio.");
      const entryId = nextId++;
      placeEntry(entryId, input, null);
      return { id: entryId };
    },
    async updateWorkshopEntry(entryId: number, input: WorkshopIntakeInput) {
      await delay();
      placeEntry(entryId, input, forms[entryId]?.imageUrl ?? null);
      return { id: entryId };
    },
    async uploadWorkshopEntryImage(entryId: number, input: WorkshopImageInput) {
      await delay();
      for (const board of Object.values(boards)) for (const area of board.areas) for (const item of area.entries) if (item.id === entryId) item.imageUrl = input.image;
      if (forms[entryId]) forms[entryId].imageUrl = input.image;
      return { id: entryId };
    }
  };
}

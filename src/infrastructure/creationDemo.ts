import { creationInputSchema, creationOptionsQuerySchema, creationOptionsSchema, creationResultSchema, nonProductiveReasonSchema, normalizeEquipmentInternalNumber, type CreationInput, type CreationOptions, type CreationOptionsQuery, type CreationResult } from "../domain/creation";
import type { AssignmentGroup, AssignmentWork } from "../domain/models";
import { demoUser } from "./demoData";

const equipment = [{ id: 15, internalNumber: "15", identifier: "EQ-15", equipmentType: "Excavadora", label: "N.º interno 15 · EQ-15 · Excavadora de demostración" },
  { id: 16, internalNumber: "16", identifier: "EQ-16", equipmentType: "Generador", label: "N.º interno 16 · EQ-16 · Generador de demostración" }];
const specialties = [{ id: 2, label: "Mecánica" }, { id: 3, label: "Electricidad" }];
const reasons = ["Espera de repuesto", "Espera de autorización", "Espera de equipo", "Traslado", "Detención por seguridad", "Clima", "Sin acceso", "Administrativo", "Capacitación", "Otro"];

function branch(id: number): void {
  if (!demoUser.accessBranchs.some((item) => item.id === id && item.isEnabled !== false && item.isDeleted !== true)) throw new Error("BRANCH_FORBIDDEN");
}

function requestSignature(value: CreationInput): string {
  const normalized = { ...value, schedule: { ...value.schedule, endDateOffset: 0 }, ...(value.kind === "maintenance" ? { maintenance: { ...value.maintenance, priority: value.maintenance.priority ?? "medium" } } : {}) };
  const keys = new Set<string>();
  JSON.stringify(normalized, (key: string, entry: unknown) => { keys.add(key); return entry; });
  return JSON.stringify(normalized, [...keys].sort());
}

export function demoCreationOptions(query: CreationOptionsQuery): CreationOptions {
  const input = creationOptionsQuerySchema.parse(query);
  branch(input.companyBranchId);
  const page = input.page ?? 0;
  const catalog = (items: Array<{ id: number; label: string; internalNumber?: string }>) => {
    const filtered = items.filter((item) => input.internalNumber === undefined
      ? item.label.toLowerCase().includes((input.search ?? "").toLowerCase())
      : item.internalNumber !== undefined && normalizeEquipmentInternalNumber(item.internalNumber) === input.internalNumber);
    return { items: filtered.slice(page * 25, (page + 1) * 25), page, pageSize: 25, hasMore: filtered.length > (page + 1) * 25 };
  };
  return creationOptionsSchema.parse({ companyBranchId: input.companyBranchId, userId: demoUser.id, workerId: demoUser.workerId, timezone: demoUser.system.timezone,
    priorities: ["low", "medium", "high"], nonProductiveReasons: nonProductiveReasonSchema.options.map((value, index) => ({ value, label: reasons[index] })),
    maintenanceTypes: ["correctivo", "detencion", "preventivo", "rutinario", "checklist"].map((value) => ({ value, enabled: ["correctivo", "detencion"].includes(value), instruction: ["correctivo", "detencion"].includes(value) ? null : "MOBILE_CREATION_MAINTENANCE_WEB_WIZARD_REQUIRED" })),
    schedule: { sameDayOnly: true, conflictPolicy: "warning" },
    ...(input.kind !== "specialties" ? { equipment: catalog(equipment) } : {}), ...(input.kind !== "equipment" ? { specialties: catalog(specialties) } : {}),
  });
}

export class DemoCreationStore {
  private nextId = 20000;
  private requests = new Map<string, { signature: string; result: CreationResult }>();
  readonly groupIds = new Set<string>();
  constructor(private readonly insert: (group: AssignmentGroup, initialComment?: string) => void) {}

  create(value: CreationInput): CreationResult {
    const input = creationInputSchema.parse(value);
    branch(input.companyBranchId);
    const signature = requestSignature(input);
    const existing = this.requests.get(input.clientRequestId);
    if (existing) {
      if (signature !== existing.signature) throw new Error("MOBILE_CREATION_REQUEST_CONFLICT");
      return structuredClone(existing.result);
    }
    const specialtyId = input.kind === "work" ? input.work.specialtyId : input.kind === "maintenance" ? input.maintenance.specialtyId : undefined;
    const equipmentId = input.kind === "work" ? input.work.rentalEquipmentId : input.kind === "maintenance" ? input.maintenance.equipmentId : undefined;
    if (specialtyId !== undefined && !specialties.some((item) => item.id === specialtyId)) throw new Error("MOBILE_CREATION_SPECIALTY_NOT_FOUND");
    if (equipmentId !== undefined && !equipment.some((item) => item.id === equipmentId)) throw new Error("MOBILE_CREATION_EQUIPMENT_NOT_FOUND");
    const workId = ++this.nextId;
    const groupId = input.kind === "maintenance" ? `maintenance-${++this.nextId}` : `${input.kind === "work" ? "direct" : "direct-np"}-${workId}`;
    const hasTimes = Boolean(input.schedule.startTime && input.schedule.endTime);
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const plannedMinutes = hasTimes ? minutes(input.schedule.endTime) - minutes(input.schedule.startTime) : 0;
    const selectedEquipment = equipment.find((item) => item.id === equipmentId);
    const title = input.kind === "work" ? input.work.title : input.kind === "maintenance" ? input.maintenance.title : input.nonProductive.reasonText ?? reasons[nonProductiveReasonSchema.options.indexOf(input.nonProductive.reason)]!;
    const work: AssignmentWork = {
      id: String(workId), title, summary: input.kind === "work" ? input.work.summary : input.kind === "maintenance" ? input.maintenance.motive : input.nonProductive.reasonText ?? title,
      workType: input.kind === "non_productive" ? "non_productive" : "productive", specialty: specialties.find((item) => item.id === specialtyId)?.label ?? "",
      status: "pending", priority: input.kind === "work" ? input.work.priority : input.kind === "maintenance" ? input.maintenance.priority ?? "medium" : "medium",
      scheduledDate: input.schedule.date, scheduledStartTime: input.schedule.startTime, scheduledEndTime: input.schedule.endTime, plannedMinutes,
      plannedDates: [input.schedule.date], executedMinutes: 0, elapsedSeconds: 0, commentsCount: input.kind === "non_productive" && input.nonProductive.initialComment ? 1 : 0,
      filesCount: 0, checklistDone: 0, checklistTotal: 0, isOverdue: false, canExecute: true, canEditDefinition: false,
      missingRequiredInfo: [], materials: [], checklists: [], responsibles: [{ id: demoUser.workerId!, name: `${demoUser.name} ${demoUser.lastnames}` }],
    };
    work.schedules = [{ date: input.schedule.date, queryDates: [input.schedule.date], generatedAt: new Date().toISOString(), work: structuredClone(work) }];
    const group: AssignmentGroup = { id: groupId, type: input.kind === "maintenance" ? "internal_maintenance" : "direct_assignment", code: input.kind === "maintenance" ? `OT-${input.maintenance.type === "correctivo" ? "COR" : "DET"}-${this.nextId}` : `TR-${workId}`, title,
      status: "pending", customerName: null, locationName: demoUser.accessBranchs[0]!.name, locationAddress: null, scheduledDate: input.schedule.date,
      scheduledStartTime: input.schedule.startTime, scheduledEndTime: input.schedule.endTime, plannedMinutes, isOverdue: false, isResponsible: true, canManage: false,
      equipment: selectedEquipment ? { label: selectedEquipment.label, identifier: `EQ-${selectedEquipment.id}`, internalNumber: String(selectedEquipment.id), ownerLabel: "Demostración" } : null,
      products: [], works: [work], ...(input.kind === "maintenance" ? { maintenanceType: input.maintenance.type } : {}),
    };
    const result = creationResultSchema.parse({ kind: input.kind, groupId, workId, companyBranchId: input.companyBranchId, schedule: { date: input.schedule.date, startTime: input.schedule.startTime, endTime: input.schedule.endTime, plannedMinutes: hasTimes ? plannedMinutes : null, timezone: demoUser.system.timezone } });
    this.insert(group, input.kind === "non_productive" ? input.nonProductive.initialComment : undefined);
    this.groupIds.add(group.id);
    this.requests.set(input.clientRequestId, { signature, result: structuredClone(result) });
    return structuredClone(result);
  }
}
import type { Assignments, AssignmentWork, ChecklistStep, User } from "../domain/models";
import { dateKey, shiftDate } from "../domain/format";

export const demoUser: User = {
  id: 10001, workerId: 10001, name: "Alex", lastnames: "Martínez", email: "tecnico@demo.example",
  role: { name: "Técnico de mantenimiento", isTechnician: true }, accessBranchs: [{ id: 1, name: "Taller central · Demostración", main: true }],
  system: { name: "Qualitzer · Demostración", timezone: "America/Santiago" },
};
function step(id: number, title: string, type: ChecklistStep["type"], options: ChecklistStep["options"] = []): ChecklistStep {
  return { stepId: id, title, type, options, order: id, description: "Registra el resultado de la revisión en terreno.", tag: "Inspección", isFilesRequired: false, isCompleted: null, selectValue: "", optionsSelectValue: [], responseValue: "", comment: "", executionStatus: null, attachments: [] };
}
function work(id: string, title: string, overrides: Partial<AssignmentWork> = {}): AssignmentWork {
  return {
    id, title, summary: "Realiza la inspección con el equipo detenido y siguiendo los procedimientos de seguridad de la empresa. Registra los hallazgos y adjunta evidencia del trabajo realizado.", specialty: "Mecánica", workType: "productive", status: "pending", priority: "medium", scheduledDate: dateKey(), scheduledStartTime: "08:30", scheduledEndTime: "10:30", plannedMinutes: 120, executedMinutes: 0, elapsedSeconds: 0, commentsCount: 0, filesCount: 0, isFilesRequired: false, checklistDone: 0, checklistTotal: 0, isOverdue: false, canExecute: true, canEditDefinition: false, missingRequiredInfo: [], materials: [], checklists: [], responsibles: [{ id: 10001, name: "Alex Martínez" }], ...overrides,
  };
}
export function makeDemoData(): Assignments {
  const today = dateKey();
  const groups: Assignments["groups"] = [
    {
      id: "maintenance-101", type: "internal_maintenance", code: "OT-PRE-00101", title: "Servicio preventivo · 500 horas", status: "in_progress", customerName: "Flota propia · Demo", locationName: "Taller central · Bahía 03", locationAddress: null, scheduledDate: today, scheduledStartTime: "08:30", scheduledEndTime: "12:30", plannedMinutes: 240, isOverdue: false, isResponsible: true, canManage: false,
      equipment: { label: "Excavadora hidráulica · CAT 320", identifier: "EXC-032", internalNumber: "032", ownerLabel: "Flota propia · Demo" }, products: [], maintenanceType: "preventive",
      works: [work("1001", "Inspección del sistema hidráulico", {
        status: "in_progress", priority: "high", elapsedSeconds: 1845, executedMinutes: 30, systemName: "Sistema hidráulico", componentName: "Mangueras y conexiones", checklistTotal: 5,
        checklists: [{ checklistId: 1, name: "Inspección hidráulica", code: "CHK-HID-01", required: true, steps: [
          step(101, "Equipo aislado y bloqueo de energías verificado", "validation"),
          step(102, "Estado de mangueras y conexiones", "select", [{ value: "good", label: "Sin observaciones" }, { value: "review", label: "Requiere revisión" }]),
          step(103, "Lectura del horómetro (h)", "number"),
          step(104, "Puntos inspeccionados", "multiselect", [{ value: "pump", label: "Bomba" }, { value: "valves", label: "Válvulas" }, { value: "cylinders", label: "Cilindros" }]),
          step(105, "Observaciones de la inspección", "text"),
        ] }],
      }), work("1002", "Cambio de filtros y lubricación", { scheduledStartTime: "10:30", scheduledEndTime: "12:30", materials: [{ id: "p1", name: "Filtro hidráulico", ref: "FIL-H32", quantity: 1, stockStatus: "reserved" }, { id: "p2", name: "Lubricante multipropósito", ref: "LUB-01", quantity: 2, stockStatus: "in_stock" }] })],
    },
    {
      id: "external-202", type: "external_ot", code: "OT-00202", title: "Diagnóstico en terreno", status: "pending", customerName: "Constructora del Pacífico · Demo", locationName: "Faena Los Robles", locationAddress: null, scheduledDate: today, scheduledStartTime: "14:00", scheduledEndTime: "16:00", plannedMinutes: 120, isOverdue: false, isResponsible: true, canManage: false,
      equipment: { label: "Generador eléctrico · 100 kVA", identifier: "GEN-018", internalNumber: "018", ownerLabel: "Equipo de cliente · Demo" }, products: [],
      works: [work("2001", "Diagnóstico del sistema de arranque", { specialty: "Electricidad", scheduledStartTime: "14:00", scheduledEndTime: "16:00", isFilesRequired: true })],
    },
    {
      id: "maintenance-303", type: "internal_maintenance", code: "OT-RUT-00303", title: "Inspección rutinaria", status: "pending", customerName: "Flota propia · Demo", locationName: "Patio de equipos", locationAddress: null, scheduledDate: shiftDate(today, 1), scheduledStartTime: "09:00", scheduledEndTime: "10:00", plannedMinutes: 60, isOverdue: false, isResponsible: true, canManage: false,
      equipment: { label: "Cargador frontal · Volvo L90", identifier: "CAR-012", internalNumber: "012", ownerLabel: "Flota propia · Demo" }, products: [], maintenanceType: "routine",
      works: [work("3001", "Revisión de niveles y neumáticos", { scheduledDate: shiftDate(today, 1), plannedMinutes: 60, scheduledStartTime: "09:00", scheduledEndTime: "10:00" })],
    },
    {
      id: "direct-4001", type: "direct_assignment", code: "TR-04001", title: "Inspección de seguridad", status: "completed", customerName: "Taller central · Demo", locationName: "Zona de entrega", locationAddress: null, scheduledDate: today, scheduledStartTime: "07:30", scheduledEndTime: "08:15", plannedMinutes: 45, isOverdue: false, isResponsible: true, canManage: false,
      equipment: { label: "Plataforma elevadora · JLG", identifier: "PLA-007", internalNumber: "007", ownerLabel: "Flota propia · Demo" }, products: [],
      works: [work("4001", "Verificación previa a la entrega", { status: "completed", plannedMinutes: 45, executedMinutes: 40, elapsedSeconds: 2400, scheduledStartTime: "07:30", scheduledEndTime: "08:15" })],
    },
  ];
  return { generatedAt: new Date().toISOString(), technician: { id: 10001, name: "Alex Martínez", allowEditExecutionTime: false }, summary: { totalGroups: 4, totalWorks: 5, activeWorks: 1, overdueWorks: 0, plannedMinutes: 465 }, groups };
}
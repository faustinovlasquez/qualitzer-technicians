import type { AssignmentGroup, Assignments, AssignmentWork, ChecklistStep, User } from "../../src/domain/models";

export const TOKEN = "Bearer test-token";
export const RANGE = "startDate=2026-09-01&endDate=2026-09-07&companyBranchId=1";
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=", "base64");

export function user(): User {
  return { id: 9, workerId: 42, name: "Técnico", lastnames: "Prueba", email: "test@example.invalid", role: { name: "admin", isTechnician: false }, accessBranchs: [{ id: 1, name: "Principal", main: true }], system: { name: "Test", timezone: "America/Santiago" } };
}

export function step(overrides: Partial<ChecklistStep> = {}): ChecklistStep {
  return {
    stepId: 101, order: 1, title: "Verificar", description: "Revisión visual", tag: "Equipo",
    type: "select", options: [{ value: "approved", label: "Aprobado" }, { value: "rejected", label: "Rechazado" }],
    isFilesRequired: false, isCompleted: null, selectValue: "", optionsSelectValue: [], responseValue: "", comment: "", executionStatus: null, attachments: [], ...overrides,
  };
}

export function work(overrides: Partial<AssignmentWork> = {}): AssignmentWork {
  return {
    id: "11", workType: "productive", title: "Inspección", summary: "Comprobar equipo", specialty: "Mecánica", status: "in_progress", priority: "high",
    scheduledDate: "2026-09-01", scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: 60, executedMinutes: 20, elapsedSeconds: 1200,
    firstInProgressTime: "08:00", isManualExecution: false, endDateOffset: 0, commentsCount: 2, filesCount: 1, isFilesRequired: false,
    checklistDone: 0, checklistTotal: 1, isOverdue: false, canExecute: true, canEditDefinition: true, missingRequiredInfo: [],
    materials: [{ id: "1", name: "Filtro", ref: "FLT", quantity: 1, stockStatus: "reserved" }],
    checklists: [{ checklistId: 10, name: "Control", code: "CHK-10", required: false, steps: [step()] }],
    activities: [{ id: 901, activity: "Inspección", executionTime: 60, isStarted: true, isCompleted: false, technicalDocuments: [{ id: 1, documentName: "Manual", notes: "Referencia", file: { id: 5, name: "Manual.pdf", url: "https://files.example.invalid/manual.pdf" } }] }],
    responsibles: [{ id: 42, name: "Técnico", avatarThumbnail: "https://files.example.invalid/avatar.jpg" }],
    workCustomerName: "Cliente", workEquipment: { label: "Motor", identifier: "M-1", internalNumber: "1", ownerLabel: "Cliente" },
    plannedDates: ["2026-09-01"], systemName: "Motor", componentName: "Filtro", ...overrides,
  };
}

export function group(overrides: Partial<AssignmentGroup> = {}): AssignmentGroup {
  return {
    id: "direct-11", type: "direct_assignment", code: "TRA-11", title: "Asignación", status: "in_progress", customerName: "Cliente",
    locationName: "Taller", locationAddress: "Dirección", scheduledDate: "2026-09-01", scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: 60,
    isOverdue: false, isResponsible: true, canManage: true, equipment: { label: "Motor", identifier: "M-1", internalNumber: "1", ownerLabel: "Cliente" }, products: [], works: [work()], ...overrides,
  };
}

export function assignments(groups: AssignmentGroup[] = [group()]): Assignments {
  return { generatedAt: "2026-09-01T10:00:00.000Z", technician: { id: 42, name: "Técnico", allowEditExecutionTime: true, avatarThumbnail: "https://files.example.invalid/avatar.jpg" }, summary: { totalGroups: groups.length, totalWorks: 99, activeWorks: 99, overdueWorks: 99, plannedMinutes: 9999 }, groups };
}
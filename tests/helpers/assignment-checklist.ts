import type { Assignments, ChecklistStep } from "../../src/domain/models";
import { assignments, group, step, work } from "../../server/tests/fixtures";

export const checklistDate = "2026-09-11";

export function equipmentChecklistPayload(): Assignments {
  const answered: Partial<ChecklistStep>[] = [
    { type: "validation", isCompleted: false, executionStatus: "not_completed" },
    { type: "validation", selectValue: "not_applicable" },
    { type: "number", responseValue: "0" },
    { type: "select", selectValue: "rejected" },
    { type: "select", options: [{ value: "NC", label: "No cumple" }], selectValue: "NC" },
    { type: "multiselect", optionsSelectValue: [{ value: "approved", label: "Aprobado" }] },
    { type: "approval", selectValue: "approved" },
  ];
  const steps = Array.from({ length: 47 }, (_, index) => step({
    stepId: 1001 + index, order: index + 1, title: `Verificación ${index + 1}`, isRequired: true,
    ...answered[index],
    ...(index === 7 ? { selectValue: "approved", executionStatus: "partial", isFilesRequired: true } : {}),
    ...(index === 8 ? { comment: "Observación sin respuesta" } : {}),
    ...(index === 46 ? { type: "text", responseValue: "Instrucciones informativas" } : {}),
  }));
  const data = assignments([group({
    id: "maintenance-80", type: "internal_maintenance", scheduledDate: checklistDate,
    works: [work({
      id: "81", scheduledDate: checklistDate, plannedDates: [checklistDate], checklistDone: 0, checklistTotal: 47,
      checklists: [{ checklistId: 501, name: "Check List de equipos", code: "EQUIPMENT_DISPATCH_CHECKLIST_1", required: false, steps }],
    })],
  })]);
  data.generatedAt = `${checklistDate}T10:00:00.000Z`;
  return data;
}
import { checklistCatalogQuerySchema, checklistAssignmentInputSchema, type ChecklistCatalogQuery, type ChecklistCatalogPage, type ChecklistAssignmentResult } from "../domain/checklistAssignment";
import type { AssignmentWork, Checklist } from "../domain/models";

export class DemoChecklistAssignments {
  private readonly catalog: Checklist[];
  private nextStepId: number;
  constructor(checklists: Checklist[]) {
    this.catalog = structuredClone([...new Map(checklists.map((item) => [item.checklistId, item])).values()]);
    this.nextStepId = Math.max(0, ...checklists.flatMap((item) => item.steps.map((step) => Number(step.stepId)).filter(Number.isSafeInteger))) + 1;
  }
  options(work: AssignmentWork, input: ChecklistCatalogQuery): ChecklistCatalogPage {
    const query = checklistCatalogQuerySchema.parse(input);
    const search = query.search.toLocaleLowerCase();
    const rows = this.catalog.filter((item) => item.steps.length > 0 && `${item.name} ${item.code}`.toLocaleLowerCase().includes(search))
      .sort((left, right) => left.name.localeCompare(right.name) || left.checklistId - right.checklistId);
    return {
      items: rows.slice(query.page * 20, (query.page + 1) * 20).map((item) => ({ id: item.checklistId, name: item.name, code: item.code, description: null, alreadyAssigned: work.checklists.some((list) => list.checklistId === item.checklistId) })),
      page: query.page, pageSize: 20, hasMore: rows.length > (query.page + 1) * 20,
    };
  }
  attach(work: AssignmentWork, checklistId: number): ChecklistAssignmentResult {
    checklistAssignmentInputSchema.parse({ checklistId });
    if (work.status === "completed" || work.status === "delivered") throw new Error("El trabajo está finalizado o entregado.");
    const master = this.catalog.find((item) => item.checklistId === checklistId && item.steps.length > 0);
    if (!master) throw new Error("Checklist de demostración no encontrado.");
    if (work.checklists.some((item) => item.checklistId === checklistId)) return { checklistId, alreadyAssigned: true };
    const checklist: Checklist = {
      ...structuredClone(master), required: false,
      steps: master.steps.map((step) => ({
        ...structuredClone(step), stepId: this.nextStepId++, isCompleted: null, responseValue: "", selectValue: "",
        optionsSelectValue: [], comment: "", executionStatus: null, attachments: [],
      })),
    };
    work.checklists.push(checklist);
    work.checklistTotal += checklist.steps.length;
    return { checklistId, alreadyAssigned: false };
  }
}
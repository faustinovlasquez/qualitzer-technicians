import { checklistFillProgress, type ChecklistFillProgress } from "./checklistProgress";
import type { Assignments, AssignmentWork, Attachment } from "./models";
import { withoutProductContainers } from "./productContainers";

function confirmedAttachment(file: Attachment): boolean {
  if ("offline" in file && file.offline && typeof file.offline === "object" && "confirmed" in file.offline) {
    return file.offline.confirmed === true;
  }
  return !String(file.id).startsWith("local-");
}

export function workChecklistProgress(work: Pick<AssignmentWork, "checklists">): ChecklistFillProgress {
  return checklistFillProgress(work.checklists.flatMap((checklist) => checklist.steps.map((step) => ({
    ...step, attachments: step.attachments.filter(confirmedAttachment),
  }))));
}

export function normalizeWorkChecklistProgress(work: AssignmentWork): AssignmentWork {
  const progress = workChecklistProgress(work);
  return {
    ...work, checklistDone: progress.completed, checklistTotal: progress.total,
    ...(work.schedules ? { schedules: work.schedules.map((snapshot) => ({ ...snapshot, work: normalizeWorkChecklistProgress(snapshot.work) })) } : {}),
  };
}

/** Normaliza el avance de checklists y quita los trabajos internos de repuestos, que la web tampoco muestra al técnico. */
export function normalizeAssignmentsChecklistProgress(data: Assignments): Assignments {
  return { ...data, groups: data.groups.map((group) => ({ ...group, works: withoutProductContainers(group.works).map(normalizeWorkChecklistProgress) })) };
}
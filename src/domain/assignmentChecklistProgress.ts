import { checklistFillProgress, type ChecklistFillProgress } from "./checklistProgress";
import type { Assignments, AssignmentWork, Attachment } from "./models";

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

export function normalizeAssignmentsChecklistProgress(data: Assignments): Assignments {
  return { ...data, groups: data.groups.map((group) => ({ ...group, works: group.works.map(normalizeWorkChecklistProgress) })) };
}
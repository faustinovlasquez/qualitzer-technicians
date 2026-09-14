import { workChecklistProgress } from "./assignmentChecklistProgress";
import { hasChecklistStepAnswer, isChecklistStepProgressRelevant } from "./checklistProgress";
import type { Checklist } from "./models";

export interface ChecklistResumeTarget {
  stepId?: string;
  reason: "answer" | "evidence" | "review";
}

export function checklistResumeTarget(checklist: Checklist): ChecklistResumeTarget {
  const pending = [...checklist.steps].sort((left, right) => left.order - right.order).find((step) =>
    isChecklistStepProgressRelevant(step) && workChecklistProgress({ checklists: [{ ...checklist, steps: [step] }] }).remaining > 0);
  if (!pending) return { reason: "review" };
  return { stepId: String(pending.stepId), reason: hasChecklistStepAnswer(pending) ? "evidence" : "answer" };
}
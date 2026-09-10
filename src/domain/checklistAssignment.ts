import { z } from "zod";
import type { AssignmentGroup, AssignmentWork, WorkScope } from "./models";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const checklistAssignmentInputSchema = z.object({ checklistId: id }).strict();
export const checklistCatalogQuerySchema = z.object({
  search: z.string().max(120).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).transform((value) => value.trim()).default(""),
  page: z.number().int().min(0).max(1000).default(0),
}).strict();
export const checklistCatalogOptionSchema = z.object({
  id, name: z.string().min(1).max(500), code: z.string().max(500).nullable(),
  description: z.string().max(20000).nullable(), alreadyAssigned: z.boolean(),
});
export const checklistCatalogPageSchema = z.object({
  items: z.array(checklistCatalogOptionSchema).max(20), page: z.number().int().min(0).max(1000),
  pageSize: z.literal(20), hasMore: z.boolean(),
}).refine((value) => new Set(value.items.map((item) => item.id)).size === value.items.length);
export const checklistAssignmentResultSchema = z.object({ checklistId: id, alreadyAssigned: z.boolean() });
export type ChecklistCatalogQuery = z.input<typeof checklistCatalogQuerySchema>;
export type ChecklistCatalogOption = z.infer<typeof checklistCatalogOptionSchema>;
export type ChecklistCatalogPage = z.infer<typeof checklistCatalogPageSchema>;
export type ChecklistAssignmentResult = z.infer<typeof checklistAssignmentResultSchema>;
export interface ChecklistAssignmentPort {
  checklistOptions(scope: WorkScope, query: ChecklistCatalogQuery): Promise<ChecklistCatalogPage>;
  attachChecklist(scope: WorkScope, checklistId: number): Promise<ChecklistAssignmentResult>;
}

export function checklistAssociationBlocked(group: AssignmentGroup, work: AssignmentWork, online: boolean, pendingLocalWork = false): string | null {
  if (pendingLocalWork || !/^[1-9]\d*$/.test(work.id) || !/^(?:external|maintenance|direct(?:-np)?)-[1-9]\d*$/.test(group.id)) return "Sincroniza primero la creación de este trabajo para agregar un checklist.";
  if (!online) return "Sin conexión puedes consultar los checklists disponibles en el dispositivo. Agregar un checklist requiere conexión y no se guarda en la cola.";
  if (work.status === "completed" || work.status === "delivered") return "No se pueden agregar checklists a un trabajo finalizado o entregado.";
  if (group.works.filter((item) => item.id === work.id).length !== 1) return "Actualiza el detalle del trabajo antes de agregar un checklist.";
  return null;
}
import { z } from "zod";
import type { OfflineOperation } from "./offline";

/** Íconos de las consecuencias (nombres de Ionicons); el dominio no depende de la interfaz. */
type IconName = "layers-outline" | "calendar-outline" | "folder-open-outline" | "alert-circle-outline";

/**
 * Eliminar desde la app lo que el técnico creó y sigue pendiente: un trabajo suelto, un mantenimiento o una OT sin
 * enviar a comercial. El servidor revisa las condiciones; aquí se explica el motivo y lo que se pierde.
 */
export const deletionKindSchema = z.enum(["work", "maintenance", "order"]);
export type DeletionKind = z.infer<typeof deletionKindSchema>;
export const deletionReasonSchema = z.enum(["NOT_FOUND", "NOT_CREATOR", "NOT_PENDING", "HAS_TIME", "IN_ORDER", "IN_MAINTENANCE", "NOT_WORK_ORDER", "ORDER_SENT", "ORDER_FINISHED"]);
export type DeletionReason = z.infer<typeof deletionReasonSchema>;

export const deletionCheckSchema = z.object({
  kind: deletionKindSchema,
  allowed: z.boolean(),
  reason: deletionReasonSchema.nullable(),
  createdByName: z.string().max(200).nullable(),
  title: z.string().max(300).nullable(),
  worksCount: z.number().int().min(0).max(10_000),
  /** Solo al eliminar: si se eliminó (si no, `reason` explica por qué ya no se pudo). */
  deleted: z.boolean().optional()
}).strip();
export type DeletionCheck = z.infer<typeof deletionCheckSchema>;

/** De quién se trata: un grupo de Mi jornada (OT o mantenimiento) o uno de sus trabajos. */
export interface DeletionScope { groupId: string; workId?: string; range: { startDate: string; endDate: string; companyBranchId: number } }

export function deletionRoute(scope: DeletionScope): string {
  const group = z.string().regex(/^[a-z_]+(?:-np)?-[1-9]\d*$/).parse(scope.groupId);
  const work = scope.workId === undefined ? "" : `/works/${z.string().regex(/^[1-9]\d*$/).parse(scope.workId)}`;
  const query = new URLSearchParams({ startDate: scope.range.startDate, endDate: scope.range.endDate, companyBranchId: String(z.number().int().positive().parse(scope.range.companyBranchId)) });
  return `/api/assignments/${group}${work}/deletion?${query.toString()}`;
}

export const DELETION_NOUN: Record<DeletionKind, { one: string; the: string; this: string }> = {
  work: { one: "trabajo", the: "el trabajo", this: "este trabajo" },
  maintenance: { one: "mantenimiento", the: "el mantenimiento", this: "este mantenimiento" },
  order: { one: "OT", the: "la OT", this: "esta OT" }
};

/** Por qué no se puede eliminar, en palabras simples y con qué hacer. */
export function deletionReasonText(check: Pick<DeletionCheck, "kind" | "reason" | "createdByName">): { title: string; detail: string } {
  const noun = DELETION_NOUN[check.kind];
  switch (check.reason) {
    case "NOT_CREATOR": return {
      title: `Solo quien creó ${noun.this} puede eliminarlo`,
      detail: `${check.createdByName ? `Lo creó ${check.createdByName}.` : "Lo creó otra persona."} Pídele que lo elimine o hazlo desde la web si tienes permiso.`
    };
    case "HAS_TIME": return { title: "Ya tiene horas registradas", detail: `Se registró tiempo de trabajo en ${noun.this}. Para no perder ese registro, ya no se puede eliminar.` };
    case "NOT_PENDING": return { title: "Ya no está pendiente", detail: `${noun.this.charAt(0).toUpperCase()}${noun.this.slice(1)} ya se inició o avanzó. Solo se puede eliminar mientras está pendiente.` };
    case "IN_ORDER": return { title: "Es parte de una OT", detail: "Este trabajo está dentro de una OT. Elimina la OT completa o quítalo de la OT desde la web." };
    case "IN_MAINTENANCE": return { title: "Es parte de un mantenimiento", detail: "Este trabajo está dentro de un mantenimiento. Elimina el mantenimiento completo." };
    case "ORDER_SENT": return { title: "La OT ya se envió a comercial", detail: "Una vez enviada a comercial la OT ya no se puede eliminar desde la app." };
    case "ORDER_FINISHED": return { title: "La OT está finalizada", detail: "Una OT finalizada no se puede eliminar." };
    case "NOT_WORK_ORDER": return { title: "No es una orden de trabajo", detail: "Las cotizaciones y negocios se gestionan desde la web." };
    case "NOT_FOUND": return { title: "Ya no existe", detail: `${noun.this.charAt(0).toUpperCase()}${noun.this.slice(1)} ya fue eliminado o cambió. Actualiza tu jornada.` };
    default: return { title: "No se puede eliminar", detail: "Revisa la información y vuelve a intentarlo." };
  }
}

/** Lo que pasa al eliminar, para mostrarlo antes de confirmar. */
export function deletionConsequences(check: Pick<DeletionCheck, "kind" | "worksCount">): Array<{ icon: IconName; text: string }> {
  const works = check.worksCount === 1 ? "su trabajo" : `sus ${check.worksCount} trabajos`;
  return [
    ...(check.kind !== "work" && check.worksCount > 0 ? [{ icon: "layers-outline" as const, text: `También se eliminan ${works}.` }] : []),
    { icon: "calendar-outline", text: "Sale de tu jornada, de la agenda y de la planificación." },
    { icon: "folder-open-outline", text: "Sus archivos, checklist y comentarios dejan de estar disponibles." },
    { icon: "alert-circle-outline", text: "No se puede deshacer desde la app." }
  ];
}

/** Cambios guardados en el teléfono (sin confirmar) de un grupo o de uno de sus trabajos. */
export function pendingRecordChanges(operations: readonly OfflineOperation[] | undefined, groupId: string, workId?: string): number {
  return (operations ?? []).filter((op) => op.status !== "applied" && op.kind !== "create" && op.scope.groupId === groupId
    && (workId === undefined || op.scope.workId === workId)).length;
}

export interface DeletionPort {
  deletionCheck(scope: DeletionScope): Promise<DeletionCheck>;
  deleteRecord(scope: DeletionScope): Promise<DeletionCheck>;
}
export const deletionPort = (source: unknown): DeletionPort | null => {
  const candidate = source as Partial<DeletionPort> | null | undefined;
  return candidate && typeof candidate.deletionCheck === "function" && typeof candidate.deleteRecord === "function"
    ? { deletionCheck: candidate.deletionCheck.bind(candidate), deleteRecord: candidate.deleteRecord.bind(candidate) } : null;
};

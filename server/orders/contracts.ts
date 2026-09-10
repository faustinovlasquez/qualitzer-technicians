import { z } from "zod";
import type { MaintenanceDeliveryContext, MaintenanceFaultType } from "../../src/domain/orderLifecycle";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true }).nullable();
const choice = z.object({ value: z.string(), label: z.string() });
export const faultTypeSchema = z.enum(["operative", "wear", "undetermined"]);
export const maintenanceStatusSchema = z.enum(["por_planificar", "planificada", "en_progreso", "entrega_tecnico", "finalizada"]);
export const maintenanceStepSchema = z.object({
  id, maintenanceWorkId: id, checklistId: id.nullable(),
  type: z.enum(["validation", "text", "number", "select", "multiselect", "approval"]),
  responseValue: z.union([z.string(), z.number().finite(), z.boolean(), z.array(choice)]).nullable(),
  isCompleted: z.boolean().nullable(), isFilesRequired: z.boolean(),
  files: z.array(z.object({ id })),
});
const maintenanceWorkSchema = z.object({
  id, maintenanceId: id, title: z.string(),
  checklists: z.array(z.object({
    checklistId: id.nullable(), name: z.string().nullable(), isRequired: z.boolean(),
    steps: z.array(maintenanceStepSchema),
  })),
});
export const maintenanceDetailSchema = z.object({
  id, companyBranchId: id.nullable(),
  type: z.enum(["detencion", "preventivo", "correctivo", "rutinario", "checklist"]),
  status: maintenanceStatusSchema, isArchived: z.boolean(),
  damageType: z.enum(["operacional", "desgaste"]).nullable(),
  finalizationNote: z.string().nullable(), durationMinutes: z.number().finite().nonnegative().nullable(),
  startedAt: timestamp.optional(), finalizedAt: timestamp,
  signatures: z.array(z.object({
    id, maintenanceId: id, role: z.enum(["technician", "manager", "client"]),
    signedBy: id.nullable(), signedByName: z.string(), signedAt: timestamp,
    signatureUrl: z.string().nullable(),
  })),
  works: z.array(maintenanceWorkSchema),
});
export const orderMutationResultSchema = z.object({ success: z.literal(true) });

export type MaintenanceDetail = z.infer<typeof maintenanceDetailSchema>;
export type MaintenanceStep = z.infer<typeof maintenanceStepSchema>;
export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>;

export interface OrderDeliveryContext extends MaintenanceDeliveryContext {
  maintenanceId: number;
  companyBranchId: number;
  generatedAt: string;
  requiresClientSignature: boolean;
  faultTypes: MaintenanceFaultType[];
  maxSignatureBytes: number;
  technician: { userId: number; workerId: number; name: string };
  signatures: Array<{
    id: number;
    role: "technician" | "manager" | "client";
    signedBy: number | null;
    signedByName: string;
    signedAt: string | null;
    hasSignature: boolean;
  }>;
}
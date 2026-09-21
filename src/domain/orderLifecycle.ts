import type { WorkStatus } from "./models";

export type MaintenanceFaultType = "operative" | "wear" | "undetermined";

export interface MaintenanceDeliveryInput {
  note: string | null;
  faultType: MaintenanceFaultType | null;
  receivedByName: string | null;
  clientSignature: string | null;
  technicianSignature: string | null;
  durationMinutes?: number | null;
  acknowledgeDelivery?: true;
}

export interface MaintenanceDeliveryContext {
  groupId: string;
  status: WorkStatus;
  maintenanceType: string | null;
  finalizationNote: string | null;
  damageType: "operacional" | "desgaste" | null;
  durationMinutes: number | null;
  startedAt: string | null;
  finalizedAt: string | null;
  incompleteChecklists: string[];
  suggestedDurationMinutes?: number;
  canStart?: boolean;
  canDeliver?: boolean;
  canTechnicianDeliver?: boolean;
  technicianDeliverySupported?: boolean;
  pendingWorkNames?: string[];
  pendingDeliveryChecklists?: string[];
  totalWorks?: number;
}
import type { AssignmentWorkSnapshot } from "./assignmentSchedule";

export type WorkStatus = "pending" | "in_progress" | "paused" | "completed" | "delivered";
export type GroupType = "external_ot" | "internal_maintenance" | "direct_assignment";
export interface Choice { value: string; label: string; }
export interface Attachment {
  id: number | string;
  name: string;
  url: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  type?: string | null;
  size?: number;
  unit?: string;
  folderId?: number | string | null;
  createdAt?: string | null;
  responsible?: { id: number; name: string; avatarThumbnail?: string | null } | null;
}
export interface ChecklistStep {
  stepId: number | string;
  order: number;
  title: string;
  description: string;
  tag: string;
  type: "validation" | "text" | "number" | "select" | "multiselect" | "approval";
  options: Choice[];
  isFilesRequired: boolean;
  isRequired?: boolean;
  isCompleted: boolean | null;
  selectValue: string;
  optionsSelectValue: Choice[];
  responseValue: string;
  comment: string;
  executionStatus: "completed" | "partial" | "not_completed" | null;
  attachments: Attachment[];
}
export interface Checklist {
  checklistId: number;
  name: string;
  code: string;
  required?: boolean;
  steps: ChecklistStep[];
}
export interface Equipment {
  label: string;
  identifier: string;
  internalNumber: string | null;
  ownerLabel: string | null;
}
export interface Material { id: string; name: string; ref: string | null; quantity: number; stockStatus: "in_stock" | "requested" | "reserved"; }
export interface Responsible { id: number | string; name: string; avatarThumbnail?: string | null; }
export interface TechnicalDocument { id: number; documentName: string; notes: string | null; file: Attachment | null; }
export interface Activity { id: number; activity: string; executionTime: number; isStarted: boolean; isCompleted: boolean; technicalDocuments: TechnicalDocument[]; }
export interface AssignmentWork {
  id: string;
  workType: "productive" | "non_productive";
  title: string;
  summary: string;
  specialty: string;
  status: WorkStatus;
  priority: "low" | "medium" | "high";
  scheduledDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  plannedMinutes: number;
  executedMinutes: number;
  elapsedSeconds: number;
  totalPlannedMinutes?: number;
  totalExecutedMinutes?: number;
  firstInProgressTime?: string | null;
  isManualExecution?: boolean;
  endDateOffset?: number;
  commentsCount: number;
  filesCount: number;
  isFilesRequired?: boolean;
  checklistDone: number;
  checklistTotal: number;
  isOverdue: boolean;
  canExecute: boolean;
  canEditDefinition: boolean;
  missingRequiredInfo: string[];
  materials: Material[];
  checklists: Checklist[];
  activities?: Activity[];
  responsibles: Responsible[];
  workCustomerName?: string | null;
  workEquipment?: Equipment | null;
  plannedDates?: string[];
  schedules?: AssignmentWorkSnapshot[];
  systemName?: string | null;
  componentName?: string | null;
}
export interface AssignmentGroup {
  id: string;
  type: GroupType;
  code: string;
  title: string;
  status: WorkStatus;
  customerName: string | null;
  locationName: string;
  locationAddress: string | null;
  scheduledDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  plannedMinutes: number;
  isOverdue: boolean;
  isResponsible: boolean;
  canManage: boolean;
  equipment: Equipment | null;
  products: Material[];
  works: AssignmentWork[];
  maintenanceType?: string | null;
  negotiationCode?: string | null;
  businessModality?: string | null;
  businessTypeName?: string | null;
  negotiationCorrelative?: number | null;
  workOrderNumber?: number | null;
  workOrderInternalNumber?: number | null;
  isWorkOrderInternal?: boolean | null;
}
export interface Assignments {
  generatedAt: string;
  technician: { id: number | null; name: string; allowEditExecutionTime: boolean; avatarThumbnail?: string | null };
  summary: { totalGroups: number; totalWorks: number; activeWorks: number; overdueWorks: number; plannedMinutes: number };
  groups: AssignmentGroup[];
}
export interface Branch { id: number; name: string; main: boolean; isEnabled?: boolean; isDeleted?: boolean; }
export interface Tenant {
  id: string;
  name: string;
  portalOrigin: string;
  environment: "development" | "production";
  logo?: string | null;
  description?: string | null;
}
export interface User {
  id: number;
  workerId: number | null;
  name: string;
  lastnames: string;
  email: string;
  avatarThumbnail?: string;
  role: { name: string; isTechnician?: boolean };
  accessBranchs: Branch[];
  system: { name: string; timezone: string };
  tenant?: Tenant;
}
export interface LoginResult {
  token: string;
  username: string;
  email: string;
  nextStep: "DONE" | "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  tenant?: Tenant;
}
export interface TenantLoginChallenge {
  nextStep: "SELECT_TENANT";
  challenge: string;
  expiresAt: string;
  tenants: Tenant[];
}
export type LoginStartResult = LoginResult | TenantLoginChallenge;
export interface DevelopmentConnection { expoUrl: string; gatewayUrl: string; qrDataUrl: string; }
export interface DateRange { startDate: string; endDate: string; }
export interface WorkScope extends DateRange { groupId: string; workId: string; companyBranchId: number; }
export interface GroupScope extends DateRange { groupId: string; companyBranchId: number; }
export type WorkDetailTab = "work" | "checklist" | "evidence" | "comments" | "equipment";
export interface WorkOpenOptions { tab?: WorkDetailTab; action?: "deliver"; }
export interface WorkComment {
  id: string;
  text: string;
  createdAt: string | null;
  author: { id: number | null; name: string; avatarUrl?: string | null };
  files: Attachment[];
}
export interface CommentPage { data: WorkComment[]; totalRows: number; totalPages: number; }
export interface StatusInput {
  status: WorkStatus;
  executionStartTime?: string;
  executionEndTime?: string;
  executionDates?: string[];
  endDateOffset?: number;
  isManual?: boolean;
}
export interface StepAnswer {
  responseValue: string | boolean | Choice[] | null;
  isCompleted: boolean;
  executionStatus: "completed" | "partial" | "not_completed" | null;
  comment: string | null;
}
export interface LocalPhoto { id: string; uri: string; name: string; mimeType: string; size?: number; }
export interface Session { token: string; user: User; branchId: number | null; mode: "live" | "demo"; tenant: Tenant; }
export interface Health { ok: boolean; backendReachable: boolean; tenantOrigin?: string; tenant?: Tenant; }
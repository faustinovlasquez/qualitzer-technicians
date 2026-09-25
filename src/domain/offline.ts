import type { CreationInput, CreationResult } from "./creation";
import type { SyncStepAnswer, SyncCompletionPayload } from "./offlineProtocol";
import type { WorkActivityInput } from "./workActivities";
import type { AssignmentGroup, Assignments, AssignmentWork, Attachment, DateRange, GroupScope, LocalPhoto, StepAnswer, User, WorkScope } from "./models";

export type OfflineOperationKind = "create" | "comment" | "answer" | "document" | "timer" | "checklist" | "completion" | "activity";
export type OfflineDeploymentCounts = { [Kind in OfflineOperationKind]: number };
export type OfflineOperationStatus = "pending" | "syncing" | "applied" | "blocked" | "auth_required" | "needs_review" | "conflict";
export type OfflineScope = GroupScope & { workId?: string };
export interface OfflineResourceMetadata { operationId?: string; status?: OfflineOperationStatus; downloaded: boolean; confirmed: boolean; localFileId?: string; }
export interface OfflineAttachment extends Attachment { offline: OfflineResourceMetadata; }
export interface OfflineAssignmentWork extends AssignmentWork { offline: OfflineResourceMetadata; }
export interface OfflineAssignmentGroup extends AssignmentGroup { offline: OfflineResourceMetadata; works: OfflineAssignmentWork[]; }
export type OfflineAnswer = StepAnswer | SyncStepAnswer;
export interface OfflineTimerPayload { status: "in_progress" | "paused"; baseStatus: "pending" | "in_progress" | "paused"; recordedAt?: string; observedAt?: string; previousOperationId?: string; }
export interface OfflineChecklistPayload { checklistId: number; }
export interface OfflineTimerRead { scope: WorkScope; appliedOperationIds: string[]; }
export interface TimerReadAssignmentWork extends AssignmentWork { offlineTimerRead?: OfflineTimerRead; }
export type OfflineCommand = {
  operationId: string;
  scope: WorkScope;
} & (
  | { kind: "comment"; payload: { text: string } }
  | { kind: "answer"; payload: { stepId: string; answer: OfflineAnswer; base: OfflineAnswer } }
  | { kind: "timer"; payload: OfflineTimerPayload }
  | { kind: "checklist"; payload: OfflineChecklistPayload }
  | { kind: "completion"; payload: SyncCompletionPayload }
  | { kind: "activity"; payload: WorkActivityInput }
);
export interface OfflineDocumentMetadata {
  operationId: string;
  scope: OfflineScope;
  stepId?: string;
  sha256: string;
}
export interface OfflineReceipt {
  operationId: string;
  state: "applied" | "conflict" | "rejected" | "needs_review";
  error?: string;
  fileId?: string | number;
  activityId?: number;
}
export interface OfflineSyncPort {
  offlineCapabilities?(companyBranchId: number): Promise<import("./offlineProtocol").SyncCapabilities>;
  offlineCommand(command: OfflineCommand): Promise<OfflineReceipt>;
  offlineReceipt(operationId: string, companyBranchId: number): Promise<OfflineReceipt | null>;
  offlineDocument(metadata: OfflineDocumentMetadata, file: LocalPhoto): Promise<OfflineReceipt>;
}
export interface OfflineFile {
  id: string;
  namespace: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
}
export interface OfflineOperationBase {
  id: string;
  createdAt: number;
  status: OfflineOperationStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  contractRecoveryVersion?: 1;
  dependencyId?: string;
  receipt?: OfflineReceipt;
}
export type OfflineOperation = OfflineOperationBase & (
  | { kind: "create"; input: CreationInput; localGroupId: string; localWorkId: string; result?: CreationResult }
  | { kind: "comment"; scope: WorkScope; text: string }
  | { kind: "answer"; scope: WorkScope; stepId: string; answer: OfflineAnswer; base: OfflineAnswer; wire?: { answer: SyncStepAnswer; base: SyncStepAnswer } }
  | { kind: "document"; scope: OfflineScope; stepId?: string; file: OfflineFile; sourceDraftId?: string; reportText?: string }
  | { kind: "timer"; scope: WorkScope; payload: OfflineTimerPayload; localClock?: { elapsedSeconds: number } }
  | { kind: "checklist"; scope: WorkScope; payload: OfflineChecklistPayload }
  | { kind: "activity"; scope: WorkScope; payload: WorkActivityInput }
  | { kind: "completion"; scope: WorkScope; payload: SyncCompletionPayload; prerequisiteIds: string[]; localClock: { elapsedSeconds: number } }
);
export interface OfflineCoverage { date: string; branchId: number; fetchedAt: number; }
export interface OfflineConnection {
  status: "checking" | "ready" | "offline" | "unreachable" | "service_error" | "auth_required";
  networkConnected: boolean | null;
  foreground: boolean;
  checkedAt: number | null;
  errorCode?: string;
}
export interface OfflineSnapshot {
  storage?: OfflineStorageUsage;
  connection?: OfflineConnection;
  online: boolean;
  preparing: boolean;
  syncing: boolean;
  authBlocked: boolean;
  pending: number;
  conflicts: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  cachedAt?: number;
  coverage: OfflineCoverage[];
  missingDates?: string[];
  awaitingDeploymentByKind?: OfflineDeploymentCounts;
  operations: OfflineOperation[];
}
export interface OfflineStorageUsage {
  usedBytes: number;
  availableBytes: number;
  capacityBytes: number;
  reserveBytes: number;
  deviceAvailableBytes: number | null;
  capacitySource: "device" | "application";
}
export interface OfflineController {
  getSnapshot(): OfflineSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  setForeground(active: boolean): void;
  syncNow(): Promise<void>;
  requestSync?(): Promise<void>;
  retry(operationId: string): Promise<void>;
  hasPendingChanges(): Promise<boolean>;
  prepareWeek(range: DateRange, branchId: number, options?: OfflinePreparationOptions): Promise<void>;
  localAssignments?(range: DateRange, branchId: number): Promise<Assignments>;
  readLocalFile(id: string): Promise<LocalPhoto>;
}
export interface OfflinePreparationOptions {
  byteBudget: number;
  downloadAttachment(attachment: Attachment, scope: OfflineScope, remainingBytes: number): Promise<LocalPhoto>;
}
export interface VerifiedOfflineProfile { user: User; verifiedAt: number; }
export interface OfflineQueuedOutcome {
  operationId: string;
  operationIds: string[];
  kind: OfflineOperationKind;
  localGroupId?: string;
  localWorkId?: string;
  date: string;
  ownsFiles: boolean;
}
export class OfflineQueuedError extends Error implements OfflineQueuedOutcome {
  readonly name = "OfflineQueuedError";
  readonly operationId: string;
  readonly operationIds: string[];
  readonly kind: OfflineOperationKind;
  readonly localGroupId?: string;
  readonly localWorkId?: string;
  readonly date: string;
  readonly ownsFiles: boolean;
  constructor(outcome: OfflineQueuedOutcome) {
    super("Guardado en este dispositivo; pendiente de confirmación del servidor.");
    this.operationId = outcome.operationId;
    this.operationIds = outcome.operationIds;
    this.kind = outcome.kind;
    this.localGroupId = outcome.localGroupId;
    this.localWorkId = outcome.localWorkId;
    this.date = outcome.date;
    this.ownsFiles = outcome.ownsFiles;
  }
}
export function isOfflineQueuedError(error: unknown): error is OfflineQueuedError { return error instanceof OfflineQueuedError; }
export class OfflineUnavailableError extends Error {
  constructor(readonly code: string) { super(code); this.name = "OfflineUnavailableError"; }
}
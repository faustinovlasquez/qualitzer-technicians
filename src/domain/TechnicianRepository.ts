import type { Assignments, Attachment, CommentPage, DateRange, GroupScope, Health, LocalPhoto, LoginResult, StatusInput, StepAnswer, User, WorkScope } from "./models";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "./orderLifecycle";
import type { CreationInput, CreationOptions, CreationOptionsQuery, CreationResult } from "./creation";
import type { NotificationDeviceInput, NotificationDeviceResult, NotificationInbox, NotificationReadResult, NotificationStatus, NotificationTestResult } from "./notifications";
import type { OfflineSyncPort } from "./offline";
import type { ChecklistAssignmentPort } from "./checklistAssignment";

export interface TechnicianRepository extends Partial<OfflineSyncPort>, Partial<ChecklistAssignmentPort> {
  createRecord(input: CreationInput): Promise<CreationResult>;
  creationOptions(query: CreationOptionsQuery): Promise<CreationOptions>;
  notificationStatus(branch: number): Promise<NotificationStatus>;
  registerNotificationDevice(input: NotificationDeviceInput): Promise<NotificationDeviceResult>;
  unregisterNotificationDevice(branch: number, installation: string): Promise<void>;
  notificationInbox(branch: number, page: number): Promise<NotificationInbox>;
  readNotification(branch: number, id: string): Promise<NotificationReadResult>;
  testNotification(branch: number): Promise<NotificationTestResult>;
  health(): Promise<Health>;
  login(username: string, password: string): Promise<LoginResult>;
  me(branchId?: number): Promise<User>;
  logout(): Promise<void>;
  forcePassword(password: string, confirmation: string): Promise<LoginResult>;
  assignments(range: DateRange, branchId: number): Promise<Assignments>;
  status(scope: WorkScope, input: StatusInput): Promise<void>;
  answer(scope: WorkScope, stepId: string, answer: StepAnswer): Promise<void>;
  files(scope: WorkScope): Promise<Attachment[]>;
  stepFiles(scope: WorkScope, stepId: string): Promise<Attachment[]>;
  upload(scope: WorkScope, photos: LocalPhoto[], stepId?: string): Promise<void>;
  report(scope: WorkScope, note: string): Promise<void>;
  comments(scope: WorkScope, page: number): Promise<CommentPage>;
  addComment(scope: WorkScope, text: string): Promise<void>;
  uploadDocuments(scope: WorkScope, files: LocalPhoto[], stepId?: string): Promise<void>;
  deleteFile(scope: WorkScope, fileId: string, stepId?: string): Promise<void>;
  groupFiles(scope: GroupScope): Promise<Attachment[]>;
  uploadGroupFiles(scope: GroupScope, files: LocalPhoto[]): Promise<void>;
  deleteGroupFile(scope: GroupScope, fileId: string): Promise<void>;
  orderDelivery(scope: GroupScope): Promise<MaintenanceDeliveryContext>;
  startOrder(scope: GroupScope): Promise<void>;
  deliverOrder(scope: GroupScope, input: MaintenanceDeliveryInput): Promise<void>;
}
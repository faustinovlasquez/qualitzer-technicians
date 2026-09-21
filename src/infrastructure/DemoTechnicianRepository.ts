import type { TechnicianRepository } from "../domain/TechnicianRepository";
import { userSignatureInputSchema, type UserSignature, type UserSignatureInput, type UserSignatureOptions } from "../domain/userSignatures";
import * as Crypto from "expo-crypto";
import type { OfflineCommand, OfflineDocumentMetadata, OfflineReceipt } from "../domain/offline";
import { syncAnswerFromStep, syncAnswersEqual, syncResponseForStep, type SyncCommand } from "../domain/offlineProtocol";
import { normalizeChecklistAnswer } from "../domain/checklistProgress";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../domain/orderLifecycle";
import { isChecklistStepSatisfied } from "../domain/checklistProgress";
import type { Attachment, CommentPage, DateRange, GroupScope, LocalPhoto, LoginResult, StatusInput, StepAnswer, WorkComment, WorkScope } from "../domain/models";
import { makeDemoData, demoUser } from "./demoData";
import { photoDataUri, photoSnapshot } from "./photos";
import { DemoOfflineStore } from "./offlineDemo";
import type { CreationInput, CreationOptionsQuery } from "../domain/creation";
import type { NotificationDeviceInput } from "../domain/notifications";
import { DemoCreationStore, demoCreationOptions } from "./creationDemo";
import { DemoNotifications } from "./notificationsDemo";
import { DemoChecklistAssignments } from "./checklistAssignmentDemo";
import type { ChecklistCatalogQuery } from "../domain/checklistAssignment";
import { isWorkActivity, workActivityInputSchema, type WorkActivitiesPort } from "../domain/workActivities";

export class DemoTechnicianRepository implements TechnicianRepository {
  private data = makeDemoData();
  private profileSignatures: UserSignature[] = [];
  private nextSignatureId = 1;

  async userSignatures(branchId: number): Promise<UserSignatureOptions> {
    if (!demoUser.accessBranchs.some(branch => branch.id === branchId)) throw new Error("USER_SIGNATURE_BRANCH_NOT_ASSIGNED");
    const options = this.profileSignatures.map(signature => ({ ...signature, isDefaultForBranch: signature.branches.some(branch => branch.value === String(branchId)) }));
    const defaultSignatureId = options.find(signature => signature.isDefaultForBranch)?.id ?? null;
    return structuredClone({ userId: demoUser.id, companyBranchId: branchId, options, defaultSignatureId, selectedSignatureId: defaultSignatureId });
  }

  async saveUserSignature(branchId: number, value: UserSignatureInput): Promise<UserSignatureOptions> {
    await this.userSignatures(branchId);
    const input = userSignatureInputSchema.parse(value);
    const previous = this.profileSignatures.find(signature => signature.id === input.id);
    if (input.id !== undefined && !previous) throw new Error("USER_SIGNATURE_NOT_FOUND");
    if (input.branchIds.some(id => !demoUser.accessBranchs.some(branch => branch.id === id))) throw new Error("USER_SIGNATURE_BRANCH_NOT_ASSIGNED");
    if (this.profileSignatures.some(signature => signature.id !== input.id && signature.branches.some(branch => input.branchIds.includes(Number(branch.value))))) throw new Error("USER_SIGNATURE_BRANCH_DUPLICATED");
    const id = input.id ?? this.nextSignatureId++;
    const saved: UserSignature = { id, value: String(id), label: input.signatureName, signatureName: input.signatureName,
      signatureEmail: input.signatureEmail, signaturePhone: input.signaturePhone,
      signatureImage: input.signatureImage === undefined ? previous?.signatureImage ?? null : input.signatureImage,
      isDefaultForBranch: input.branchIds.includes(branchId), branches: input.branchIds.map(id => ({ value: String(id), label: demoUser.accessBranchs.find(branch => branch.id === id)?.name ?? "" })) };
    this.profileSignatures = [...this.profileSignatures.filter(signature => signature.id !== id), saved];
    return { ...await this.userSignatures(branchId), selectedSignatureId: id };
  }

  async deleteUserSignature(branchId: number, signatureId: number): Promise<UserSignatureOptions> {
    await this.userSignatures(branchId);
    if (!this.profileSignatures.some(signature => signature.id === signatureId)) throw new Error("USER_SIGNATURE_NOT_FOUND");
    this.profileSignatures = this.profileSignatures.filter(signature => signature.id !== signatureId);
    return this.userSignatures(branchId);
  }
  private activityFilesById = new Map<string, Attachment[]>();
  activities: WorkActivitiesPort["activities"] = async scope => structuredClone((this.find(scope).work.activities ?? []).filter(isWorkActivity));
  createActivity: WorkActivitiesPort["createActivity"] = async (scope, input) => {
    const work = this.find(scope).work;
    if (work.status === "completed" || work.status === "delivered") throw new Error("El trabajo es de solo lectura.");
    const value = workActivityInputSchema.parse(input);
    const id = ++this.nextFileId;
    work.activities = [...(work.activities ?? []), { ...value, id, isStarted: false, isCompleted: false, technicalDocuments: [] }];
    return { id };
  };
  updateActivity: WorkActivitiesPort["updateActivity"] = async (scope, id, input) => {
    const work = this.find(scope).work;
    const activity = work.activities?.find(item => item.id === id && isWorkActivity(item));
    if (!activity || work.status === "completed" || work.status === "delivered") throw new Error("No se puede editar esta actividad.");
    Object.assign(activity, workActivityInputSchema.parse(input));
  };
  completeActivity: WorkActivitiesPort["completeActivity"] = async (scope, id, isCompleted = true) => {
    const work = this.find(scope).work;
    const activity = work.activities?.find(item => item.id === id);
    if (!activity || work.status === "completed" || work.status === "delivered") throw new Error("No se puede completar esta actividad.");
    activity.isStarted = true; activity.isCompleted = isCompleted;
  };
  activityFiles: WorkActivitiesPort["activityFiles"] = async (scope, id) => {
    if (!(await this.activities(scope)).some(activity => activity.id === id)) throw new Error("Actividad no encontrada.");
    return structuredClone(this.activityFilesById.get(`${this.key(scope)}:${id}`) ?? []);
  };
  deleteActivity: WorkActivitiesPort["deleteActivity"] = async (scope, id) => {
    const work = this.find(scope).work;
    if (work.status === "completed" || work.status === "delivered") throw new Error("El trabajo es de solo lectura.");
    if (!work.activities?.some(activity => activity.id === id && isWorkActivity(activity))) throw new Error("Actividad no encontrada.");
    work.activities = work.activities.filter(activity => activity.id !== id || !isWorkActivity(activity));
  };
  deleteActivityFile: WorkActivitiesPort["deleteActivityFile"] = async (scope, id, fileId) => {
    const files = await this.activityFiles(scope, id);
    const work = this.find(scope).work;
    if (work.status === "completed" || work.status === "delivered") throw new Error("El trabajo es de solo lectura.");
    if (!files.some(file => String(file.id) === fileId)) throw new Error("Archivo de actividad no encontrado.");
    this.activityFilesById.set(`${this.key(scope)}:${id}`, files.filter(file => String(file.id) !== fileId));
  };
  uploadActivityFiles: WorkActivitiesPort["uploadActivityFiles"] = async (scope, id, files) => {
    await this.activityFiles(scope, id);
    const work = this.find(scope).work;
    if (work.status === "completed" || work.status === "delivered") throw new Error("El trabajo es de solo lectura.");
    const key = `${this.key(scope)}:${id}`;
    for (const file of files) this.activityFilesById.set(key, [...(this.activityFilesById.get(key) ?? []), { id: ++this.nextFileId, name: file.name, type: file.mimeType, url: await photoDataUri(file) }]);
  };
  reopenWork: WorkActivitiesPort["reopenWork"] = async scope => {
    const { group, work } = this.find(scope);
    if (work.status !== "delivered") throw new Error("Solo se puede reabrir un trabajo entregado.");
    work.status = group.type === "internal_maintenance" ? "paused" : "pending";
    if (group.type !== "internal_maintenance") { work.elapsedSeconds = 0; work.firstInProgressTime = null; }
  };
  private checklistAssignments = new DemoChecklistAssignments(this.data.groups.flatMap((group) => group.works.flatMap((work) => work.checklists)));
  async checklistOptions(scope: WorkScope, query: ChecklistCatalogQuery) {
    if (!demoUser.accessBranchs.some((branch) => branch.id === scope.companyBranchId)) throw new Error("Sucursal no autorizada.");
    return this.checklistAssignments.options(this.find(scope).work, query);
  }
  async attachChecklist(scope: WorkScope, checklistId: number) {
    if (!demoUser.accessBranchs.some((branch) => branch.id === scope.companyBranchId)) throw new Error("Sucursal no autorizada.");
    return this.checklistAssignments.attach(this.find(scope).work, checklistId);
  }
  private filesByWork = new Map<string, Attachment[]>();
  private reportsByWork = new Map<string, string[]>();
  private commentsByWork = new Map<string, WorkComment[]>();
  private filesByGroup = new Map<string, Attachment[]>();
  private nextFileId = 10000;
  private orderDeliveries = new Map<string, MaintenanceDeliveryInput>();
  private notifications = new DemoNotifications();
  private offline = new DemoOfflineStore({
    branchId: demoUser.accessBranchs[0]!.id,
    hash: async (bytes) => Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    readFile: photoSnapshot,
    command: (input) => this.applyOfflineCommand(input),
    document: async (input, file) => {
      const scope = { ...input.scope, workId: input.scope.workId === undefined ? undefined : String(input.scope.workId) };
      if (scope.workId === undefined) await this.uploadGroupFiles(scope, [file]);
      else await this.uploadDocuments({ ...scope, workId: scope.workId }, [file], input.stepId === undefined ? undefined : String(input.stepId));
    },
  });
  offlineCommand(input: OfflineCommand) { return this.offline.command(input); }
  offlineReceipt(operationId: string, companyBranchId: number) { return this.offline.receipt(operationId, companyBranchId); }
  offlineDocument(input: OfflineDocumentMetadata, file: LocalPhoto) { return this.offline.document(input, file); }
  private async applyOfflineCommand(input: SyncCommand): Promise<OfflineReceipt | void> {
    if (input.scope.workId === undefined) return { operationId: input.operationId, state: "rejected", error: "MOBILE_SYNC_COMMENT_WORK_REQUIRED" };
    const scope = { ...input.scope, workId: String(input.scope.workId) };
    if (input.kind === "comment") { await this.addComment(scope, input.payload.text); return; }
    if (input.kind === "timer" || input.kind === "checklist") {
      const { work } = this.find(scope);
      if (!work.canExecute || work.status === "completed" || work.status === "delivered") return { operationId: input.operationId, state: "rejected", error: "MOBILE_SYNC_ACTOR_NOT_AUTHORIZED" };
      if (scope.startDate !== scope.endDate || scope.startDate !== work.scheduledDate.slice(0, 10)) return { operationId: input.operationId, state: "rejected", error: "MOBILE_SYNC_INVALID_DATE_RANGE" };
      if (input.kind === "checklist") { await this.attachChecklist(scope, input.payload.checklistId); return; }
      if (work.status !== input.payload.baseStatus) return { operationId: input.operationId, state: "conflict", error: "MOBILE_SYNC_STATUS_CONFLICT" };
      if (input.payload.status === "paused" && work.status !== "in_progress") return { operationId: input.operationId, state: "rejected", error: "MOBILE_SYNC_INVALID_STATUS" };
      await this.status(scope, { status: input.payload.status });
      return;
    }
    const step = this.find(scope).work.checklists.flatMap((list) => list.steps).find((item) => String(item.stepId) === String(input.payload.stepId));
    if (!step) return { operationId: input.operationId, state: "rejected", error: "MOBILE_SYNC_STEP_NOT_FOUND" };
    if (!syncAnswersEqual(syncAnswerFromStep(step), input.payload.base)) return { operationId: input.operationId, state: "conflict", error: "MOBILE_SYNC_BASE_CONFLICT" };
    const answer = input.payload.answer;
    let responseValue: StepAnswer["responseValue"];
    try { responseValue = syncResponseForStep(step, answer); }
    catch { return { operationId: input.operationId, state: "rejected", error: "MOBILE_SYNC_INVALID_ANSWER" }; }
    const normalized = normalizeChecklistAnswer(step, { responseValue, isCompleted: false, comment: answer.comment, executionStatus: step.executionStatus });
    await this.answer(scope, String(input.payload.stepId), { ...normalized, executionStatus: step.executionStatus });
    if (step.type === "validation") step.isCompleted = answer.isCompleted;
  }
  private creations = new DemoCreationStore((group, initialComment) => {
    this.data.groups.push(group);
    if (initialComment) this.commentsByWork.set(`${group.id}:${group.works[0]!.id}`, [{ id: `creation-${group.id}`, text: initialComment, createdAt: new Date().toISOString(), author: { id: demoUser.id, name: `${demoUser.name} ${demoUser.lastnames}` }, files: [] }]);
  });
  async createRecord(input: CreationInput) { return this.creations.create(input); }
  async creationOptions(query: CreationOptionsQuery) { return demoCreationOptions(query); }
  notificationStatus(branch: number) { return this.notifications.notificationStatus(branch); }
  registerNotificationDevice(input: NotificationDeviceInput) { return this.notifications.registerNotificationDevice(input); }
  unregisterNotificationDevice(branch: number, installation: string) { return this.notifications.unregisterNotificationDevice(branch, installation); }
  notificationInbox(branch: number, page: number, unreadOnly?: boolean) { return this.notifications.notificationInbox(branch, page, unreadOnly); }
  readNotification(branch: number, id: string) { return this.notifications.readNotification(branch, id); }
  deleteNotification(branch: number, id: string) { return this.notifications.deleteNotification(branch, id); }
  testNotification(branch: number) { return this.notifications.testNotification(branch); }
  async health() { return { ok: true, backendReachable: false, tenantOrigin: "Demostración local" }; }
  async login(): Promise<LoginResult> { return { token: "demo", username: "Alex", email: demoUser.email, nextStep: "DONE" }; }
  async me() { return demoUser; }
  async logout() {}
  async forcePassword() { return this.login(); }
  private key(scope: WorkScope) { return `${scope.groupId}:${scope.workId}`; }
  private find(scope: WorkScope) {
    const group = this.data.groups.find((item) => item.id === scope.groupId);
    const work = group?.works.find((item) => item.id === scope.workId);
    if (!group || !work) throw new Error("Asignación de demostración no encontrada.");
    return { group, work };
  }
  private updateClock() {
    const now = Date.now();
    const seconds = Math.max(0, Math.floor((now - Date.parse(this.data.generatedAt)) / 1000));
    for (const work of this.data.groups.flatMap((group) => group.works)) if (work.status === "in_progress") { work.elapsedSeconds += seconds; work.executedMinutes = Math.floor(work.elapsedSeconds / 60); }
    this.data.generatedAt = new Date(now).toISOString();
  }
  async assignments(range: DateRange) {
    this.updateClock();
    const result = structuredClone(this.data);
    for (const group of result.groups) if (this.creations.groupIds.has(group.id)) for (const work of group.works) {
      const { schedules: _schedules, ...snapshot } = work;
      work.schedules = [{ date: work.scheduledDate, queryDates: [work.scheduledDate], generatedAt: result.generatedAt, work: snapshot }];
    }
    result.groups = result.groups.map((group) => ({ ...group, works: group.works.filter((work) => work.scheduledDate >= range.startDate && work.scheduledDate <= range.endDate) })).filter((group) => group.works.length > 0);
    const works = result.groups.flatMap((group) => group.works);
    result.summary = { totalGroups: result.groups.length, totalWorks: works.length, activeWorks: works.filter((work) => work.status === "in_progress" || work.status === "paused").length, overdueWorks: works.filter((work) => work.isOverdue).length, plannedMinutes: works.reduce((sum, work) => sum + work.plannedMinutes, 0) };
    return result;
  }
  async status(scope: WorkScope, input: StatusInput) {
    this.updateClock();
    const { group, work } = this.find(scope);
    work.status = input.status;
    if (group.works.every((item) => item.status === "completed" || item.status === "delivered")) group.status = "completed";
    else if (input.status === "in_progress") group.status = "in_progress";
  }
  async answer(scope: WorkScope, stepId: string, answer: StepAnswer) {
    const { work } = this.find(scope);
    const step = work.checklists.flatMap((item) => item.steps).find((item) => String(item.stepId) === stepId);
    if (!step) throw new Error("Paso no encontrado.");
    step.isCompleted = answer.isCompleted;
    step.executionStatus = answer.executionStatus;
    step.comment = answer.comment ?? "";
    if (step.type === "validation") step.selectValue = answer.responseValue === "not_applicable" ? "not_applicable" : "";
    else if (step.type === "select" || step.type === "approval") step.selectValue = String(answer.responseValue);
    else if (step.type === "multiselect") step.optionsSelectValue = Array.isArray(answer.responseValue) ? answer.responseValue : [];
    else step.responseValue = String(answer.responseValue ?? "");
    work.checklistDone = work.checklists.flatMap((list) => list.steps).filter((item) => item.isCompleted || item.selectValue === "not_applicable").length;
  }
  async files(scope: WorkScope) { return this.filesByWork.get(this.key(scope)) ?? []; }
  async stepFiles(scope: WorkScope, stepId: string) { return this.find(scope).work.checklists.flatMap((list) => list.steps).find((step) => String(step.stepId) === stepId)?.attachments ?? []; }
  async upload(scope: WorkScope, photos: LocalPhoto[], stepId?: string) {
    const { work } = this.find(scope);
    const files = await Promise.all(photos.map(async (photo): Promise<Attachment> => ({ id: this.nextFileId++, name: photo.name, url: await photoDataUri(photo), type: photo.mimeType, createdAt: new Date().toISOString(), responsible: { id: 10001, name: "Alex Martínez · Demo" } })));
    if (stepId) {
      const step = work.checklists.flatMap((list) => list.steps).find((item) => String(item.stepId) === stepId);
      if (!step) throw new Error("Paso no encontrado.");
      step.attachments.push(...files);
    } else {
      this.filesByWork.set(this.key(scope), [...await this.files(scope), ...files]);
      work.filesCount += files.length;
    }
  }
  async report(scope: WorkScope, note: string) {
    if (!note.trim()) throw new Error("Escribe un reporte.");
    const key = this.key(scope);
    this.reportsByWork.set(key, [...(this.reportsByWork.get(key) ?? []), note.trim()]);
    this.find(scope).work.commentsCount += 1;
  }
  async comments(scope: WorkScope, page: number): Promise<CommentPage> {
    this.find(scope);
    const data = this.commentsByWork.get(this.key(scope)) ?? [];
    return { data: data.slice(page * 30, (page + 1) * 30), totalRows: data.length, totalPages: Math.ceil(data.length / 30) };
  }
  async addComment(scope: WorkScope, text: string) {
    const { work } = this.find(scope);
    if (!text.trim()) throw new Error("Escribe un comentario.");
    const comment: WorkComment = { id: `demo-${Date.now()}`, text: text.trim(), createdAt: new Date().toISOString(), author: { id: demoUser.id, name: `${demoUser.name} ${demoUser.lastnames}` }, files: [] };
    this.commentsByWork.set(this.key(scope), [comment, ...(this.commentsByWork.get(this.key(scope)) ?? [])]);
    work.commentsCount += 1;
  }
  uploadDocuments(scope: WorkScope, files: LocalPhoto[], stepId?: string) { return this.upload(scope, files, stepId); }
  async deleteFile(scope: WorkScope, fileId: string, stepId?: string) {
    const { work } = this.find(scope);
    if (stepId) {
      const step = work.checklists.flatMap((list) => list.steps).find((item) => String(item.stepId) === stepId);
      if (!step) throw new Error("Paso no encontrado.");
      step.attachments = step.attachments.filter((file) => String(file.id) !== fileId);
    } else {
      this.filesByWork.set(this.key(scope), (await this.files(scope)).filter((file) => String(file.id) !== fileId));
      work.filesCount = (await this.files(scope)).length;
    }
  }
  async groupFiles(scope: GroupScope) { return this.filesByGroup.get(scope.groupId) ?? []; }
  async uploadGroupFiles(scope: GroupScope, files: LocalPhoto[]) {
    if (!this.data.groups.some((group) => group.id === scope.groupId)) throw new Error("OT no encontrada.");
    const uploaded = await Promise.all(files.map(async (file): Promise<Attachment> => ({ id: this.nextFileId++, name: file.name, url: await photoDataUri(file), type: file.mimeType, createdAt: new Date().toISOString() })));
    this.filesByGroup.set(scope.groupId, [...await this.groupFiles(scope), ...uploaded]);
  }
  async deleteGroupFile(scope: GroupScope, fileId: string) { this.filesByGroup.set(scope.groupId, (await this.groupFiles(scope)).filter((file) => String(file.id) !== fileId)); }
  private maintenanceGroup(scope: GroupScope) {
    const group = this.data.groups.find((item) => item.id === scope.groupId && item.type === "internal_maintenance");
    if (!group) throw new Error("OT de mantenimiento no encontrada.");
    return group;
  }
  async orderDelivery(scope: GroupScope): Promise<MaintenanceDeliveryContext> {
    this.updateClock();
    const group = this.maintenanceGroup(scope);
    const delivery = this.orderDeliveries.get(group.id);
    return {
      groupId: group.id, status: group.status, maintenanceType: group.maintenanceType ?? "preventivo",
      finalizationNote: delivery?.note ?? null, damageType: delivery?.faultType === "operative" ? "operacional" : delivery?.faultType === "wear" ? "desgaste" : null,
      durationMinutes: delivery?.durationMinutes ?? null, startedAt: null, finalizedAt: null,
      incompleteChecklists: group.works.flatMap((work) => work.checklists.filter((list) => list.required && !list.steps.every(isChecklistStepSatisfied)).map((list) => `${work.title} — ${list.name}`)),
      suggestedDurationMinutes: Math.round(group.works.reduce((total, work) => total + Math.max(work.executedMinutes, work.elapsedSeconds / 60), 0)),
      canStart: group.status === "pending", canDeliver: group.status !== "completed" && group.status !== "delivered",
      technicianDeliverySupported: true, canTechnicianDeliver: group.status !== "completed" && group.status !== "delivered",
      totalWorks: group.works.length, pendingWorkNames: group.works.filter(work => work.status !== "delivered").map(work => work.title),
      pendingDeliveryChecklists: group.works.flatMap(work => work.checklists.filter(list => !list.steps.every(isChecklistStepSatisfied)).map(list => `${work.title} — ${list.name}`)),
    };
  }
  async startOrder(scope: GroupScope): Promise<void> {
    const group = this.maintenanceGroup(scope);
    if (group.status !== "pending") throw new Error("La OT ya no está pendiente.");
    group.status = "in_progress";
  }
  async deliverOrder(scope: GroupScope, input: MaintenanceDeliveryInput): Promise<void> {
    const context = await this.orderDelivery(scope);
    if (!context.canDeliver || !input.technicianSignature) throw new Error("Completa los requisitos de entrega de la OT.");
    if (input.acknowledgeDelivery !== true) {
      if (context.incompleteChecklists.length) throw new Error("Completa los requisitos de entrega de la OT.");
      if (["correctivo", "detencion"].includes(context.maintenanceType ?? "") && (!input.clientSignature || !input.receivedByName?.trim() || !input.faultType || input.faultType === "undetermined")) throw new Error("Completa el tipo de falla, receptor y firma del cliente.");
    }
    this.orderDeliveries.set(scope.groupId, structuredClone(input));
    this.maintenanceGroup(scope).status = "delivered";
    if (input.acknowledgeDelivery) for (const work of this.maintenanceGroup(scope).works) { work.status = "delivered"; }
  }
}
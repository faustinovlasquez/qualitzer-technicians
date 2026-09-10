import type { TechnicianRepository } from "../domain/TechnicianRepository";
import type { Assignments, Attachment, CommentPage, DateRange, GroupScope, LocalPhoto, Session, StepAnswer, User, WorkScope } from "../domain/models";
import { creationInputSchema, creationOptionsQuerySchema, creationOptionsSchema, type CreationInput, type CreationOptions, type CreationOptionsQuery, type CreationResult } from "../domain/creation";
import { OfflineQueuedError, OfflineUnavailableError, type OfflineAttachment, type OfflineController, type OfflineFile, type OfflineOperation, type OfflineOperationBase, type OfflinePreparationOptions, type OfflineScope } from "../domain/offline";
import { answerFromStep } from "../domain/format";
import { assignmentDays, dailyRange, mergeDailyAssignments } from "../domain/assignmentSchedule";
import { ApiError, NetworkError } from "../infrastructure/errors";
import { OFFLINE_LIMITS, type CacheEntry, type EngineDependencies } from "./contracts";
import { OfflineEngine, canUseCache, findDraftDocument, resolveScope, sameOfflineUser } from "./engine";
import { offlineUserSchema, putCache, updateState } from "./state";
import { overlayCreations } from "./overlay";
import { syncAnswerFromStep, toSyncAnswer } from "../domain/offlineProtocol";
import { notificationInboxSchema, notificationStatusSchema } from "../domain/notifications";
import { cachedAssignmentsSchema, cachedAttachmentSchema, cachedCommentsSchema, cachedDeliverySchema, resourceCacheKey, sameResource } from "./cacheSchemas";
import type { ChecklistAssignmentPort } from "../domain/checklistAssignment";
import { isServiceFailure, requiresDeployment } from "./connection";

export class OfflineTechnicianRepository implements TechnicianRepository, OfflineController {
  readonly engine: OfflineEngine;
  constructor(readonly remote: TechnicianRepository, readonly session: Session, readonly dependencies: EngineDependencies, private readonly disableProfile: () => Promise<void> = async () => undefined) {
    this.engine = new OfflineEngine(dependencies);
  }
  getSnapshot = () => this.engine.getSnapshot();
  subscribe = (listener: () => void) => this.engine.subscribe(listener);
  start = () => this.engine.start();
  stop = () => this.engine.stop();
  setForeground = (active: boolean) => this.engine.setForeground(active);
  syncNow = () => this.engine.syncNow();
  retry = (id: string) => this.engine.retry(id);
  hasPendingChanges = () => this.engine.hasPendingChanges();
  readLocalFile = (id: string) => this.engine.readLocalFile(id);
  private branch(branchId: number): void {
    if (branchId !== this.dependencies.branchId) throw new OfflineUnavailableError("OFFLINE_BRANCH_NAMESPACE_MISMATCH");
  }
  private async assertReadable(): Promise<void> {
    if ((await this.dependencies.store.read(this.dependencies.namespace)).authBlocked) throw new OfflineUnavailableError("OFFLINE_AUTH_REQUIRED");
    if (this.dependencies.canAccessLocal && !await this.dependencies.canAccessLocal()) throw new OfflineUnavailableError("OFFLINE_AUTH_REQUIRED");
  }
  private async cacheEntry(key: string): Promise<CacheEntry | undefined> {
    await this.assertReadable();
    const state = await this.dependencies.store.read(this.dependencies.namespace);
    const revoked = state.revokedResources.find((entry) => entry.key === key);
    if (revoked) throw new ApiError(revoked.status, "OFFLINE_RESOURCE_ACCESS_REVOKED", "El acceso al recurso fue revocado.");
    const entry = state.cache.filter((entry) => entry.key === key).sort((left, right) => right.fetchedAt - left.fetchedAt)[0];
    if (entry?.coverage && (entry.coverage.branchId !== this.dependencies.branchId || key !== `assignments:${entry.coverage.date}`)) throw new OfflineUnavailableError("OFFLINE_CACHE_SCOPE_MISMATCH");
    return entry;
  }
  private async remember(key: string, value: object, date?: string): Promise<void> {
    const { now, store, namespace, branchId } = this.dependencies;
    const fetchedAt = now();
    await updateState(store, namespace, (state) => {
      putCache(state, { key, json: JSON.stringify(value), fetchedAt, ...(date ? { coverage: { date, branchId, fetchedAt } } : {}) });
      state.revokedResources = state.revokedResources.filter((entry) => entry.key !== key);
    });
    await this.engine.refresh();
  }
  private async read<T extends object>(key: string, remote: () => Promise<T>, decode: (json: string) => T, date?: string): Promise<T> {
    await this.assertReadable();
    let generation = this.engine.getConnectionGeneration();
    let data: T;
    try {
      const connected = await this.dependencies.connectivity.current();
      if (generation === this.engine.getConnectionGeneration()) {
        this.engine.noteNetworkState(connected);
        generation = this.engine.getConnectionGeneration();
      }
      if (connected === false) throw new NetworkError("network");
      data = await remote();
      this.engine.noteConnectionSuccess(generation);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await this.engine.blockAuth();
      else if (error instanceof NetworkError || isServiceFailure(error)) this.engine.noteConnectionFailure(error, generation);
      if (error instanceof ApiError && [403, 404].includes(error.status) && !requiresDeployment(error.code)) {
        const status = error.status === 403 ? 403 : 404;
        await updateState(this.dependencies.store, this.dependencies.namespace, (state) => {
          state.cache = state.cache.filter((entry) => entry.key !== key);
          state.revokedResources = state.revokedResources.filter((entry) => entry.key !== key).concat({ key, status });
        });
      }
      if (!canUseCache(error)) throw error;
      const entry = await this.cacheEntry(key);
      if (!entry) throw new OfflineUnavailableError("OFFLINE_CACHE_MISS");
      return decode(entry.json);
    }
    await this.remember(key, data, date);
    return data;
  }
  async me(branchId = this.dependencies.branchId): Promise<User> {
    this.branch(branchId);
    return this.read("me", async () => {
      const user = await this.remote.me(branchId);
      if (!sameOfflineUser(this.session.user, user, branchId)) throw new ApiError(401, "OFFLINE_IDENTITY_CHANGED", "La identidad cambió.");
      await this.dependencies.onVerified?.(user);
      return offlineUserSchema.parse(user);
    }, (json) => {
      const user = offlineUserSchema.parse(JSON.parse(json));
      if (!sameOfflineUser(this.session.user, user, branchId)) throw new OfflineUnavailableError("OFFLINE_CACHE_IDENTITY_MISMATCH");
      return user;
    });
  }
  async assignments(range: DateRange, branchId: number): Promise<Assignments> {
    this.branch(branchId);
    const snapshots: Array<{ date: string; data: Assignments }> = [];
    const missingDates: string[] = [];
    for (const date of assignmentDays(range)) {
      let data: Assignments;
      try {
        data = await this.read(`assignments:${date}`, async () => {
          const value = await this.remote.assignments(dailyRange(date), branchId);
          if (value.technician.id !== this.session.user.workerId) throw new ApiError(401, "OFFLINE_WORKER_CHANGED", "La identidad cambió.");
          return value;
        }, (json) => {
          const value = cachedAssignmentsSchema.parse(JSON.parse(json));
          if (value.technician.id !== this.session.user.workerId) throw new OfflineUnavailableError("OFFLINE_CACHE_IDENTITY_MISMATCH");
          return value;
        }, date);
      } catch (error) {
        const local = (await this.dependencies.store.read(this.dependencies.namespace)).operations.some((op) => op.kind === "create" && op.input.schedule.date === date);
        if (!(error instanceof OfflineUnavailableError) || error.code !== "OFFLINE_CACHE_MISS") throw error;
        missingDates.push(date);
        if (!local) continue;
        data = { generatedAt: "", technician: { id: this.session.user.workerId, name: this.session.user.name, allowEditExecutionTime: false }, summary: { totalGroups: 0, totalWorks: 0, activeWorks: 0, overdueWorks: 0, plannedMinutes: 0 }, groups: [] };
      }
      const state = await this.dependencies.store.read(this.dependencies.namespace);
      snapshots.push({ date, data: overlayCreations(data, date, state.operations, this.session) });
    }
    this.engine.setMissingDates(missingDates);
    if (!snapshots.length) throw new OfflineUnavailableError("OFFLINE_CACHE_MISS");
    return mergeDailyAssignments(snapshots, range.startDate);
  }
  async creationOptions(query: CreationOptionsQuery): Promise<CreationOptions> {
    const parsed = creationOptionsQuerySchema.parse(query);
    this.branch(parsed.companyBranchId);
    const normalized = { companyBranchId: parsed.companyBranchId, ...(parsed.kind ? { kind: parsed.kind } : {}), search: parsed.search ?? "", page: parsed.page ?? 0,
      ...(parsed.internalNumber === undefined ? {} : { internalNumber: parsed.internalNumber }) };
    return this.read(`options:${JSON.stringify(normalized)}`, () => this.remote.creationOptions(normalized), (json) => {
      const options = creationOptionsSchema.parse(JSON.parse(json));
      if (options.companyBranchId !== parsed.companyBranchId || options.userId !== this.session.user.id || options.workerId !== this.session.user.workerId) throw new OfflineUnavailableError("OFFLINE_CACHE_IDENTITY_MISMATCH");
      return options;
    });
  }
  private base(id = this.dependencies.uuid()): OfflineOperationBase { return { id, createdAt: this.dependencies.now(), status: "pending", attempts: 0, nextAttemptAt: 0 }; }
  private async dependency(scope: OfflineScope): Promise<string | undefined> {
    this.branch(scope.companyBranchId);
    await this.assertReadable();
    if (!scope.groupId.startsWith("local-") && !scope.workId?.startsWith("local-")) return undefined;
    const state = await this.dependencies.store.read(this.dependencies.namespace);
    const parent = state.operations.find((op) => op.kind === "create" && op.localGroupId === scope.groupId && (!scope.workId || op.localWorkId === scope.workId));
    if (!parent) throw new OfflineUnavailableError("OFFLINE_UNKNOWN_LOCAL_RESOURCE");
    return parent.id;
  }
  private async finish(operations: OfflineOperation[]): Promise<void> {
    try {
      await this.engine.syncNow();
      const state = await this.dependencies.store.read(this.dependencies.namespace);
      if (operations.every((op) => state.operations.some((entry) => entry.id === op.id && entry.status === "applied"))) return;
    } catch { /* The queue owns these drafts even if confirmation cannot be read. */ }
    const first = operations[0];
    if (!first) return;
    throw new OfflineQueuedError({ operationId: first.id, operationIds: operations.map((op) => op.id), kind: first.kind, date: first.kind === "create" ? first.input.schedule.date : first.scope.startDate,
      localGroupId: first.kind === "create" ? first.localGroupId : first.scope.groupId,
      localWorkId: first.kind === "create" ? first.localWorkId : first.scope.workId, ownsFiles: operations.some((op) => op.kind === "document") });
  }
  async createRecord(input: CreationInput): Promise<CreationResult> {
    const parsed = creationInputSchema.parse(input);
    this.branch(parsed.companyBranchId);
    const operation: OfflineOperation = { ...this.base(parsed.clientRequestId), kind: "create", input: parsed, localGroupId: `local-${parsed.clientRequestId}`, localWorkId: `local-${parsed.clientRequestId}` };
    await this.engine.enqueue([operation]);
    await this.finish([operation]);
    const current = (await this.dependencies.store.read(this.dependencies.namespace)).operations.find((op) => op.id === operation.id);
    if (!current || current.kind !== "create" || !current.result) throw new OfflineUnavailableError("OFFLINE_CREATION_RECEIPT_MISSING");
    return current.result;
  }
  async addComment(scope: WorkScope, text: string): Promise<void> {
    if (!text.trim()) throw new OfflineUnavailableError("OFFLINE_EMPTY_COMMENT");
    const operation: OfflineOperation = { ...this.base(), kind: "comment", scope, text, dependencyId: await this.dependency(scope) };
    const registered = await this.engine.enqueue([operation], { reusePendingComments: true });
    await this.finish(registered);
  }
  async answer(scope: WorkScope, stepId: string, answer: StepAnswer): Promise<void> {
    const dependencyId = await this.dependency(scope);
    if (dependencyId) throw new OfflineUnavailableError("OFFLINE_LOCAL_CHECKLIST_NOT_AVAILABLE");
    const entry = await this.cacheEntry(`assignments:${scope.startDate}`);
    if (!entry) throw new OfflineUnavailableError("OFFLINE_ANSWER_BASE_MISSING");
    const assignments = cachedAssignmentsSchema.parse(JSON.parse(entry.json));
    if (assignments.technician.id !== this.session.user.workerId) throw new OfflineUnavailableError("OFFLINE_CACHE_IDENTITY_MISMATCH");
    const work = assignments.groups.find((group) => group.id === scope.groupId)?.works.find((item) => item.id === scope.workId);
    const step = work?.checklists.flatMap((checklist) => checklist.steps).find((item) => String(item.stepId) === stepId);
    if (!step) throw new OfflineUnavailableError("OFFLINE_ANSWER_BASE_MISSING");
    const base = answerFromStep(step);
    const wire = { answer: toSyncAnswer(step.type, answer), base: syncAnswerFromStep(step) };
    const operation: OfflineOperation = { ...this.base(), kind: "answer", scope, stepId, answer, base, wire };
    await this.engine.enqueue([operation]);
    await this.finish([operation]);
  }
  private async documents(scope: OfflineScope, photos: LocalPhoto[], stepId?: string): Promise<void> {
    if (!photos.length) return;
    const dependencyId = await this.dependency(scope);
    if (dependencyId && stepId) throw new OfflineUnavailableError("OFFLINE_LOCAL_CHECKLIST_NOT_AVAILABLE");
    const owned: OfflineFile[] = [];
    const operations: OfflineOperation[] = [];
    let registered: OfflineOperation[] = [];
    let committed = false;
    try {
      for (const photo of photos) {
        if (!photo.id) throw new OfflineUnavailableError("OFFLINE_SOURCE_DRAFT_ID_REQUIRED");
        const state = await this.dependencies.store.read(this.dependencies.namespace);
        const previous = findDraftDocument([...state.operations, ...operations], this.dependencies.namespace, scope, photo.id, stepId);
        if (previous) {
          await this.verifyDraftPhoto(photo, previous.file);
          operations.push(previous);
          continue;
        }
        const file = await this.dependencies.fileStore.own(this.dependencies.namespace, photo);
        owned.push(file);
        operations.push({ ...this.base(), kind: "document", scope, stepId, file, dependencyId, sourceDraftId: photo.id });
      }
      registered = await this.engine.enqueue(operations);
      committed = true;
    } finally {
      if (!committed) for (const file of owned) await this.dependencies.fileStore.remove(file);
    }
    for (const file of owned) {
      if (!registered.some((op) => op.kind === "document" && op.file.id === file.id)) {
        try { await this.dependencies.fileStore.remove(file); } catch { /* A redundant copy must not invalidate durable ownership. */ }
      }
    }
    await this.finish([...new Map(registered.map((op) => [op.id, op])).values()]);
  }
  private async verifyDraftPhoto(photo: LocalPhoto, file: OfflineFile): Promise<void> {
    if (photo.name !== file.name || photo.mimeType !== file.mimeType || (photo.size !== undefined && photo.size !== file.size)) throw new OfflineUnavailableError("OFFLINE_SOURCE_DRAFT_COLLISION");
    const fileStore = this.dependencies.fileStore;
    if (!fileStore.fingerprint) throw new OfflineUnavailableError("OFFLINE_SOURCE_VERIFICATION_UNAVAILABLE");
    const fingerprint = await fileStore.fingerprint(photo);
    if (fingerprint && (fingerprint.size !== file.size || fingerprint.sha256 !== file.sha256)) throw new OfflineUnavailableError("OFFLINE_SOURCE_DRAFT_COLLISION");
    await fileStore.resolveURI(file);
  }
  upload = (scope: WorkScope, photos: LocalPhoto[], stepId?: string) => this.documents(scope, photos, stepId);
  uploadDocuments = (scope: WorkScope, photos: LocalPhoto[], stepId?: string) => this.documents(scope, photos, stepId);
  uploadGroupFiles = (scope: GroupScope, photos: LocalPhoto[]) => this.documents(scope, photos);

  private async fileList(scope: OfflineScope, stepId: string | undefined, load: () => Promise<Attachment[]>): Promise<Attachment[]> {
    this.branch(scope.companyBranchId);
    await this.assertReadable();
    const local = !!await this.dependency(scope);
    let files: Attachment[] = [];
    if (!local) {
      try { files = await this.read(resourceCacheKey("files", scope, stepId), load, (json) => cachedAttachmentSchema.array().parse(JSON.parse(json))); }
      catch (error) {
        const state = await this.dependencies.store.read(this.dependencies.namespace);
        if (!(error instanceof OfflineUnavailableError) || error.code !== "OFFLINE_CACHE_MISS" || !state.operations.some((op) => op.kind === "document" && sameResource(op.scope, scope) && op.stepId === stepId)) throw error;
      }
    }
    const state = await this.dependencies.store.read(this.dependencies.namespace);
    for (const op of state.operations) {
      if (op.kind !== "document" || op.stepId !== stepId) continue;
      const resolved = resolveScope(op.scope, state.operations);
      const matches = sameResource(op.scope, scope) || (!!resolved && sameResource(resolved, scope));
      if (!matches) continue;
      const confirmed = op.status === "applied";
      const canonicalId = confirmed ? op.receipt?.fileId : undefined;
      const canonical = canonicalId === undefined ? undefined : files.find((file) => String(file.id) === String(canonicalId));
      if (canonical) {
        const index = files.indexOf(canonical);
        const bound: OfflineAttachment = { ...canonical, url: await this.dependencies.fileStore.resolveURI(op.file), offline: { operationId: op.id, status: op.status, downloaded: true, confirmed: true, localFileId: op.file.id } };
        files[index] = bound;
        continue;
      }
      if (confirmed && canonicalId === undefined) continue;
      const localFile: OfflineAttachment = { id: canonicalId ?? `local-${op.file.id}`, name: op.file.name, type: op.file.mimeType, size: op.file.size, url: await this.dependencies.fileStore.resolveURI(op.file), createdAt: new Date(op.createdAt).toISOString(), offline: { operationId: op.id, status: op.status, downloaded: true, confirmed, localFileId: op.file.id } };
      files.push(localFile);
    }
    return Promise.all(files.map(async (file): Promise<Attachment> => {
      if ("offline" in file) return file;
      const cached = state.attachments.find((entry) => entry.attachmentId === String(file.id) && sameResource(entry.scope, scope) && entry.stepId === stepId);
      const attachment: OfflineAttachment = { ...file, offline: { downloaded: false, confirmed: true } };
      if (cached) {
        attachment.url = await this.dependencies.fileStore.resolveURI(cached.file);
        attachment.offline = { downloaded: true, confirmed: true, localFileId: cached.file.id };
      }
      return attachment;
    }));
  }
  files = (scope: WorkScope) => this.fileList(scope, undefined, () => this.remote.files(scope));
  stepFiles = (scope: WorkScope, stepId: string) => this.fileList(scope, stepId, () => this.remote.stepFiles(scope, stepId));
  groupFiles = (scope: GroupScope) => this.fileList(scope, undefined, () => this.remote.groupFiles(scope));
  async comments(scope: WorkScope, page: number): Promise<CommentPage> {
    this.branch(scope.companyBranchId);
    await this.assertReadable();
    if (await this.dependency(scope)) return { data: [], totalRows: 0, totalPages: 0 };
    return this.read(resourceCacheKey("comments", scope, page), () => this.remote.comments(scope, page), (json) => cachedCommentsSchema.parse(JSON.parse(json)));
  }
  private async onlineOnly<T>(action: () => Promise<T>, scope?: OfflineScope): Promise<T> {
    await this.assertReadable();
    if (scope) { this.branch(scope.companyBranchId); if (await this.dependency(scope)) throw new OfflineUnavailableError("OFFLINE_ACTION_REQUIRES_SERVER_RESOURCE"); }
    const connected = await this.dependencies.connectivity.current();
    this.engine.noteNetworkState(connected);
    if (connected === false) throw new OfflineUnavailableError("OFFLINE_ACTION_REQUIRES_CONNECTION");
    const generation = this.engine.getConnectionGeneration();
    try {
      if (!this.getSnapshot().online) {
        await this.engine.revalidate();
        this.engine.noteConnectionSuccess(generation);
      }
      if (!this.getSnapshot().online || generation !== this.engine.getConnectionGeneration()) throw new OfflineUnavailableError("OFFLINE_ACTION_REQUIRES_CONNECTION");
      const result = await action();
      this.engine.noteConnectionSuccess(generation);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await this.engine.blockAuth();
      else if (error instanceof NetworkError || isServiceFailure(error)) this.engine.noteConnectionFailure(error, generation);
      throw error;
    }
  }
  private checklistScope(scope: WorkScope): void {
    this.branch(scope.companyBranchId);
    if (!/^[1-9]\d*$/.test(scope.workId) || !/^(?:external|maintenance|direct(?:-np)?)-[1-9]\d*$/.test(scope.groupId)) throw new OfflineUnavailableError("OFFLINE_ACTION_REQUIRES_SERVER_RESOURCE");
  }
  checklistOptions: ChecklistAssignmentPort["checklistOptions"] = async (scope, query) => {
    this.checklistScope(scope);
    return this.onlineOnly(() => {
      if (!this.remote.checklistOptions) throw new ApiError(501, "CHECKLIST_ASSIGNMENT_CONTRACT_UNAVAILABLE", "El servidor no permite asociar checklists.");
      return this.remote.checklistOptions(scope, query);
    }, scope);
  };
  attachChecklist: ChecklistAssignmentPort["attachChecklist"] = async (scope, checklistId) => {
    this.checklistScope(scope);
    return this.onlineOnly(() => {
      if (!this.remote.attachChecklist) throw new ApiError(501, "CHECKLIST_ASSIGNMENT_CONTRACT_UNAVAILABLE", "El servidor no permite asociar checklists.");
      return this.remote.attachChecklist(scope, checklistId);
    }, scope);
  };
  status: TechnicianRepository["status"] = (scope, input) => this.onlineOnly(() => this.remote.status(scope, input), scope);
  report: TechnicianRepository["report"] = (scope, note) => this.onlineOnly(() => this.remote.report(scope, note), scope);
  deleteFile: TechnicianRepository["deleteFile"] = (scope, id, stepId) => this.onlineOnly(() => this.remote.deleteFile(scope, id, stepId), scope);
  deleteGroupFile: TechnicianRepository["deleteGroupFile"] = (scope, id) => this.onlineOnly(() => this.remote.deleteGroupFile(scope, id), scope);
  startOrder: TechnicianRepository["startOrder"] = (scope) => this.onlineOnly(() => this.remote.startOrder(scope), scope);
  deliverOrder: TechnicianRepository["deliverOrder"] = (scope, input) => this.onlineOnly(() => this.remote.deliverOrder(scope, input), scope);
  orderDelivery: TechnicianRepository["orderDelivery"] = async (scope) => {
    this.branch(scope.companyBranchId);
    return this.read(`delivery:${JSON.stringify(scope)}`, () => this.remote.orderDelivery(scope), (json) => cachedDeliverySchema.parse(JSON.parse(json)));
  };
  health: TechnicianRepository["health"] = () => this.remote.health();
  login: TechnicianRepository["login"] = (username, password) => this.remote.login(username, password);
  forcePassword: TechnicianRepository["forcePassword"] = (password, confirmation) => this.onlineOnly(() => this.remote.forcePassword(password, confirmation));
  async logout(): Promise<void> {
    if (await this.hasPendingChanges()) throw new OfflineUnavailableError("OFFLINE_LOGOUT_HAS_PENDING_CHANGES");
    this.stop();
    await this.disableProfile();
    await this.remote.logout();
  }
  notificationStatus: TechnicianRepository["notificationStatus"] = async (branch) => {
    this.branch(branch);
    return this.read("notification-status", () => this.remote.notificationStatus(branch), (json) => notificationStatusSchema.parse(JSON.parse(json)));
  };
  notificationInbox: TechnicianRepository["notificationInbox"] = async (branch, page) => {
    this.branch(branch);
    return this.read(`notification-inbox:${page}`, () => this.remote.notificationInbox(branch, page), (json) => notificationInboxSchema.parse(JSON.parse(json)));
  };
  registerNotificationDevice: TechnicianRepository["registerNotificationDevice"] = (input) => this.onlineOnly(() => this.remote.registerNotificationDevice(input));
  unregisterNotificationDevice: TechnicianRepository["unregisterNotificationDevice"] = (branch, installation) => { this.branch(branch); return this.onlineOnly(() => this.remote.unregisterNotificationDevice(branch, installation)); };
  readNotification: TechnicianRepository["readNotification"] = (branch, id) => { this.branch(branch); return this.onlineOnly(() => this.remote.readNotification(branch, id)); };
  testNotification: TechnicianRepository["testNotification"] = (branch) => { this.branch(branch); return this.onlineOnly(() => this.remote.testNotification(branch)); };
  async prepareWeek(range: DateRange, branchId: number, options?: OfflinePreparationOptions): Promise<void> {
    this.branch(branchId);
    if (assignmentDays(range).length > 7) throw new OfflineUnavailableError("OFFLINE_PREPARE_MAX_SEVEN_DAYS");
    if (options && (!Number.isSafeInteger(options.byteBudget) || options.byteBudget < 0 || options.byteBudget > OFFLINE_LIMITS.totalFileBytes)) throw new OfflineUnavailableError("OFFLINE_INVALID_DOWNLOAD_BUDGET");
    this.engine.setPreparing(true);
    try {
      const data = await this.assignments(range, branchId);
      await this.creationOptions({ companyBranchId: branchId });
      await this.creationOptions({ companyBranchId: branchId, kind: "equipment", page: 0 });
      await this.creationOptions({ companyBranchId: branchId, kind: "specialties", page: 0 });
      const works = data.groups.flatMap((group) => group.works.map((work) => ({ group, work }))).slice(0, OFFLINE_LIMITS.prepareWorks);
      const downloads: Array<{ attachment: Attachment; scope: OfflineScope; stepId?: string }> = [];
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(2, works.length) }, async () => {
        while (cursor < works.length) {
          const { group, work } = works[cursor++];
          const scope: WorkScope = { ...dailyRange(work.schedules?.[0]?.date ?? work.scheduledDate), groupId: group.id, workId: work.id, companyBranchId: branchId };
          const files = await this.files(scope);
          downloads.push(...files.filter((file) => !String(file.id).startsWith("local-")).map((attachment) => ({ attachment, scope })));
          for (const step of work.checklists.flatMap((checklist) => checklist.steps)) {
            const stepId = String(step.stepId);
            const stepFiles = await this.stepFiles(scope, stepId);
            downloads.push(...stepFiles.filter((file) => !String(file.id).startsWith("local-")).map((attachment) => ({ attachment, scope, stepId })));
          }
          await this.comments(scope, 0);
        }
      }));
      for (const group of data.groups.slice(0, OFFLINE_LIMITS.prepareWorks)) {
        const scope: GroupScope = { ...dailyRange(group.works[0]?.schedules?.[0]?.date ?? group.works[0]?.scheduledDate ?? group.scheduledDate), groupId: group.id, companyBranchId: branchId };
        const files = await this.groupFiles(scope);
        downloads.push(...files.filter((file) => !String(file.id).startsWith("local-")).map((attachment) => ({ attachment, scope })));
      }
      if (options) {
        let remaining = options.byteBudget;
        for (const item of downloads) {
          if (remaining <= 0) break;
          const state = await this.dependencies.store.read(this.dependencies.namespace);
          if (state.attachments.some((entry) => entry.attachmentId === String(item.attachment.id) && sameResource(entry.scope, item.scope) && entry.stepId === item.stepId)) continue;
          if (item.attachment.size !== undefined && (item.attachment.size > remaining || item.attachment.size > OFFLINE_LIMITS.fileBytes)) continue;
          const photo = await options.downloadAttachment(item.attachment, item.scope, Math.min(remaining, OFFLINE_LIMITS.fileBytes));
          const file = await this.dependencies.fileStore.own(this.dependencies.namespace, photo);
          if (file.size > remaining) { await this.dependencies.fileStore.remove(file); throw new OfflineUnavailableError("OFFLINE_DOWNLOAD_BUDGET_EXCEEDED"); }
          try {
            await updateState(this.dependencies.store, this.dependencies.namespace, (draft) => { draft.attachments.push({ scope: item.scope, stepId: item.stepId, attachmentId: String(item.attachment.id), file }); });
          } catch (error) { await this.dependencies.fileStore.remove(file); throw error; }
          remaining -= file.size;
        }
      }
    } finally { this.engine.setPreparing(false); }
  }
}
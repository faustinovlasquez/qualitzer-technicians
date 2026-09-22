import { Platform } from "react-native";
import { locationAckSchema, locationBatchSchema, locationHistoryQuerySchema, locationHistorySchema, type LocationPoint } from "../domain/locationTracking";
import type { TechnicianRepository } from "../domain/TechnicianRepository";
import { userSignatureInputSchema, userSignatureOptionsSchema, type UserSignatureInput } from "../domain/userSignatures";
import { checklistAssignmentInputSchema, checklistAssignmentResultSchema, checklistCatalogPageSchema, checklistCatalogQuerySchema, type ChecklistCatalogQuery } from "../domain/checklistAssignment";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../domain/orderLifecycle";
import type { Assignments, Attachment, CommentPage, DateRange, GroupScope, Health, LocalPhoto, LoginStartResult, StatusInput, StepAnswer, Tenant, User, WorkScope } from "../domain/models";
import { ApiError, apiMessage, classifyTransportError } from "./errors";
import { OfflineUnavailableError, type OfflineCommand, type OfflineDocumentMetadata } from "../domain/offline";
import { receiptSchema } from "../offline/state";
import { cachedAssignmentsSchema } from "../offline/cacheSchemas";
import { receiptForOperation, syncCapabilitiesSchema, syncCommandSchema, syncDocumentSchema, syncOperationIdSchema } from "../domain/offlineProtocol";
import { appendPhoto, uploadFetch } from "./photos";
import { requireSessionTenant } from "../domain/tenantSession";
import { loginStartSchema, tenantListSchema, tenantLoginSchema, tenantSchema } from "./tenantSchemas";
import { registerTenantChallengeClock, tenantChallengeMonotonicNow, type TenantChallengeResponseTiming } from "./tenantChallengeClock";
import { assignmentDays, dailyRange, mergeDailyAssignments } from "../domain/assignmentSchedule";
import { AssignmentReadCancelledError, type AssignmentReadOptions } from "../domain/assignmentRead";
import { withAssignmentReadBatch } from "./assignmentReadBatch";
import { workActivityInputSchema, workActivityResultSchema, workActivitySchema, type WorkActivitiesPort } from "../domain/workActivities";
import { cachedAttachmentSchema } from "../offline/cacheSchemas";
import { creationInputSchema, creationOptionsQuerySchema, creationOptionsSchema, creationResultSchema, mobileUuidSchema, positiveCreationIdSchema, type CreationInput, type CreationOptionsQuery } from "../domain/creation";
import { notificationDeleteResultSchema, notificationDeviceInputSchema, notificationDeviceResultSchema, notificationInboxSchema, notificationReadResultSchema, notificationStatusSchema, notificationTestResultSchema, type NotificationDeviceInput } from "../domain/notifications";


export class HttpTechnicianRepository implements TechnicianRepository {
  async equipmentLocation(scope: import("../domain/models").WorkScope, target: import("../domain/equipmentLocation").EquipmentLocationTarget) {
    const { equipmentLocationSchema, equipmentLocationTargetSchema } = await import("../domain/equipmentLocation");
    return equipmentLocationSchema.parse(await this.request<unknown>(this.scopePath(scope, `/equipment-location/${equipmentLocationTargetSchema.parse(target)}`)));
  }
  async updateEquipmentLocation(scope: import("../domain/models").WorkScope, target: import("../domain/equipmentLocation").EquipmentLocationTarget, input: import("../domain/equipmentLocation").EquipmentLocationUpdate) {
    const { equipmentLocationSchema, equipmentLocationTargetSchema, equipmentLocationUpdateSchema } = await import("../domain/equipmentLocation");
    return equipmentLocationSchema.parse(await this.request<unknown>(this.scopePath(scope, `/equipment-location/${equipmentLocationTargetSchema.parse(target)}`), "PATCH", equipmentLocationUpdateSchema.parse(input)));
  }
  async locationHistory(companyBranchId: number, date: string, page: number, resource?: import("../domain/locationTracking").LocationHistoryResource) {
    const input = locationHistoryQuerySchema.parse({ companyBranchId, startDate: date, endDate: date, page, ...resource });
    const query = new URLSearchParams({ companyBranchId: String(input.companyBranchId), startDate: input.startDate, endDate: input.endDate, page: String(input.page) });
    if (input.groupId !== undefined) query.set("groupId", input.groupId);
    if (input.workId !== undefined) query.set("workId", String(input.workId));
    return locationHistorySchema.parse(await this.request<unknown>(`/api/worker-locations/me?${query}`));
  }
  async uploadLocations(companyBranchId: number, points: LocationPoint[], expectedActor: { userId: number; workerId: number }) {
    return locationAckSchema.parse(await this.request<unknown>("/api/worker-locations/batch", "POST", locationBatchSchema.parse({ companyBranchId, points, expectedActor })));
  }
  token = "";
  onUnauthorized: (() => void) | null = null;
  constructor(readonly baseUrl: string, public tenant?: Tenant) {}
  async userSignatures(branchId: number) {
    return userSignatureOptionsSchema.parse(await this.request<unknown>(`/api/user-signatures?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async saveUserSignature(branchId: number, input: UserSignatureInput) {
    return userSignatureOptionsSchema.parse(await this.request<unknown>(`/api/user-signatures?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, "PUT", userSignatureInputSchema.parse(input)));
  }
  async deleteUserSignature(branchId: number, signatureId: number) {
    return userSignatureOptionsSchema.parse(await this.request<unknown>(`/api/user-signatures/${positiveCreationIdSchema.parse(signatureId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, "DELETE"));
  }
  activities: WorkActivitiesPort["activities"] = async scope => workActivitySchema.array().parse(await this.request<unknown>(this.scopePath(scope, "/activities")));
  createActivity: WorkActivitiesPort["createActivity"] = async (scope, input) => workActivityResultSchema.parse(await this.request<unknown>(this.scopePath(scope, "/activities"), "POST", workActivityInputSchema.parse(input)));
  updateActivity: WorkActivitiesPort["updateActivity"] = (scope, id, input) => this.request<void>(this.scopePath(scope, `/activities/${positiveCreationIdSchema.parse(id)}`), "PATCH", workActivityInputSchema.parse(input));
  completeActivity: WorkActivitiesPort["completeActivity"] = (scope, id, isCompleted = true) => this.request<void>(this.scopePath(scope, `/activities/${positiveCreationIdSchema.parse(id)}/complete`), "POST", { isCompleted });
  deleteActivity: WorkActivitiesPort["deleteActivity"] = (scope, id) => this.request<void>(this.scopePath(scope, `/activities/${positiveCreationIdSchema.parse(id)}`), "DELETE");
  activityFiles: WorkActivitiesPort["activityFiles"] = async (scope, id) => cachedAttachmentSchema.array().parse(await this.request<unknown>(this.scopePath(scope, `/activities/${positiveCreationIdSchema.parse(id)}/files`)));
  deleteActivityFile: WorkActivitiesPort["deleteActivityFile"] = (scope, id, fileId) => {
    if (!/^[1-9]\d*$/.test(fileId)) throw new Error("Archivo de actividad inválido.");
    return this.request<void>(this.scopePath(scope, `/activities/${positiveCreationIdSchema.parse(id)}/files/${positiveCreationIdSchema.parse(Number(fileId))}`), "DELETE");
  };
  uploadActivityFiles: WorkActivitiesPort["uploadActivityFiles"] = async (scope, id, files) => {
    for (const file of files) {
      const body = new FormData(); await appendPhoto(body, file);
      workActivityResultSchema.parse(await this.request<unknown>(this.scopePath(scope, `/activities/${positiveCreationIdSchema.parse(id)}/files`), "POST", body));
    }
  };
  reopenWork: WorkActivitiesPort["reopenWork"] = scope => this.request<void>(this.scopePath(scope, "/reopen"), "POST", {});

  async checklistOptions(scope: WorkScope, input: ChecklistCatalogQuery) {
    const query = checklistCatalogQuerySchema.parse(input);
    const result = checklistCatalogPageSchema.parse(await this.request<unknown>(`${this.scopePath(scope, "/checklists/options")}&${new URLSearchParams({ search: query.search, page: String(query.page) })}`));
    if (result.page !== query.page) throw new Error("CHECKLIST_ASSIGNMENT_INVALID_RESPONSE");
    return result;
  }
  async attachChecklist(scope: WorkScope, checklistId: number) {
    const input = checklistAssignmentInputSchema.parse({ checklistId });
    const result = checklistAssignmentResultSchema.parse(await this.request<unknown>(this.scopePath(scope, "/checklists"), "POST", input));
    if (result.checklistId !== checklistId) throw new Error("CHECKLIST_ASSIGNMENT_INVALID_RESPONSE");
    return result;
  }

  async offlineCommand(command: OfflineCommand) {
    const input = syncCommandSchema.parse(command);
    try {
      return receiptSchema.parse(await this.request<unknown>("/api/offline/commands", "POST", input, input.operationId));
    } catch (error) {
      if ((input.kind === "timer" || input.kind === "checklist" || input.kind === "completion") && error instanceof ApiError && error.status === 400
        && (error.code === "INVALID_INPUT" || error.code === "MOBILE_SYNC_INVALID_KIND")) {
        throw new ApiError(503, "MOBILE_SYNC_ACTIONS_UNAVAILABLE", "El servicio aún no admite esta operación offline. Se conserva para reintentar tras actualizar el servidor.");
      }
      throw error;
    }
  }
  async offlineCapabilities(companyBranchId: number) {
    return syncCapabilitiesSchema.parse(await this.request<unknown>(`/api/offline/capabilities?companyBranchId=${positiveCreationIdSchema.parse(companyBranchId)}`));
  }
  async offlineReceipt(operationId: string, companyBranchId: number) {
    try {
      const id = syncOperationIdSchema.parse(operationId);
      return receiptSchema.parse(await this.request<unknown>(`/api/offline/receipts/${id}?companyBranchId=${positiveCreationIdSchema.parse(companyBranchId)}`, "GET", undefined, id));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && error.code === "OFFLINE_RECEIPT_NOT_FOUND") return null;
      throw error;
    }
  }
  async offlineDocument(metadata: OfflineDocumentMetadata, file: LocalPhoto) {
    const parsed = syncDocumentSchema.safeParse(metadata);
    if (!parsed.success) throw new OfflineUnavailableError("OFFLINE_DOCUMENT_INVALID_METADATA");
    const input = parsed.data;
    const body = new FormData();
    body.append("metadata", JSON.stringify(input));
    await appendPhoto(body, file);
    return receiptSchema.parse(await this.request<unknown>("/api/offline/documents", "POST", body, input.operationId));
  }

  async createRecord(input: CreationInput) {
    const body = creationInputSchema.parse(input);
    try { return creationResultSchema.parse(await this.request<unknown>("/api/creation", "POST", body)); }
    catch (error) {
      if (body.kind === "work" && (!body.work.summary || !body.schedule.startTime || !body.schedule.endTime)
        && error instanceof ApiError && error.status === 400 && error.code === "INVALID_INPUT") {
        throw new ApiError(503, "MOBILE_CREATION_SCHEMA_NOT_READY", "El servicio requiere actualizarse para aceptar trabajos con campos opcionales. La solicitud se conserva.");
      }
      throw error;
    }
  }
  async creationOptions(input: CreationOptionsQuery) {
    const parsed = creationOptionsQuerySchema.parse(input);
    const query = new URLSearchParams({ companyBranchId: String(parsed.companyBranchId) });
    if (parsed.kind !== undefined) query.set("kind", parsed.kind);
    if (parsed.search !== undefined) query.set("search", parsed.search);
    if (parsed.internalNumber !== undefined) query.set("internalNumber", parsed.internalNumber);
    if (parsed.page !== undefined) query.set("page", String(parsed.page));
    return creationOptionsSchema.parse(await this.request<unknown>(`/api/creation/options?${query}`));
  }
  private notificationPath(branch: number, suffix: string): string {
    return `/api/mobile-notifications/${suffix}?companyBranchId=${positiveCreationIdSchema.parse(branch)}`;
  }
  async notificationStatus(branch: number) { return notificationStatusSchema.parse(await this.request<unknown>(this.notificationPath(branch, "status"))); }
  async registerNotificationDevice(input: NotificationDeviceInput) {
    return notificationDeviceResultSchema.parse(await this.request<unknown>("/api/mobile-notifications/device", "PUT", notificationDeviceInputSchema.parse(input)));
  }
  unregisterNotificationDevice(branch: number, installation: string) { return this.request<void>(this.notificationPath(branch, `device/${mobileUuidSchema.parse(installation)}`), "DELETE"); }
  async notificationInbox(branch: number, page: number, unreadOnly?: boolean) {
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error("MOBILE_PUSH_INVALID_PAGE");
    const result = notificationInboxSchema.parse(await this.request<unknown>(`${this.notificationPath(branch, "inbox")}&page=${page}${unreadOnly === true ? "&unreadOnly=true" : ""}`));
    if (result.page !== page || result.items.some((item) => item.data.companyBranchId !== branch || item.data.tenantOrigin !== this.selectedTenant().portalOrigin)) throw new Error("MOBILE_PUSH_IDENTITY_MISMATCH");
    return result;
  }
  async readNotification(branch: number, id: string) { return notificationReadResultSchema.parse(await this.request<unknown>(this.notificationPath(branch, `inbox/${mobileUuidSchema.parse(id)}/read`), "PATCH")); }
  async deleteNotification(branch: number, id: string) {
    const eventId = mobileUuidSchema.parse(id);
    const result = notificationDeleteResultSchema.parse(await this.request<unknown>(this.notificationPath(branch, `inbox/${encodeURIComponent(eventId)}`), "DELETE"));
    if (result.id !== eventId) throw new Error("MOBILE_PUSH_IDENTITY_MISMATCH");
    return result;
  }
  async testNotification(branch: number) { return notificationTestResultSchema.parse(await this.request<unknown>(this.notificationPath(branch, "test"), "POST")); }

  private async request<T>(path: string, method = "GET", body?: object | FormData, receiptOperationId?: string, onResponseHeaders?: (timing: TenantChallengeResponseTiming) => void, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), body instanceof FormData ? 150_000 : 45_000);
    const cancel = () => { clearTimeout(timeout); controller.abort(); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) throw new AssignmentReadCancelledError();
      const headers: { [name: string]: string } = {};
      if (Platform.OS === "web") headers["X-Qualitzer-Session"] = "cookie";
      else if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (this.tenant) headers["X-Qualitzer-Tenant"] = this.tenant.id;
      if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
      const requestBody = body instanceof FormData ? body : body ? JSON.stringify(body) : undefined;
      const requestStartedAt = onResponseHeaders ? tenantChallengeMonotonicNow() : 0;
      const response = await uploadFetch(`${this.baseUrl}${path}`, {
        method, headers, credentials: Platform.OS === "web" ? "include" : "omit", body: requestBody, signal: controller.signal,
      }).catch((error: unknown) => {
        if (signal?.aborted) throw new AssignmentReadCancelledError();
        if (body instanceof FormData && error instanceof Error
          && ["Unsupported FormData implementation", "Unsupported FormDataPart implementation"].includes(error.message)) {
          throw new OfflineUnavailableError("OFFLINE_DOCUMENT_MULTIPART_UNSUPPORTED");
        }
        throw classifyTransportError(error, controller.signal.aborted, Platform.OS !== "web");
      });
      onResponseHeaders?.({ requestStartedAt, headersReceivedAt: tenantChallengeMonotonicNow(), serverDate: response.headers.get("Date") });
      const text = await response.text().catch((error: unknown) => {
        if (signal?.aborted) throw new AssignmentReadCancelledError();
        throw classifyTransportError(error, controller.signal.aborted, Platform.OS !== "web");
      });
      if (signal?.aborted) throw new AssignmentReadCancelledError();
      if (receiptOperationId !== undefined) {
        let data: unknown;
        try { data = JSON.parse(text); } catch { data = null; }
        const receipt = receiptForOperation(data, receiptOperationId, response.status);
        if (receipt?.state === "in_progress") throw new ApiError(409, "MOBILE_SYNC_IN_PROGRESS", "El servidor sigue procesando esta operación. Se consultará su recibo nuevamente.");
        if (receipt) return receipt as T;
        if (response.ok) throw new ApiError(502, "OFFLINE_INVALID_RECEIPT", "No se pudo verificar el recibo del servidor.");
      }
      if (!response.ok) {
        let code = `HTTP_${response.status}`;
        let message: string | undefined;
        try {
          const parsed: unknown = JSON.parse(text);
          if (typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string") code = parsed.error;
          if (typeof parsed === "object" && parsed !== null && "message" in parsed && typeof parsed.message === "string") message = parsed.message;
        } catch { /* Non-JSON proxy errors must never expose HTML bodies. */ }
        if (response.status === 401 && !path.includes("/auth/login")) this.onUnauthorized?.();
        throw new ApiError(response.status, code, apiMessage(code, message));
      }
      try { return (text ? JSON.parse(text) : undefined) as T; }
      catch { throw new ApiError(502, "UPSTREAM_INVALID_RESPONSE", apiMessage("UPSTREAM_INVALID_RESPONSE")); }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }

  private scopePath(scope: WorkScope, suffix: string): string {
    const query = new URLSearchParams({ startDate: scope.startDate, endDate: scope.endDate, companyBranchId: String(scope.companyBranchId) });
    return `/api/assignments/${encodeURIComponent(scope.groupId)}/works/${encodeURIComponent(scope.workId)}${suffix}?${query}`;
  }
  async tenants(): Promise<Tenant[]> { return tenantListSchema.parse(await this.request<unknown>("/api/tenants")).data; }
  async startLogin(username: string, password: string): Promise<LoginStartResult> {
    let timing: TenantChallengeResponseTiming | undefined;
    const result = loginStartSchema.parse(await this.request<unknown>("/api/auth/login/start", "POST", { username: username.trim(), password, remember: true }, undefined, (responseTiming) => { timing = responseTiming; }));
    if (result.nextStep === "SELECT_TENANT") registerTenantChallengeClock(result, timing);
    return result;
  }
  async completeLogin(challenge: string, tenant: Tenant) {
    const result = tenantLoginSchema.parse(await this.request<unknown>("/api/auth/login/complete", "POST", { challenge, tenantId: tenant.id }));
    requireSessionTenant(tenant, result.tenant);
    return result;
  }
  health() { return this.request<Health>(this.tenant ? `/health?tenantId=${encodeURIComponent(this.tenant.id)}` : "/health"); }
  private selectedTenant(): Tenant {
    if (!this.tenant) throw new Error("Selecciona la empresa antes de ingresar.");
    return this.tenant;
  }
  async login(username: string, password: string) {
    const tenant = this.selectedTenant();
    const result = tenantLoginSchema.parse(await this.request<unknown>("/api/auth/login", "POST", { tenantId: tenant.id, username: username.trim(), password, remember: true }));
    requireSessionTenant(tenant, result.tenant);
    return result;
  }
  async me(branchId?: number) {
    const result = await this.request<User & { tenant: Tenant }>(`/api/auth/me${branchId ? `?companyBranchId=${branchId}` : ""}`);
    requireSessionTenant(this.selectedTenant(), tenantSchema.parse(result.tenant));
    this.tenant = result.tenant;
    return result;
  }
  logout() { return this.request<void>("/api/auth/logout", "POST"); }
  async forcePassword(newPassword: string, confirmPassword: string) {
    const result = tenantLoginSchema.parse(await this.request<unknown>("/api/auth/forced_password", "PATCH", { newPassword, confirmPassword, remember: true }));
    requireSessionTenant(this.selectedTenant(), result.tenant);
    return result;
  }
  async assignments(range: DateRange, branchId: number, options?: AssignmentReadOptions): Promise<Assignments> {
    return withAssignmentReadBatch(options, async (batch) => {
      const days = assignmentDays(range);
      const requestedDays = options?.priorityDate && days.includes(options.priorityDate) ? [options.priorityDate, ...days.filter(date => date !== options.priorityDate)] : days;
      const completed: Array<{ date: string; data: Assignments }> = [];
      const snapshots = await batch.map(requestedDays, async (date) => {
        const data = await batch.wait(() => this.request<Assignments>(`/api/assignments?${new URLSearchParams({ ...dailyRange(date), companyBranchId: String(branchId) })}`, "GET", undefined, undefined, undefined, batch.signal));
        if (!cachedAssignmentsSchema.safeParse(data).success) throw new ApiError(502, "UPSTREAM_INVALID_RESPONSE", apiMessage("UPSTREAM_INVALID_RESPONSE"));
        const snapshot = { date, data };
        completed.push(snapshot);
        batch.check();
        options?.onProgress?.(mergeDailyAssignments(completed, range.startDate), completed.map(item => item.date));
        return snapshot;
      }, options?.getPriorityDate);
      return mergeDailyAssignments(snapshots, range.startDate);
    });
  }
  status(scope: WorkScope, input: StatusInput) { return this.request<void>(this.scopePath(scope, "/status"), "POST", input); }
  answer(scope: WorkScope, stepId: string, answer: StepAnswer) { return this.request<void>(this.scopePath(scope, `/steps/${encodeURIComponent(stepId)}`), "PATCH", answer); }
  async files(scope: WorkScope) { return (await this.request<{ data: Attachment[] }>(this.scopePath(scope, "/files"))).data; }
  async stepFiles(scope: WorkScope, stepId: string) { return (await this.request<{ data: Attachment[] }>(this.scopePath(scope, `/steps/${encodeURIComponent(stepId)}/files`))).data; }
  async upload(scope: WorkScope, photos: LocalPhoto[], stepId?: string) {
    const body = new FormData();
    for (const photo of photos) await appendPhoto(body, photo);
    await this.request<void>(this.scopePath(scope, stepId ? `/steps/${encodeURIComponent(stepId)}/files` : "/files"), "POST", body);
  }
  report(scope: WorkScope, note: string) { return this.request<void>(this.scopePath(scope, "/report"), "POST", { note }); }
  comments(scope: WorkScope, page: number) { return this.request<CommentPage>(`${this.scopePath(scope, "/comments")}&page=${page}`); }
  addComment(scope: WorkScope, text: string) { return this.request<void>(this.scopePath(scope, "/comments"), "POST", { text }); }
  async uploadDocuments(scope: WorkScope, files: LocalPhoto[], stepId?: string) {
    for (const file of files) {
      const body = new FormData();
      await appendPhoto(body, file);
      await this.request<void>(this.scopePath(scope, stepId ? `/steps/${encodeURIComponent(stepId)}/documents` : "/documents"), "POST", body);
    }
  }
  deleteFile(scope: WorkScope, fileId: string, stepId?: string) {
    return this.request<void>(this.scopePath(scope, `${stepId ? `/steps/${encodeURIComponent(stepId)}` : ""}/files/${encodeURIComponent(fileId)}`), "DELETE");
  }
  private groupPath(scope: GroupScope, suffix = ""): string {
    return `/api/assignments/${encodeURIComponent(scope.groupId)}/files${suffix}?${new URLSearchParams({ startDate: scope.startDate, endDate: scope.endDate, companyBranchId: String(scope.companyBranchId) })}`;
  }
  async groupFiles(scope: GroupScope) { return (await this.request<{ data: Attachment[] }>(this.groupPath(scope))).data; }
  async uploadGroupFiles(scope: GroupScope, files: LocalPhoto[]) {
    for (const file of files) {
      const body = new FormData();
      await appendPhoto(body, file);
      await this.request<void>(this.groupPath(scope), "POST", body);
    }
  }
  deleteGroupFile(scope: GroupScope, fileId: string) { return this.request<void>(this.groupPath(scope, `/${encodeURIComponent(fileId)}`), "DELETE"); }
  private orderPath(scope: GroupScope, action: string): string {
    return `/api/assignments/${encodeURIComponent(scope.groupId)}/${action}?${new URLSearchParams({ startDate: scope.startDate, endDate: scope.endDate, companyBranchId: String(scope.companyBranchId) })}`;
  }
  orderDelivery(scope: GroupScope) { return this.request<MaintenanceDeliveryContext>(this.orderPath(scope, "maintenance-delivery")); }
  startOrder(scope: GroupScope) { return this.request<void>(this.orderPath(scope, "start"), "POST", {}); }
  deliverOrder(scope: GroupScope, input: MaintenanceDeliveryInput) { return this.request<void>(this.orderPath(scope, "deliver"), "POST", input); }
}
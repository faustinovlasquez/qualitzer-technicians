import { Platform } from "react-native";
import { emailEligibilitySchema, emailHistorySchema, emailOptionsSchema, emailPreviewInputSchema, emailPreviewSchema, emailSendInputSchema, emailSendResultSchema, type EmailSendInput } from "../domain/workshopCustomerEmail";
import { materialDispositionInputSchema, materialReceiptInputSchema, materialReceiptResultSchema, materialReceiptSchema, materialReceiptsSchema, materialReceiptStatusSchema,
  type MaterialDispositionInput, type MaterialReceiptInput, type MaterialReceiptStatus } from "../domain/materialReceipts";
import { workshopBoardSchema, workshopListSchema } from "../domain/workshopBoard";
import { DELIVERY_CONDITIONS_HEADER, workshopEntryDetailSchema } from "../domain/workshopEntry";
import type { z } from "zod";
import { workshopFreeWorksSchema, workshopLinkWorksInputSchema, workshopLinkWorksResultSchema } from "../domain/workshopWorks";
import { workshopDeliveryInputSchema, workshopDeliveryResultSchema, type WorkshopDeliveryInput } from "../domain/workshopDelivery";
import { workshopIdentificationTypesSchema, workshopNewBranchResultSchema, workshopNewBranchSchema, workshopNewContactResultSchema, workshopNewContactSchema,
  workshopNewCustomerResultSchema, workshopNewCustomerSchema, workshopDuplicatesSchema, type WorkshopNewBranch, type WorkshopNewContact, type WorkshopNewCustomer,
  type WorkshopBranchDuplicateQuery, type WorkshopContactDuplicateQuery, type WorkshopCustomerDuplicateQuery,
  workshopEquipmentDuplicatesSchema, type WorkshopEquipmentDuplicateQuery } from "../domain/workshopCustomers";
import { workshopEstimatedDateInputSchema, workshopManageResultSchema, workshopMoveInputSchema, workshopStatusesSchema, workshopStatusInputSchema } from "../domain/workshopManage";
import { mobileAppConfigSchema } from "../domain/mobileAppConfig";
import { deletionCheckSchema, deletionRoute, type DeletionScope } from "../domain/deletion";
import { noteServerDate } from "../offline/serverClock";
import {
  THREAD_ATTACHMENTS_MAX, threadActiveMentions, threadEditSchema, threadLiveSchema, threadMentionsSchema, threadPageSchema, threadPeopleSchema, threadRoute,
  threadTabSchema, threadTextSchema, type ThreadMention, type ThreadScope, type ThreadTab
} from "../domain/threads";
import {
  driveFolderIdSchema, driveFolderNameSchema, driveFolderSchema, driveListingSchema, driveMoveSchema, driveRoute,
  type DriveFolderId, type DriveScope, type DriveUpload
} from "../domain/fileDrive";
import {
  equipmentMasterKindSchema, workshopEquipmentMastersSchema, workshopNewEquipmentMasterResultSchema, workshopNewEquipmentMasterSchema, workshopNewEquipmentResultSchema, workshopNewEquipmentSchema,
  type EquipmentMasterKind, type WorkshopNewEquipment, type WorkshopNewEquipmentMaster
} from "../domain/workshopCustomers";
import { workshopOrderActionInputSchema,workshopOrderDeletedSchema, workshopOrderDetailSchema, workshopOrderGeneralInputSchema, workshopOrderInputSchema, workshopOrderResultSchema, workshopOrderRulesSchema, workshopOrderSentSchema,
  workshopOrderWorksInputSchema, workshopOrderWorksResultSchema, type WorkshopOrderInput,
  workshopOrderItemInputSchema, workshopOrderItemSectionSchema, workshopOrderItemUpdateSchema, workshopProductPageSchema, workshopTransportOptionsSchema,
  type WorkshopOrderItemInput, type WorkshopOrderItemSection } from "../domain/workshopOrders";
import { workshopReceptionInputSchema, workshopReceptionResultSchema, workshopSavedSignaturesSchema, workshopSignatureSaveInputSchema, workshopWorkersSchema, type WorkshopReceptionInput, type WorkshopSignatureSaveInput } from "../domain/workshopReception";
import { inspectionAnswerInputSchema, inspectionBranchInputSchema, inspectionChecklistOptionsSchema, inspectionChecklistsInputSchema, inspectionDamageInputSchema,
  inspectionMetaInputSchema, inspectionOpenInputSchema, inspectionPhotoInputSchema, inspectionSavedSchema, inspectionShareSchema, workshopInspectionStateSchema,
  type InspectionAnswerInput, type InspectionDamageInput } from "../domain/workshopInspection";
import { workshopAreaOptionsSchema, workshopCustomerDetailSchema, workshopCustomerOptionsSchema, workshopEquipmentOptionsSchema, workshopEquipmentQuerySchema, workshopImageInputSchema,
  workshopIntakeFormSchema, workshopIntakeInputSchema, workshopIntakeResultSchema, type WorkshopEquipmentQuery, type WorkshopImageInput, type WorkshopIntakeInput } from "../domain/workshopIntake";
import { locationAckSchema, locationBatchSchema, locationHistoryQuerySchema, locationHistorySchema, type LocationPoint } from "../domain/locationTracking";
import type { TechnicianRepository } from "../domain/TechnicianRepository";
import { appErrorBatchSchema, appErrorResultSchema, type AppError } from "../domain/diagnostics";
import { userSignatureInputSchema, userSignatureOptionsSchema, type UserSignatureInput } from "../domain/userSignatures";
import { ownAvatarInputSchema, ownProfileInputSchema, ownProfileSchema, type OwnAvatarInput, type OwnProfileInput } from "../domain/ownProfile";
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
import { ASSIGNMENTS_REVISION_PATTERN, AssignmentReadCancelledError, AssignmentsUnchangedError, type AssignmentReadOptions } from "../domain/assignmentRead";
import { withAssignmentReadBatch } from "./assignmentReadBatch";
import { workActivityInputSchema, workActivityResultSchema, workActivitySchema, type WorkActivitiesPort } from "../domain/workActivities";
import { cachedAttachmentSchema } from "../offline/cacheSchemas";
import { workTeamAddInputSchema, workTeamSchema, type WorkTeamPort } from "../domain/workTeam";
import { creationInputSchema, creationOptionsQuerySchema, creationOptionsSchema, creationResultSchema, mobileUuidSchema, positiveCreationIdSchema, type CreationInput, type CreationOptionsQuery } from "../domain/creation";
import { activeTimersSchema, notificationDeleteResultSchema, notificationDeviceInputSchema, notificationDeviceResultSchema, notificationInboxSchema, notificationReadAllResultSchema, notificationReadResultSchema, notificationStatusSchema, notificationTestResultSchema, type NotificationDeviceInput } from "../domain/notifications";


export class HttpTechnicianRepository implements TechnicianRepository {
  async materialReceipts(branchId: number, status: MaterialReceiptStatus = "PENDING") {
    const query = `companyBranchId=${positiveCreationIdSchema.parse(branchId)}${materialReceiptStatusSchema.parse(status) === "CONFIRMED" ? "&status=CONFIRMED" : ""}`;
    return materialReceiptsSchema.parse(await this.request<unknown>(`/api/material-receipts?${query}`));
  }
  async confirmMaterialReceipts(input: MaterialReceiptInput) {
    return materialReceiptResultSchema.parse(await this.request<unknown>("/api/material-receipts/confirm", "POST", materialReceiptInputSchema.parse(input)));
  }
  /** Talleres de la sucursal (para elegir cuál tablero de naves ver). */
  async workshops(branchId: number) {
    return workshopListSchema.parse(await this.request<unknown>(`/api/workshop/workshops?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  /** Naves del taller con sus ingresos (solo lectura). */
  async workshopBoard(branchId: number, workshopId: number) {
    const query = `companyBranchId=${positiveCreationIdSchema.parse(branchId)}&workshopId=${positiveCreationIdSchema.parse(workshopId)}`;
    return workshopBoardSchema.parse(await this.request<unknown>(`/api/workshop/board?${query}`));
  }
  /** Ficha del ingreso: recepción, inspecciones, trabajos y órdenes. */
  async workshopEntry(branchId: number, entryId: number) {
    const path = `/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`;
    return workshopEntryDetailSchema.parse(await this.request<unknown>(path, "GET", undefined, undefined, undefined, undefined, { [DELIVERY_CONDITIONS_HEADER]: "1" }));
  }
  async workshopCustomers(branchId: number, search: string, page: number) {
    const query = new URLSearchParams({ companyBranchId: String(positiveCreationIdSchema.parse(branchId)), page: String(Math.max(0, Math.floor(page))) });
    if (search.trim()) query.set("search", search.trim().slice(0, 100));
    return workshopCustomerOptionsSchema.parse(await this.request<unknown>(`/api/workshop/options/customers?${query.toString()}`));
  }
  async workshopCustomer(branchId: number, customerId: number) {
    const path = `/api/workshop/options/customers/${positiveCreationIdSchema.parse(customerId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`;
    return workshopCustomerDetailSchema.parse(await this.request<unknown>(path));
  }
  async workshopEquipment(input: WorkshopEquipmentQuery) {
    const query = workshopEquipmentQuerySchema.parse(input);
    const params = new URLSearchParams({ companyBranchId: String(query.companyBranchId), source: query.source, page: String(query.page) });
    if (query.customerId !== undefined) params.set("customerId", String(query.customerId));
    if (query.search) params.set("search", query.search);
    return workshopEquipmentOptionsSchema.parse(await this.request<unknown>(`/api/workshop/options/equipment?${params.toString()}`));
  }
  async workshopAreas(branchId: number, workshopId: number) {
    const query = `companyBranchId=${positiveCreationIdSchema.parse(branchId)}&workshopId=${positiveCreationIdSchema.parse(workshopId)}`;
    return workshopAreaOptionsSchema.parse(await this.request<unknown>(`/api/workshop/options/areas?${query}`));
  }
  async workshopIntakeForm(branchId: number, entryId: number) {
    const path = `/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/form?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`;
    return workshopIntakeFormSchema.parse(await this.request<unknown>(path));
  }
  async createWorkshopEntry(input: WorkshopIntakeInput) {
    return workshopIntakeResultSchema.parse(await this.request<unknown>("/api/workshop/entries", "POST", workshopIntakeInputSchema.parse(input)));
  }
  async updateWorkshopEntry(entryId: number, input: WorkshopIntakeInput) {
    return workshopIntakeResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}`, "PUT", workshopIntakeInputSchema.parse(input)));
  }
  private inspectionPath(entryId: number, inspectionId: number) {
    return `/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/inspections/${positiveCreationIdSchema.parse(inspectionId)}`;
  }
  async openInspection(entryId: number, input: z.infer<typeof inspectionOpenInputSchema>) {
    return workshopInspectionStateSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/inspections`, "POST", inspectionOpenInputSchema.parse(input)));
  }
  async inspection(entryId: number, inspectionId: number, branchId: number) {
    return workshopInspectionStateSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async inspectionChecklistOptions(branchId: number) {
    return inspectionChecklistOptionsSchema.parse(await this.request<unknown>(`/api/workshop/options/checklists?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async setInspectionChecklists(entryId: number, inspectionId: number, input: z.infer<typeof inspectionChecklistsInputSchema>) {
    return workshopInspectionStateSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/checklists`, "PUT", inspectionChecklistsInputSchema.parse(input)));
  }
  async answerInspectionStep(entryId: number, inspectionId: number, input: InspectionAnswerInput) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/steps`, "PUT", inspectionAnswerInputSchema.parse(input)));
  }
  async uploadInspectionPhoto(entryId: number, inspectionId: number, slotKey: string, input: z.infer<typeof inspectionPhotoInputSchema>) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/photos/${encodeURIComponent(slotKey)}`, "POST", inspectionPhotoInputSchema.parse(input)));
  }
  async deleteInspectionPhoto(entryId: number, inspectionId: number, slotKey: string, branchId: number) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/photos/${encodeURIComponent(slotKey)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, "DELETE"));
  }
  async uploadInspectionStepFile(entryId: number, inspectionId: number, stepId: number, input: z.infer<typeof inspectionPhotoInputSchema>) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/steps/${positiveCreationIdSchema.parse(stepId)}/files`, "POST", inspectionPhotoInputSchema.parse(input)));
  }
  async deleteInspectionStepFile(entryId: number, inspectionId: number, fileId: number, branchId: number) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/step-files/${positiveCreationIdSchema.parse(fileId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, "DELETE"));
  }
  async saveInspectionDamage(entryId: number, inspectionId: number, input: InspectionDamageInput) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/damages`, "PUT", inspectionDamageInputSchema.parse(input)));
  }
  async deleteInspectionDamage(entryId: number, inspectionId: number, damageId: number, branchId: number) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/damages/${positiveCreationIdSchema.parse(damageId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, "DELETE"));
  }
  async uploadInspectionDamagePhoto(entryId: number, inspectionId: number, damageId: number, input: z.infer<typeof inspectionPhotoInputSchema>) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/damages/${positiveCreationIdSchema.parse(damageId)}/photos`, "POST", inspectionPhotoInputSchema.parse(input)));
  }
  async saveInspectionMeta(entryId: number, inspectionId: number, input: z.infer<typeof inspectionMetaInputSchema>) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/meta`, "PUT", inspectionMetaInputSchema.parse(input)));
  }
  async completeInspection(entryId: number, inspectionId: number, branchId: number) {
    return inspectionSavedSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/complete`, "POST", inspectionBranchInputSchema.parse({ companyBranchId: branchId })));
  }
  async inspectionShare(entryId: number, inspectionId: number, branchId: number) {
    return inspectionShareSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/share?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async extendInspectionShare(entryId: number, inspectionId: number, branchId: number) {
    return inspectionShareSchema.parse(await this.request<unknown>(`${this.inspectionPath(entryId, inspectionId)}/share/extend`, "POST", inspectionBranchInputSchema.parse({ companyBranchId: branchId })));
  }
  async downloadInspectionPhotos(entryId: number, inspectionId: number, branchId: number, name: string) {
    const headers: Record<string, string> = {};
    if (Platform.OS === "web") headers["X-Qualitzer-Session"] = "cookie";
    else if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.tenant) headers["X-Qualitzer-Tenant"] = this.tenant.id;
    const safeName = `${name.replace(/[^\w.-]+/g, "-").slice(0, 80) || "inspeccion"}.zip`;
    // Se carga solo al usarlo: el módulo para compartir archivos es nativo y no hace falta en el resto de la app.
    const { saveAndShareZip } = require("./zipDownload") as typeof import("./zipDownload");
    await saveAndShareZip(`${this.baseUrl}${this.inspectionPath(entryId, inspectionId)}/photos.zip?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, headers, safeName);
  }
  async deliverWorkshopEntry(entryId: number, input: WorkshopDeliveryInput) {
    return workshopDeliveryResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/delivery`, "POST", workshopDeliveryInputSchema.parse(input)));
  }
  async workshopIdentificationTypes(branchId: number) {
    return workshopIdentificationTypesSchema.parse(await this.request<unknown>(`/api/workshop/options/identification-types?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async workshopCustomerDuplicates(query: WorkshopCustomerDuplicateQuery) {
    return workshopDuplicatesSchema.parse(await this.request<unknown>("/api/workshop/duplicates/customers", "POST", query)).matches;
  }
  async workshopContactDuplicates(customerId: number, query: WorkshopContactDuplicateQuery) {
    return workshopDuplicatesSchema.parse(await this.request<unknown>(`/api/workshop/duplicates/customers/${positiveCreationIdSchema.parse(customerId)}/contacts`, "POST", query)).matches;
  }
  async workshopBranchDuplicates(customerId: number, query: WorkshopBranchDuplicateQuery) {
    return workshopDuplicatesSchema.parse(await this.request<unknown>(`/api/workshop/duplicates/customers/${positiveCreationIdSchema.parse(customerId)}/branches`, "POST", query)).matches;
  }
  async workshopEquipmentDuplicates(query: WorkshopEquipmentDuplicateQuery) {
    return workshopEquipmentDuplicatesSchema.parse(await this.request<unknown>("/api/workshop/duplicates/equipment", "POST", query)).matches;
  }
  async createWorkshopCustomer(input: WorkshopNewCustomer) {
    return workshopNewCustomerResultSchema.parse(await this.request<unknown>("/api/workshop/customers", "POST", workshopNewCustomerSchema.parse(input)));
  }
  async createWorkshopCustomerBranch(customerId: number, input: WorkshopNewBranch) {
    return workshopNewBranchResultSchema.parse(await this.request<unknown>(`/api/workshop/customers/${positiveCreationIdSchema.parse(customerId)}/branches`, "POST", workshopNewBranchSchema.parse(input)));
  }
  async workshopEquipmentMasters(branchId: number) {
    return workshopEquipmentMastersSchema.parse(await this.request<unknown>(`/api/workshop/options/equipment-masters?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async createWorkshopCustomerEquipment(customerId: number, input: WorkshopNewEquipment) {
    return workshopNewEquipmentResultSchema.parse(await this.request<unknown>(`/api/workshop/customers/${positiveCreationIdSchema.parse(customerId)}/equipment`, "POST", workshopNewEquipmentSchema.parse(input)));
  }
  async createWorkshopEquipmentMaster(kind: EquipmentMasterKind, input: WorkshopNewEquipmentMaster) {
    return workshopNewEquipmentMasterResultSchema.parse(await this.request<unknown>(`/api/workshop/options/equipment-masters/${equipmentMasterKindSchema.parse(kind)}`, "POST", workshopNewEquipmentMasterSchema.parse(input)));
  }
  async createWorkshopCustomerContact(customerId: number, input: WorkshopNewContact) {
    return workshopNewContactResultSchema.parse(await this.request<unknown>(`/api/workshop/customers/${positiveCreationIdSchema.parse(customerId)}/contacts`, "POST", workshopNewContactSchema.parse(input)));
  }
  async workshopStatuses(branchId: number) {
    return workshopStatusesSchema.parse(await this.request<unknown>(`/api/workshop/options/statuses?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async moveWorkshopEntry(entryId: number, input: z.infer<typeof workshopMoveInputSchema>) {
    return workshopManageResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/move`, "POST", workshopMoveInputSchema.parse(input)));
  }
  async changeEstimatedDelivery(entryId: number, input: z.infer<typeof workshopEstimatedDateInputSchema>) {
    return workshopManageResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/estimated-delivery`, "POST", workshopEstimatedDateInputSchema.parse(input)));
  }
  async changeEntryStatus(entryId: number, input: z.infer<typeof workshopStatusInputSchema>) {
    return workshopManageResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/status`, "POST", workshopStatusInputSchema.parse(input)));
  }
  async workshopOrderRules(entryId: number, branchId: number) {
    return workshopOrderRulesSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/order-rules?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async mobileAppConfig(branchId: number) {
    return mobileAppConfigSchema.parse(await this.request<unknown>(`/api/workshop/app-config?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async workshopOrderDetail(entryId: number, orderId: number, branchId: number) {
    return workshopOrderDetailSchema.parse(await this.request<unknown>(`${this.workshopOrderPath(entryId, orderId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async updateOrderGeneral(entryId: number, orderId: number, input: z.infer<typeof workshopOrderGeneralInputSchema>) {
    return workshopOrderDetailSchema.parse(await this.request<unknown>(`${this.workshopOrderPath(entryId, orderId)}/general`, "PUT", workshopOrderGeneralInputSchema.parse(input)));
  }
  async workshopProducts(branchId: number, search: string, page: number) {
    const query = new URLSearchParams({ companyBranchId: String(positiveCreationIdSchema.parse(branchId)), page: String(page) });
    if (search.trim()) query.set("search", search.trim().slice(0, 100));
    return workshopProductPageSchema.parse(await this.request<unknown>(`/api/workshop/options/order-products?${query.toString()}`));
  }
  async workshopTransports(branchId: number) {
    return workshopTransportOptionsSchema.parse(await this.request<unknown>(`/api/workshop/options/order-transports?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  /** Ingreso 0: OT abierta desde Mi jornada, sin ingreso del Taller. */
  private workshopOrderPath(entryId: number, orderId: number) {
    return `/api/workshop/entries/${entryId === 0 ? 0 : positiveCreationIdSchema.parse(entryId)}/orders/${positiveCreationIdSchema.parse(orderId)}`;
  }
  async addOrderItem(entryId: number, orderId: number, input: WorkshopOrderItemInput) {
    return workshopOrderDetailSchema.parse(await this.request<unknown>(`${this.workshopOrderPath(entryId, orderId)}/items`, "POST", workshopOrderItemInputSchema.parse(input)));
  }
  async updateOrderItem(entryId: number, orderId: number, section: WorkshopOrderItemSection, rowId: number, input: z.infer<typeof workshopOrderItemUpdateSchema>) {
    return workshopOrderDetailSchema.parse(await this.request<unknown>(`${this.workshopOrderPath(entryId, orderId)}/items/${workshopOrderItemSectionSchema.parse(section)}/${positiveCreationIdSchema.parse(rowId)}`, "PATCH", workshopOrderItemUpdateSchema.parse(input)));
  }
  async removeOrderItem(entryId: number, orderId: number, section: WorkshopOrderItemSection | "works", rowId: number, branchId: number) {
    const kind = section === "works" ? "works" : workshopOrderItemSectionSchema.parse(section);
    return workshopOrderDetailSchema.parse(await this.request<unknown>(`${this.workshopOrderPath(entryId, orderId)}/items/${kind}/${positiveCreationIdSchema.parse(rowId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, "DELETE"));
  }
  private driveUrl(scope: DriveScope, suffix = "", extra: Record<string, string> = {}) {
    const { path, query } = driveRoute(scope);
    for (const [key, value] of Object.entries(extra)) query.set(key, value);
    return `${path}${suffix}?${query.toString()}`;
  }
  async driveList(scope: DriveScope, folderId: DriveFolderId | null, search: string | null, page: number) {
    return driveListingSchema.parse(await this.request<unknown>(this.driveUrl(scope, "", {
      ...(folderId !== null ? { folderId: String(folderId) } : {}), ...(search ? { search: search.slice(0, 120) } : {}), page: String(Math.max(0, Math.trunc(page)))
    })));
  }
  async driveUpload(scope: DriveScope, file: DriveUpload, folderId: DriveFolderId | null) {
    const body = new FormData();
    await appendPhoto(body, file);
    await this.request<void>(this.driveUrl(scope, "", folderId !== null ? { folderId: String(folderId) } : {}), "POST", body);
  }
  async driveCreateFolder(scope: DriveScope, name: string) {
    return driveFolderSchema.parse(await this.request<unknown>(this.driveUrl(scope, "/folders"), "POST", driveFolderNameSchema.parse({ name })));
  }
  async driveRenameFolder(scope: DriveScope, folderId: DriveFolderId, name: string) {
    await this.request<void>(this.driveUrl(scope, `/folders/${encodeURIComponent(String(driveFolderIdSchema.parse(folderId)))}`), "PATCH", driveFolderNameSchema.parse({ name }));
  }
  async driveDeleteFolder(scope: DriveScope, folderId: DriveFolderId) {
    await this.request<void>(this.driveUrl(scope, `/folders/${encodeURIComponent(String(driveFolderIdSchema.parse(folderId)))}`), "DELETE");
  }
  async driveMoveFile(scope: DriveScope, fileId: string, from: DriveFolderId | null, to: DriveFolderId | null) {
    await this.request<void>(this.driveUrl(scope, `/files/${positiveCreationIdSchema.parse(Number(fileId))}/folder`, from !== null ? { folderId: String(from) } : {}), "PATCH", driveMoveSchema.parse({ folderId: to }));
  }
  async driveDeleteFile(scope: DriveScope, fileId: string, folderId: DriveFolderId | null) {
    await this.request<void>(this.driveUrl(scope, `/files/${positiveCreationIdSchema.parse(Number(fileId))}`, folderId !== null ? { folderId: String(folderId) } : {}), "DELETE");
  }
  private threadUrl(scope: ThreadScope, suffix = "", tab: ThreadTab | null = null, page?: number) {
    const { path, query } = threadRoute(scope);
    if (tab) query.set("tab", threadTabSchema.parse(tab));
    if (page !== undefined) query.set("page", String(Math.max(0, Math.trunc(page))));
    return `${path}${suffix}?${query.toString()}`;
  }
  async threadList(scope: ThreadScope, tab: ThreadTab | null, page: number) {
    return threadPageSchema.parse(await this.request<unknown>(this.threadUrl(scope, "", tab, page)));
  }
  async threadSend(scope: ThreadScope, tab: ThreadTab | null, text: string, files: DriveUpload[], mentions: ThreadMention[]) {
    const message = threadTextSchema.parse(text);
    const active = threadMentionsSchema.parse(threadActiveMentions(message, mentions));
    if (files.length === 0) { await this.request<void>(this.threadUrl(scope, "", tab), "POST", { text: message, ...(active.length > 0 ? { mentions: active } : {}) }); return; }
    if (files.length > THREAD_ATTACHMENTS_MAX) throw new Error(`Puedes adjuntar hasta ${THREAD_ATTACHMENTS_MAX} archivos por mensaje.`);
    const body = new FormData();
    if (message) body.append("text", message);
    if (active.length > 0) body.append("mentions", JSON.stringify(active));
    for (const file of files) await appendPhoto(body, file);
    await this.request<void>(this.threadUrl(scope, "", tab), "POST", body);
  }
  async threadEdit(scope: ThreadScope, tab: ThreadTab | null, messageId: string, text: string, mentions: ThreadMention[]) {
    const active = threadActiveMentions(text, mentions);
    await this.request<void>(this.threadUrl(scope, `/messages/${positiveCreationIdSchema.parse(Number(messageId))}`, tab), "PATCH",
      threadEditSchema.parse({ text, ...(active.length > 0 ? { mentions: active } : {}) }));
  }
  async threadPeople(scope: ThreadScope) {
    return threadPeopleSchema.parse(await this.request<unknown>(this.threadUrl(scope, "/people"))).people;
  }
  async threadLive(scope: ThreadScope, tab: ThreadTab | null, version: number, typingSeen: string[]) {
    const { path, query } = threadRoute(scope);
    if (tab) query.set("tab", threadTabSchema.parse(tab));
    query.set("version", String(Math.max(0, Math.trunc(version))));
    if (typingSeen.length > 0) query.set("typing", typingSeen.join("|").slice(0, 700));
    return threadLiveSchema.parse(await this.request<unknown>(`${path}/live?${query.toString()}`));
  }
  async threadTyping(scope: ThreadScope, tab: ThreadTab | null, typing: boolean) {
    await this.request<unknown>(this.threadUrl(scope, "/typing", tab), "POST", { typing });
  }
  async deletionCheck(scope: DeletionScope) {
    return deletionCheckSchema.parse(await this.request<unknown>(deletionRoute(scope)));
  }
  async deleteRecord(scope: DeletionScope) {
    return deletionCheckSchema.parse(await this.request<unknown>(deletionRoute(scope), "DELETE"));
  }
  async workshopOrderFiles(entryId: number, orderId: number, branchId: number) {
    return (await this.request<{ data: Attachment[] }>(`${this.workshopOrderPath(entryId, orderId)}/files?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`)).data;
  }
  async uploadWorkshopOrderFiles(entryId: number, orderId: number, branchId: number, files: LocalPhoto[]) {
    for (const file of files) {
      const body = new FormData();
      await appendPhoto(body, file);
      await this.request<void>(`${this.workshopOrderPath(entryId, orderId)}/files?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, "POST", body);
    }
  }
  deleteWorkshopOrderFile(entryId: number, orderId: number, branchId: number, fileId: string) {
    return this.request<void>(`${this.workshopOrderPath(entryId, orderId)}/files/${positiveCreationIdSchema.parse(Number(fileId))}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`, "DELETE");
  }
  async createWorkshopOrder(entryId: number, input: WorkshopOrderInput) {
    return workshopOrderResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/orders`, "POST", workshopOrderInputSchema.parse(input)));
  }
  async addWorksToOrder(entryId: number, orderId: number, input: { companyBranchId: number; workIds: number[] }) {
    const path = `/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/orders/${positiveCreationIdSchema.parse(orderId)}/works`;
    return workshopOrderWorksResultSchema.parse(await this.request<unknown>(path, "POST", workshopOrderWorksInputSchema.parse(input)));
  }
  async sendOrderToCommercial(entryId: number, orderId: number, branchId: number) {
    const path = `${this.workshopOrderPath(entryId, orderId)}/send`;
    return workshopOrderSentSchema.parse(await this.request<unknown>(path, "POST", workshopOrderActionInputSchema.parse({ companyBranchId: branchId })));
  }
  async deleteWorkshopOrder(entryId: number, orderId: number, branchId: number) {
    const path = `/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/orders/${positiveCreationIdSchema.parse(orderId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`;
    return workshopOrderDeletedSchema.parse(await this.request<unknown>(path, "DELETE"));
  }
  async workshopFreeWorks(entryId: number, branchId: number, search: string) {
    const query = new URLSearchParams({ companyBranchId: String(positiveCreationIdSchema.parse(branchId)) });
    if (search.trim()) query.set("search", search.trim().slice(0, 100));
    return workshopFreeWorksSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/free-works?${query.toString()}`));
  }
  async linkWorkshopWorks(entryId: number, input: { companyBranchId: number; workIds: number[] }) {
    return workshopLinkWorksResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/works/link`, "POST", workshopLinkWorksInputSchema.parse(input)));
  }
  async workshopWorkers(branchId: number) {
    return workshopWorkersSchema.parse(await this.request<unknown>(`/api/workshop/options/workers?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`));
  }
  async workshopSavedSignatures(branchId: number, userId: number) {
    const query = `companyBranchId=${positiveCreationIdSchema.parse(branchId)}&userId=${positiveCreationIdSchema.parse(userId)}`;
    return workshopSavedSignaturesSchema.parse(await this.request<unknown>(`/api/workshop/options/signatures?${query}`));
  }
  async saveWorkshopSignature(branchId: number, userId: number, input: WorkshopSignatureSaveInput) {
    const path = `/api/workshop/signatures/users/${positiveCreationIdSchema.parse(userId)}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`;
    return workshopSavedSignaturesSchema.parse(await this.request<unknown>(path, "POST", workshopSignatureSaveInputSchema.parse(input)));
  }
  private emailPath(branchId: number, suffix: string) {
    return `/api/workshop${suffix}?companyBranchId=${positiveCreationIdSchema.parse(branchId)}`;
  }
  async workshopEmailEligibility(branchId: number, entryId: number) {
    return emailEligibilitySchema.parse(await this.request<unknown>(this.emailPath(branchId, `/entries/${positiveCreationIdSchema.parse(entryId)}/emails/eligibility`)));
  }
  async workshopEmailOptions(branchId: number) {
    return emailOptionsSchema.parse(await this.request<unknown>(this.emailPath(branchId, "/emails/options")));
  }
  async workshopEmailPreview(branchId: number, entryId: number, input: { templateId: number | null; recipientName: string | null }) {
    return emailPreviewSchema.parse(await this.request<unknown>(this.emailPath(branchId, `/entries/${positiveCreationIdSchema.parse(entryId)}/emails/preview`), "POST", emailPreviewInputSchema.parse(input)));
  }
  async sendWorkshopEmail(branchId: number, entryId: number, input: EmailSendInput) {
    return emailSendResultSchema.parse(await this.request<unknown>(this.emailPath(branchId, `/entries/${positiveCreationIdSchema.parse(entryId)}/emails`), "POST", emailSendInputSchema.parse(input)));
  }
  async workshopEmailHistory(branchId: number, entryId: number) {
    return emailHistorySchema.parse(await this.request<unknown>(this.emailPath(branchId, `/entries/${positiveCreationIdSchema.parse(entryId)}/emails`)));
  }
  async signWorkshopReception(entryId: number, input: WorkshopReceptionInput) {
    return workshopReceptionResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/reception`, "POST", workshopReceptionInputSchema.parse(input)));
  }
  async uploadWorkshopEntryImage(entryId: number, input: WorkshopImageInput) {
    return workshopIntakeResultSchema.parse(await this.request<unknown>(`/api/workshop/entries/${positiveCreationIdSchema.parse(entryId)}/image`, "POST", workshopImageInputSchema.parse(input)));
  }
  async reportAppErrors(errors: AppError[]) {
    return appErrorResultSchema.parse(await this.request<unknown>("/api/diagnostics/errors", "POST", appErrorBatchSchema.parse({ errors })));
  }
  async materialDispositions(input: MaterialDispositionInput) {
    const { id, ...body } = materialDispositionInputSchema.parse(input);
    return materialReceiptSchema.parse(await this.request<unknown>(`/api/material-receipts/${id}/dispositions`, "POST", body));
  }
  async equipmentLocation(scope: import("../domain/models").WorkScope, target: import("../domain/equipmentLocation").EquipmentLocationTarget) {
    const { equipmentLocationSchema, equipmentLocationTargetSchema } = await import("../domain/equipmentLocation");
    return equipmentLocationSchema.parse(await this.request<unknown>(this.scopePath(scope, `/equipment-location/${equipmentLocationTargetSchema.parse(target)}`)));
  }
  async workEdit(scope: import("../domain/models").WorkScope) {
    const { workEditDocumentSchema } = await import("../domain/creation");
    return workEditDocumentSchema.parse(await this.request<unknown>(this.scopePath(scope, "/edit/full")));
  }
  async updateWork(scope: import("../domain/models").WorkScope, input: import("../domain/creation").WorkEditInput) {
    const { workEditDocumentSchema, workEditInputSchema } = await import("../domain/creation");
    return workEditDocumentSchema.parse(await this.request<unknown>(this.scopePath(scope, "/edit/full"), "PATCH", workEditInputSchema.parse(input)));
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
  async ownProfile() {
    return ownProfileSchema.parse(await this.request<unknown>("/api/user-profile"));
  }
  async saveOwnProfile(input: OwnProfileInput) {
    return ownProfileSchema.parse(await this.request<unknown>("/api/user-profile", "PUT", ownProfileInputSchema.parse(input)));
  }
  async saveOwnAvatar(input: OwnAvatarInput) {
    return ownProfileSchema.parse(await this.request<unknown>("/api/user-profile/avatar", "PUT", ownAvatarInputSchema.parse(input)));
  }
  async removeOwnAvatar() {
    return ownProfileSchema.parse(await this.request<unknown>("/api/user-profile/avatar", "DELETE"));
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
  workTeam: WorkTeamPort["workTeam"] = async scope => workTeamSchema.parse(await this.request<unknown>(this.scopePath(scope, "/team")));
  addWorkTeamMember: WorkTeamPort["addWorkTeamMember"] = async (scope, workerId) =>
    workTeamSchema.parse(await this.request<unknown>(this.scopePath(scope, "/team"), "POST", workTeamAddInputSchema.parse({ workerId })));
  removeWorkTeamMember: WorkTeamPort["removeWorkTeamMember"] = async (scope, workerId) =>
    workTeamSchema.parse(await this.request<unknown>(this.scopePath(scope, `/team/${positiveCreationIdSchema.parse(workerId)}`), "DELETE"));

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
      if ((input.kind === "activity" || input.kind === "timer" || input.kind === "checklist" || input.kind === "completion") && error instanceof ApiError && error.status === 400
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
    if (parsed.systemId !== undefined) query.set("systemId", String(parsed.systemId));
    if (parsed.page !== undefined) query.set("page", String(parsed.page));
    return creationOptionsSchema.parse(await this.request<unknown>(`/api/creation/options?${query}`));
  }
  private notificationPath(branch: number, suffix: string): string {
    return `/api/mobile-notifications/${suffix}?companyBranchId=${positiveCreationIdSchema.parse(branch)}`;
  }
  async activeTimers(branch: number) { return activeTimersSchema.parse(await this.request<unknown>(this.notificationPath(branch, "active-timers"))).items; }
  async notificationStatus(branch: number) { return notificationStatusSchema.parse(await this.request<unknown>(this.notificationPath(branch, "status"))); }
  async registerNotificationDevice(input: NotificationDeviceInput) {
    return notificationDeviceResultSchema.parse(await this.request<unknown>("/api/mobile-notifications/device", "PUT", notificationDeviceInputSchema.parse(input)));
  }
  unregisterNotificationDevice(branch: number, installation: string) { return this.request<void>(this.notificationPath(branch, `device/${mobileUuidSchema.parse(installation)}`), "DELETE"); }
  async notificationInbox(branch: number, page: number, unreadOnly?: boolean) {
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error("MOBILE_PUSH_INVALID_PAGE");
    const result = notificationInboxSchema.parse(await this.request<unknown>(`${this.notificationPath(branch, "inbox")}&page=${page}${unreadOnly === true ? "&unreadOnly=true" : ""}`));
    if (result.page !== page) throw new Error("MOBILE_PUSH_IDENTITY_MISMATCH");
    // Un aviso de otra empresa o sucursal (base de datos compartida) se omite en vez de invalidar toda la bandeja.
    const origin = this.selectedTenant().portalOrigin;
    return { ...result, items: result.items.filter((item) => item.data.companyBranchId === branch && item.data.tenantOrigin === origin) };
  }
  async readNotification(branch: number, id: string) { return notificationReadResultSchema.parse(await this.request<unknown>(this.notificationPath(branch, `inbox/${mobileUuidSchema.parse(id)}/read`), "PATCH")); }
  async readAllNotifications(branch: number) { return notificationReadAllResultSchema.parse(await this.request<unknown>(this.notificationPath(branch, "inbox/read-all"), "PATCH")); }
  async deleteNotification(branch: number, id: string) {
    const eventId = mobileUuidSchema.parse(id);
    const result = notificationDeleteResultSchema.parse(await this.request<unknown>(this.notificationPath(branch, `inbox/${encodeURIComponent(eventId)}`), "DELETE"));
    if (result.id !== eventId) throw new Error("MOBILE_PUSH_IDENTITY_MISMATCH");
    return result;
  }
  async testNotification(branch: number) { return notificationTestResultSchema.parse(await this.request<unknown>(this.notificationPath(branch, "test"), "POST")); }

  private async request<T>(path: string, method = "GET", body?: object | FormData, receiptOperationId?: string, onResponseHeaders?: (timing: TenantChallengeResponseTiming) => void, signal?: AbortSignal, extraHeaders?: { [name: string]: string }): Promise<T> {
    const controller = new AbortController();
    // Con archivos se espera más que la pasarela (hasta 10 min según tamaño) para no cortar una subida lenta que sí avanza.
    const timeout = setTimeout(() => controller.abort(), body instanceof FormData ? 11 * 60_000 : 45_000);
    const cancel = () => { clearTimeout(timeout); controller.abort(); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) throw new AssignmentReadCancelledError();
      const headers: { [name: string]: string } = {};
      if (Platform.OS === "web") headers["X-Qualitzer-Session"] = "cookie";
      else if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (this.tenant) headers["X-Qualitzer-Tenant"] = this.tenant.id;
      if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
      if (extraHeaders) Object.assign(headers, extraHeaders);
      const requestBody = body instanceof FormData ? body : body ? JSON.stringify(body) : undefined;
      const requestStartedAt = onResponseHeaders ? tenantChallengeMonotonicNow() : 0;
      const sentAt = Date.now();
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
      // Hora del servidor para corregir lo que se guarda sin conexión si el reloj del teléfono está desajustado.
      noteServerDate(response.headers?.get?.("Date"), sentAt, Date.now());
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
      // La huella conocida solo sirve para consultar un día: es la copia local de ese día la que se compara.
      const knownRevision = days.length === 1 && options?.knownRevision && ASSIGNMENTS_REVISION_PATTERN.test(options.knownRevision) ? options.knownRevision : undefined;
      let revision: string | undefined;
      const snapshots = await batch.map(requestedDays, async (date) => {
        const data = await batch.wait(() => this.request<Assignments & { unchanged?: unknown }>(`/api/assignments?${new URLSearchParams({ ...dailyRange(date), companyBranchId: String(branchId) })}`, "GET", undefined, undefined, undefined, batch.signal,
          knownRevision ? { "X-Qualitzer-Known-Revision": knownRevision } : undefined));
        if (knownRevision && data?.unchanged === true && data.revision === knownRevision) throw new AssignmentsUnchangedError(knownRevision);
        if (!cachedAssignmentsSchema.safeParse(data).success) throw new ApiError(502, "UPSTREAM_INVALID_RESPONSE", apiMessage("UPSTREAM_INVALID_RESPONSE"));
        if (days.length === 1 && typeof data.revision === "string" && ASSIGNMENTS_REVISION_PATTERN.test(data.revision)) revision = data.revision;
        const snapshot = { date, data };
        completed.push(snapshot);
        batch.check();
        options?.onProgress?.(mergeDailyAssignments(completed, range.startDate), completed.map(item => item.date));
        return snapshot;
      }, options?.getPriorityDate);
      const merged = mergeDailyAssignments(snapshots, range.startDate);
      return revision ? { ...merged, revision } : merged;
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
import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { WorkshopBoard, WorkshopBoardPort, WorkshopOption } from "../domain/workshopBoard";
import type { WorkshopEntryDetail, WorkshopEntryPort } from "../domain/workshopEntry";
import type { WorkshopEquipmentQuery, WorkshopIntakeInput, WorkshopIntakePort } from "../domain/workshopIntake";
import type { InspectionAnswerInput, InspectionDamageInput, InspectionKind, WorkshopInspectionPort } from "../domain/workshopInspection";
import type { WorkshopReceptionInput, WorkshopReceptionPort } from "../domain/workshopReception";
import type { WorkshopWorksPort } from "../domain/workshopWorks";
import type { LocalPhoto } from "../domain/models";
import type { WorkshopOrderGeneralInput, WorkshopOrderInput, WorkshopOrderItemInput, WorkshopOrderItemSection, WorkshopOrdersPort } from "../domain/workshopOrders";
import type { WorkshopDeliveryInput, WorkshopDeliveryPort } from "../domain/workshopDelivery";
import type { WorkshopManagePort } from "../domain/workshopManage";
import type { WorkshopBranchDuplicateQuery, WorkshopContactDuplicateQuery, WorkshopCustomerDuplicateQuery, WorkshopCustomersPort, WorkshopDuplicateMatch,
  WorkshopNewBranch, WorkshopNewContact, WorkshopNewCustomer, WorkshopNewEquipment, EquipmentMasterKind, WorkshopNewEquipmentMaster,
  WorkshopEquipmentDuplicate, WorkshopEquipmentDuplicateQuery } from "../domain/workshopCustomers";
import { driveApi, fileDrivePort, type DriveApi, type FileDrivePort } from "../domain/fileDrive";
import { threadApi, threadPort, type ThreadApi, type ThreadPort } from "../domain/threads";

/**
 * Tablero del taller (naves e ingresos), solo lectura. Recuerda el último taller elegido por usuario y sucursal,
 * y se actualiza cada minuto y al volver a la app.
 */
export type WorkshopBoardLayout = "extended" | "compact";

/** Función del puerto ligada a su objeto: el repositorio HTTP es una clase y sus métodos usan `this`. */
function bound<T extends object, K extends keyof T>(port: T | null | undefined, name: K): T[K] | undefined {
  const method = port?.[name];
  return typeof method === "function" ? (method as (...args: unknown[]) => unknown).bind(port) as T[K] : undefined;
}

export function useWorkshopBoard(port: Partial<WorkshopBoardPort & WorkshopEntryPort & WorkshopIntakePort & WorkshopInspectionPort & WorkshopReceptionPort & WorkshopWorksPort & WorkshopOrdersPort & WorkshopDeliveryPort & WorkshopManagePort & WorkshopCustomersPort & FileDrivePort & ThreadPort> | null, userId: number, branchId: number, storageKey: string, sessionIdentity: string, enabled: boolean) {
  const key = `workshop-board:${storageKey}:${userId}:${branchId}`;
  const [workshops, setWorkshops] = useState<WorkshopOption[] | null>(null);
  const [workshopId, setWorkshopId] = useState<number | null>(null);
  const [board, setBoard] = useState<WorkshopBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const current = useRef({ key, sessionIdentity, port, workshopId });
  current.current = { key, sessionIdentity, port, workshopId };
  const revision = useRef(0);
  const sameScope = () => current.current.key === key && current.current.sessionIdentity === sessionIdentity && current.current.port === port;

  async function loadBoard(target: number | null = current.current.workshopId) {
    if (!enabled || !port?.workshopBoard || target === null || branchId <= 0) return;
    const read = ++revision.current;
    setLoading(true);
    try {
      const result = await port.workshopBoard(branchId, target);
      if (sameScope() && read === revision.current) { setBoard(result); setError(""); }
    } catch {
      if (sameScope() && read === revision.current) setError("No se pudo cargar el taller. Revisa tu conexión.");
    } finally {
      if (sameScope() && read === revision.current) setLoading(false);
    }
  }

  // Al cambiar de sesión o sucursal: lista de talleres y el último elegido (o el primero).
  useEffect(() => {
    let active = true;
    setWorkshops(null); setWorkshopId(null); setBoard(null); setError(""); revision.current++;
    if (!enabled || !port?.workshops || branchId <= 0) return;
    void (async () => {
      try {
        const [list, saved] = await Promise.all([port.workshops!(branchId), AsyncStorage.getItem(key).catch(() => null)]);
        if (!active) return;
        setWorkshops(list.items);
        const remembered = list.items.find((item) => String(item.id) === saved);
        setWorkshopId((remembered ?? list.items[0])?.id ?? null);
      } catch {
        if (active) setError("No se pudieron cargar los talleres. Revisa tu conexión.");
      }
    })();
    return () => { active = false; };
  }, [key, sessionIdentity, enabled, port]);

  useEffect(() => {
    if (workshopId === null || !enabled) return;
    void loadBoard(workshopId);
    const interval = setInterval(() => { void loadBoard(); }, 60000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void loadBoard(); });
    return () => { clearInterval(interval); subscription.remove(); };
  }, [workshopId, enabled, key, sessionIdentity, port]);

  // Naves fijadas (aparecen primero), guardadas en el teléfono por usuario, sucursal y taller.
  const [pinned, setPinned] = useState<number[]>([]);
  const pinKey = workshopId === null ? null : `${key}:pinned:${workshopId}`;
  useEffect(() => {
    setPinned([]);
    if (pinKey === null) return;
    let active = true;
    AsyncStorage.getItem(pinKey).then((raw) => {
      if (!active || !raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) setPinned(parsed.filter((value): value is number => Number.isSafeInteger(value) && value > 0).slice(0, 50));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [pinKey]);
  function togglePin(areaId: number) {
    if (pinKey === null) return;
    setPinned((current) => {
      const next = current.includes(areaId) ? current.filter((value) => value !== areaId) : [...current, areaId];
      void AsyncStorage.setItem(pinKey, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }

  // Vista de las naves (extendida o compacta), guardada en el teléfono por usuario.
  const [layout, setLayoutState] = useState<WorkshopBoardLayout>("extended");
  const layoutKey = `workshop-board-layout:${storageKey}:${userId}`;
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(layoutKey).then((raw) => { if (active && (raw === "compact" || raw === "extended")) setLayoutState(raw); }).catch(() => undefined);
    return () => { active = false; };
  }, [layoutKey]);
  function setLayout(next: WorkshopBoardLayout) {
    setLayoutState(next);
    void AsyncStorage.setItem(layoutKey, next).catch(() => undefined);
  }

  function selectWorkshop(id: number) {
    if (id === workshopId) return;
    setBoard(null);
    setWorkshopId(id);
    void AsyncStorage.setItem(key, String(id)).catch(() => undefined);
  }

  /** Ficha de un ingreso con la misma conexión y sucursal del tablero. */
  async function loadEntry(entryId: number): Promise<WorkshopEntryDetail> {
    if (!enabled || !port?.workshopEntry || branchId <= 0) throw new Error("WORKSHOP_ENTRY_UNAVAILABLE");
    return port.workshopEntry(branchId, entryId);
  }

  /** Acciones del formulario de ingreso con la sucursal del tablero. Solo con conexión. */
  function need<K extends keyof WorkshopIntakePort>(name: K): NonNullable<Partial<WorkshopIntakePort>[K]> {
    const action = bound(port, name);
    if (!enabled || !action || branchId <= 0) throw new Error("No se puede usar el ingreso en este momento. Revisa tu conexión.");
    return action as NonNullable<Partial<WorkshopIntakePort>[K]>;
  }
  const intake = {
    branchId,
    draftKey: `workshop-intake-draft:${storageKey}:${userId}:${branchId}`,
    customers: (search: string, page: number) => need("workshopCustomers")(branchId, search, page),
    customer: (customerId: number) => need("workshopCustomer")(branchId, customerId),
    equipment: (query: Omit<WorkshopEquipmentQuery, "companyBranchId">) => need("workshopEquipment")({ ...query, companyBranchId: branchId }),
    areas: (targetWorkshopId: number) => need("workshopAreas")(branchId, targetWorkshopId),
    form: (entryId: number) => need("workshopIntakeForm")(branchId, entryId),
    create: (input: WorkshopIntakeInput) => need("createWorkshopEntry")(input),
    update: (entryId: number, input: WorkshopIntakeInput) => need("updateWorkshopEntry")(entryId, input),
    uploadImage: (entryId: number, image: string) => need("uploadWorkshopEntryImage")(entryId, { companyBranchId: branchId, image }),
    identificationTypes: () => needCustomers("workshopIdentificationTypes")(branchId),
    createCustomer: (input: Omit<WorkshopNewCustomer, "companyBranchId">) => needCustomers("createWorkshopCustomer")({ ...input, companyBranchId: branchId }),
    createBranch: (customerId: number, input: Omit<WorkshopNewBranch, "companyBranchId">) => needCustomers("createWorkshopCustomerBranch")(customerId, { ...input, companyBranchId: branchId }),
    createContact: (customerId: number, input: Omit<WorkshopNewContact, "companyBranchId">) => needCustomers("createWorkshopCustomerContact")(customerId, { ...input, companyBranchId: branchId }),
    equipmentMasters: () => needCustomers("workshopEquipmentMasters")(branchId),
    // Búsqueda de parecidos antes de crear: si el gateway no la tiene o falla, no se bloquea la creación.
    customerDuplicates: async (query: Omit<WorkshopCustomerDuplicateQuery, "companyBranchId">): Promise<WorkshopDuplicateMatch[]> => {
      const action = bound(port, "workshopCustomerDuplicates");
      if (!enabled || !action || branchId <= 0) return [];
      return await action({ ...query, companyBranchId: branchId }).catch(() => []);
    },
    contactDuplicates: async (customerId: number, query: Omit<WorkshopContactDuplicateQuery, "companyBranchId">): Promise<WorkshopDuplicateMatch[]> => {
      const action = bound(port, "workshopContactDuplicates");
      if (!enabled || !action || branchId <= 0) return [];
      return await action(customerId, { ...query, companyBranchId: branchId }).catch(() => []);
    },
    branchDuplicates: async (customerId: number, query: Omit<WorkshopBranchDuplicateQuery, "companyBranchId">): Promise<WorkshopDuplicateMatch[]> => {
      const action = bound(port, "workshopBranchDuplicates");
      if (!enabled || !action || branchId <= 0) return [];
      return await action(customerId, { ...query, companyBranchId: branchId }).catch(() => []);
    },
    equipmentDuplicates: async (query: Omit<WorkshopEquipmentDuplicateQuery, "companyBranchId">): Promise<WorkshopEquipmentDuplicate[]> => {
      const action = bound(port, "workshopEquipmentDuplicates");
      if (!enabled || !action || branchId <= 0) return [];
      return await action({ ...query, companyBranchId: branchId }).catch(() => []);
    },
    createEquipment: (customerId: number, input: Omit<WorkshopNewEquipment, "companyBranchId">) => needCustomers("createWorkshopCustomerEquipment")(customerId, { ...input, companyBranchId: branchId }),
    canCreateEquipmentMaster: enabled && branchId > 0 && Boolean(bound(port, "createWorkshopEquipmentMaster")),
    createEquipmentMaster: (kind: EquipmentMasterKind, input: Omit<WorkshopNewEquipmentMaster, "companyBranchId">) => needCustomers("createWorkshopEquipmentMaster")(kind, { ...input, companyBranchId: branchId })
  };
  /** Crear clientes, sucursales y contactos desde el ingreso. Solo con conexión. */
  function needCustomers<K extends keyof WorkshopCustomersPort>(name: K): NonNullable<Partial<WorkshopCustomersPort>[K]> {
    const action = bound(port, name);
    if (!enabled || !action || branchId <= 0) throw new Error("No se puede crear en este momento. Revisa tu conexión.");
    return action as NonNullable<Partial<WorkshopCustomersPort>[K]>;
  }

  /** Inspección de ingreso o entrega con la sucursal del tablero. Solo con conexión. */
  function needInspection<K extends keyof WorkshopInspectionPort>(name: K): NonNullable<Partial<WorkshopInspectionPort>[K]> {
    const action = bound(port, name);
    if (!enabled || !action || branchId <= 0) throw new Error("No se puede usar la inspección en este momento. Revisa tu conexión.");
    return action as NonNullable<Partial<WorkshopInspectionPort>[K]>;
  }
  const inspection = {
    branchId,
    open: (entryId: number, kind: InspectionKind) => needInspection("openInspection")(entryId, { companyBranchId: branchId, kind }),
    load: (entryId: number, inspectionId: number) => needInspection("inspection")(entryId, inspectionId, branchId),
    checklistOptions: () => needInspection("inspectionChecklistOptions")(branchId),
    setChecklists: (entryId: number, inspectionId: number, checklistIds: number[]) => needInspection("setInspectionChecklists")(entryId, inspectionId, { companyBranchId: branchId, checklistIds }),
    answer: (entryId: number, inspectionId: number, input: Omit<InspectionAnswerInput, "companyBranchId">) => needInspection("answerInspectionStep")(entryId, inspectionId, { ...input, companyBranchId: branchId }),
    uploadPhoto: (entryId: number, inspectionId: number, slotKey: string, image: string, source: "camera" | "gallery") =>
      needInspection("uploadInspectionPhoto")(entryId, inspectionId, slotKey, { companyBranchId: branchId, image, source }),
    deletePhoto: (entryId: number, inspectionId: number, slotKey: string) => needInspection("deleteInspectionPhoto")(entryId, inspectionId, slotKey, branchId),
    uploadStepFile: (entryId: number, inspectionId: number, stepId: number, image: string, source: "camera" | "gallery") =>
      needInspection("uploadInspectionStepFile")(entryId, inspectionId, stepId, { companyBranchId: branchId, image, source }),
    deleteStepFile: (entryId: number, inspectionId: number, fileId: number) => needInspection("deleteInspectionStepFile")(entryId, inspectionId, fileId, branchId),
    saveDamage: (entryId: number, inspectionId: number, input: Omit<InspectionDamageInput, "companyBranchId">) => needInspection("saveInspectionDamage")(entryId, inspectionId, { ...input, companyBranchId: branchId }),
    deleteDamage: (entryId: number, inspectionId: number, damageId: number) => needInspection("deleteInspectionDamage")(entryId, inspectionId, damageId, branchId),
    uploadDamagePhoto: (entryId: number, inspectionId: number, damageId: number, image: string, source: "camera" | "gallery") =>
      needInspection("uploadInspectionDamagePhoto")(entryId, inspectionId, damageId, { companyBranchId: branchId, image, source }),
    saveObservation: (entryId: number, inspectionId: number, observation: string | null) => needInspection("saveInspectionMeta")(entryId, inspectionId, { companyBranchId: branchId, observation }),
    complete: (entryId: number, inspectionId: number) => needInspection("completeInspection")(entryId, inspectionId, branchId),
    uploadCustomPhoto: (entryId: number, inspectionId: number, label: string, image: string, source: "camera" | "gallery") =>
      needInspection("uploadInspectionPhoto")(entryId, inspectionId, `custom-${Date.now()}`, { companyBranchId: branchId, image, source, label }),
    share: (entryId: number, inspectionId: number) => needInspection("inspectionShare")(entryId, inspectionId, branchId),
    extendShare: (entryId: number, inspectionId: number) => needInspection("extendInspectionShare")(entryId, inspectionId, branchId),
    downloadPhotos: (entryId: number, inspectionId: number, name: string) => needInspection("downloadInspectionPhotos")(entryId, inspectionId, branchId, name)
  };

  /** Recepción y firma con la sucursal del tablero. Solo con conexión. */
  function needReception<K extends keyof WorkshopReceptionPort>(name: K): NonNullable<Partial<WorkshopReceptionPort>[K]> {
    const action = bound(port, name);
    if (!enabled || !action || branchId <= 0) throw new Error("No se puede firmar en este momento. Revisa tu conexión.");
    return action as NonNullable<Partial<WorkshopReceptionPort>[K]>;
  }
  const reception = {
    branchId,
    /** Usuario en sesión: si es trabajador de la sucursal, se propone como técnico que recibe. */
    currentUserId: userId,
    workers: () => needReception("workshopWorkers")(branchId),
    savedSignatures: (userId: number) => needReception("workshopSavedSignatures")(branchId, userId),
    sign: (entryId: number, input: Omit<WorkshopReceptionInput, "companyBranchId">) => needReception("signWorkshopReception")(entryId, { ...input, companyBranchId: branchId })
  };

  /** Trabajos del ingreso con la sucursal del tablero. Solo con conexión. */
  function needWorks<K extends keyof WorkshopWorksPort>(name: K): NonNullable<Partial<WorkshopWorksPort>[K]> {
    const action = bound(port, name);
    if (!enabled || !action || branchId <= 0) throw new Error("No se pueden gestionar trabajos en este momento. Revisa tu conexión.");
    return action as NonNullable<Partial<WorkshopWorksPort>[K]>;
  }
  const works = {
    free: (entryId: number, search: string) => needWorks("workshopFreeWorks")(entryId, branchId, search),
    link: (entryId: number, workIds: number[]) => needWorks("linkWorkshopWorks")(entryId, { companyBranchId: branchId, workIds }),
    noteCreated: (entryId: number, workId: number) => { port?.noteCreatedWork?.(entryId, workId); }
  };

  /** Órdenes de trabajo del ingreso con la sucursal del tablero. Solo con conexión. */
  function needOrders<K extends keyof WorkshopOrdersPort>(name: K): NonNullable<Partial<WorkshopOrdersPort>[K]> {
    const action = bound(port, name);
    if (!enabled || !action || branchId <= 0) throw new Error("No se pueden gestionar órdenes de trabajo en este momento. Revisa tu conexión.");
    return action as NonNullable<Partial<WorkshopOrdersPort>[K]>;
  }
  const orders = {
    rules: (entryId: number) => needOrders("workshopOrderRules")(entryId, branchId),
    detail: (entryId: number, orderId: number) => needOrders("workshopOrderDetail")(entryId, orderId, branchId),
    updateGeneral: (entryId: number, orderId: number, input: Omit<WorkshopOrderGeneralInput, "companyBranchId">) =>
      needOrders("updateOrderGeneral")(entryId, orderId, { ...input, companyBranchId: branchId }),
    products: (search: string, page: number) => needOrders("workshopProducts")(branchId, search, page),
    transports: () => needOrders("workshopTransports")(branchId),
    addItem: (entryId: number, orderId: number, input: Omit<WorkshopOrderItemInput, "companyBranchId">) => needOrders("addOrderItem")(entryId, orderId, { ...input, companyBranchId: branchId }),
    updateItem: (entryId: number, orderId: number, section: WorkshopOrderItemSection, rowId: number, quantity: number, note?: string | null) =>
      needOrders("updateOrderItem")(entryId, orderId, section, rowId, { companyBranchId: branchId, quantity, ...(note !== undefined ? { note } : {}) }),
    removeItem: (entryId: number, orderId: number, section: WorkshopOrderItemSection | "works", rowId: number) => needOrders("removeOrderItem")(entryId, orderId, section, rowId, branchId),
    create: (entryId: number, input: Omit<WorkshopOrderInput, "companyBranchId">) => needOrders("createWorkshopOrder")(entryId, { ...input, companyBranchId: branchId }),
    addWorks: (entryId: number, orderId: number, workIds: number[]) => needOrders("addWorksToOrder")(entryId, orderId, { companyBranchId: branchId, workIds }),
    send: (entryId: number, orderId: number) => needOrders("sendOrderToCommercial")(entryId, orderId, branchId),
    remove: (entryId: number, orderId: number) => needOrders("deleteWorkshopOrder")(entryId, orderId, branchId),
    files: (entryId: number, orderId: number) => needOrders("workshopOrderFiles")(entryId, orderId, branchId),
    uploadFiles: (entryId: number, orderId: number, files: LocalPhoto[]) => needOrders("uploadWorkshopOrderFiles")(entryId, orderId, branchId, files),
    deleteFile: (entryId: number, orderId: number, fileId: string) => needOrders("deleteWorkshopOrderFile")(entryId, orderId, branchId, fileId)
  };

  const delivery = {
    deliver: (entryId: number, input: Omit<WorkshopDeliveryInput, "companyBranchId">) => {
      const action = bound(port, "deliverWorkshopEntry");
      if (!enabled || !action || branchId <= 0) throw new Error("No se puede entregar en este momento. Revisa tu conexión.");
      return action(entryId, { ...input, companyBranchId: branchId });
    }
  };

  /** Mover de nave, fecha estimada y estado, con la sucursal del tablero. Solo con conexión. */
  function needManage<K extends keyof WorkshopManagePort>(name: K): NonNullable<Partial<WorkshopManagePort>[K]> {
    const action = bound(port, name);
    if (!enabled || !action || branchId <= 0) throw new Error("No se puede modificar el ingreso en este momento. Revisa tu conexión.");
    return action as NonNullable<Partial<WorkshopManagePort>[K]>;
  }
  const manage = {
    areas: (targetWorkshopId: number) => need("workshopAreas")(branchId, targetWorkshopId),
    statuses: () => needManage("workshopStatuses")(branchId),
    move: (entryId: number, toAreaId: number, note: string | null) => needManage("moveWorkshopEntry")(entryId, { companyBranchId: branchId, toAreaId, note }),
    estimatedDelivery: (entryId: number, estimatedDeliveryAt: string, reason: string) =>
      needManage("changeEstimatedDelivery")(entryId, { companyBranchId: branchId, estimatedDeliveryAt, reason }),
    status: (entryId: number, statusId: number, subStatusId: number | null) => needManage("changeEntryStatus")(entryId, { companyBranchId: branchId, statusId, subStatusId })
  };

  /** Archivos con carpetas del ingreso y de sus OT. Solo con conexión. */
  const drivePort: FileDrivePort | null = enabled && branchId > 0 ? fileDrivePort(port) : null;
  const drive = {
    available: drivePort !== null,
    entry: (entryId: number): DriveApi | null => drivePort && driveApi(drivePort, { kind: "entry", companyBranchId: branchId, entryId }),
    order: (entryId: number, orderId: number): DriveApi | null => drivePort && driveApi(drivePort, { kind: "order", companyBranchId: branchId, entryId, orderId })
  };
  /** Comentarios (chat) del ingreso y de sus OT. Solo con conexión. */
  const chatPort: ThreadPort | null = enabled && branchId > 0 ? threadPort(port) : null;
  const threads = {
    available: chatPort !== null,
    entry: (entryId: number): ThreadApi | null => chatPort && threadApi(chatPort, { kind: "entry", companyBranchId: branchId, entryId }),
    order: (entryId: number, orderId: number): ThreadApi | null => chatPort && threadApi(chatPort, { kind: "order", companyBranchId: branchId, entryId, orderId })
  };
  return { workshops, workshopId, board, loading, error, refresh: () => loadBoard(), selectWorkshop, pinned, togglePin, layout, setLayout, loadEntry, intake, inspection, reception, works, orders, delivery, manage, drive, threads };
}

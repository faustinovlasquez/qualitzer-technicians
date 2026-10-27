import { useState, type ReactNode } from "react";
import { DeleteRecordDialog } from "../../deletion/DeleteRecordDialog";
import { pendingRecordChanges, type DeletionPort } from "../../domain/deletion";
import { isAppPermissionAllowed } from "../../domain/mobileAppConfig";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppPermissionsProvider } from "../../application/appPermissions";
import { assignmentWorkQueryRange } from "../../domain/assignmentSchedule";
import { isFinished, plainText } from "../../domain/format";
import type { MobileAppConfig } from "../../domain/mobileAppConfig";
import type { AssignmentGroup, AssignmentWork, DateRange, StatusInput, Tenant, WorkOpenOptions } from "../../domain/models";
import type { OfflineSnapshot } from "../../domain/offline";
import type { WorkshopOrdersPort } from "../../domain/workshopOrders";
import { driveApi, fileDrivePort, type FileDrivePort } from "../../domain/fileDrive";
import { threadApi, threadPort, type ThreadPort } from "../../domain/threads";
import { SessionContextBar } from "../../ui/SessionContextBar";
import { palette } from "../../ui/theme";
import { WorkshopOrderScreen, type Section } from "../../workshop/order/WorkshopOrderScreen";
import { AssignmentWorkCard } from "./AssignmentWorkCard";

/** Ingreso 0: el servidor de la app valida la OT contra la sucursal, sin pasar por un ingreso del Taller. */
const NO_ENTRY = 0;

/** Id de la OT (negociación) de un grupo de Mi jornada, o null si no es una OT. */
export function assignmentOrderId(group: AssignmentGroup): number | null {
  if (group.type !== "external_ot" || !group.id.startsWith("external-")) return null;
  const id = Number(group.id.slice("external-".length));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * OT de Mi jornada con el mismo detalle del Taller: datos, trabajos (con la tarjeta de Mi jornada), productos, transporte,
 * otros y archivos, editables con los permisos de la sucursal.
 */
export function OrderFullDetail({ group, orderId, port, branchId, mode, storageKey, permissions, tenant, branchName, connectionStatus, range, generatedAt, workerId,
  offline, busy, initialTab, onBack, onOpenWork, onWorkStatus, onLocationHistory, deletionPort, onDeleted }: {
  /** Eliminar la OT si la creó el técnico y sigue pendiente (lo revisa el servidor). */
  deletionPort?: DeletionPort | null; onDeleted?: () => void;
  group: AssignmentGroup; orderId: number; port: Partial<WorkshopOrdersPort>; branchId: number; mode: "live" | "demo"; storageKey: string;
  permissions: MobileAppConfig; tenant: Tenant; branchName: string; connectionStatus?: ReactNode; range: DateRange; generatedAt?: string;
  workerId: number | null | undefined; offline?: OfflineSnapshot | null; busy: boolean; initialTab?: "works" | "files" | "comments";
  onBack: () => void; onOpenWork: (group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions) => void;
  onWorkStatus: (group: AssignmentGroup, work: AssignmentWork, input: StatusInput) => Promise<void>; onLocationHistory?: () => void;
}) {
  /** Método del puerto con su objeto (los métodos de la clase usan `this`). */
  function call<K extends keyof WorkshopOrdersPort>(name: K): WorkshopOrdersPort[K] {
    const method = port[name];
    if (typeof method !== "function") throw new Error("Esta acción no está disponible. Actualiza la app.");
    return (method as (...args: never[]) => unknown).bind(port) as WorkshopOrdersPort[K];
  }
  const worksById = new Map(group.works.map((work) => [work.id, work]));
  const online = offline?.online ?? true;
  // Gestor con carpetas solo con conexión; sin ella queda la lista simple.
  const drivePort = online ? fileDrivePort(port as Partial<FileDrivePort>) : null;
  const chatPort = online ? threadPort(port as Partial<ThreadPort>) : null;
  const [deleting, setDeleting] = useState(false);
  const deletion = deletionPort && online && mode === "live" && isAppPermissionAllowed(permissions, "deleteOwn")
    ? { port: deletionPort, scope: { groupId: group.id, range: { startDate: range.startDate, endDate: range.endDate, companyBranchId: branchId } } } : null;

  return <AppPermissionsProvider value={permissions}>
    <SafeAreaView style={styles.safe}>
      <SessionContextBar tenant={tenant} branchName={branchName}>{connectionStatus}</SessionContextBar>
      <WorkshopOrderScreen initialSection={(initialTab === "files" || initialTab === "comments" ? initialTab : "works") satisfies Section}
        load={() => call("workshopOrderDetail")(NO_ENTRY, orderId, branchId)} onClose={onBack}
        onOpenWork={(workId) => { const work = worksById.get(String(workId)); if (work) onOpenWork(group, work); }}
        onSaveGeneral={(input) => call("updateOrderGeneral")(NO_ENTRY, orderId, { ...input, companyBranchId: branchId })}
        workCard={(workId) => {
          const work = worksById.get(String(workId));
          return work ? <AssignmentWorkCard key={work.id} group={group} work={work} currentWorkerId={workerId} queryDate={assignmentWorkQueryRange(work, range).startDate}
            companyBranchId={branchId} onOpenWork={onOpenWork} onWorkStatus={onWorkStatus} busy={busy} generatedAt={generatedAt} offline={offline} online={online} /> : null;
        }}
        workProgress={(workIds) => {
          const works = workIds.map((workId) => worksById.get(String(workId)));
          return workIds.length > 0 && works.every(Boolean) ? { completed: works.filter((work) => work && isFinished(work)).length, total: workIds.length } : null;
        }}
        items={{
          products: (search, page) => call("workshopProducts")(branchId, search, page), transports: () => call("workshopTransports")(branchId),
          add: (input) => call("addOrderItem")(NO_ENTRY, orderId, { ...input, companyBranchId: branchId }),
          update: (section, rowId, quantity, note) => call("updateOrderItem")(NO_ENTRY, orderId, section, rowId, { companyBranchId: branchId, quantity, ...(note !== undefined ? { note } : {}) }),
          remove: (section, rowId) => call("removeOrderItem")(NO_ENTRY, orderId, section, rowId, branchId)
        }}
        files={{
          load: () => call("workshopOrderFiles")(NO_ENTRY, orderId, branchId), upload: (files) => call("uploadWorkshopOrderFiles")(NO_ENTRY, orderId, branchId, files),
          remove: (fileId) => call("deleteWorkshopOrderFile")(NO_ENTRY, orderId, branchId, fileId), mode, scopeKey: storageKey,
          drive: mode === "live" && drivePort ? driveApi(drivePort, { kind: "order", companyBranchId: branchId, entryId: NO_ENTRY, orderId }) : null
        }}
        comments={mode === "live" && chatPort ? threadApi(chatPort, { kind: "order", companyBranchId: branchId, entryId: NO_ENTRY, orderId }) : null}
        onSend={() => call("sendOrderToCommercial")(NO_ENTRY, orderId, branchId).then(() => undefined)}
        onLocationHistory={onLocationHistory} onDelete={deletion ? () => setDeleting(true) : undefined} />
      {deleting && deletion ? <DeleteRecordDialog port={deletion.port} scope={deletion.scope} kind="order" name={plainText(group.title)} pendingCount={pendingRecordChanges(offline?.operations, group.id)}
        onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); onDeleted?.(); }} /> : null}
    </SafeAreaView>
  </AppPermissionsProvider>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.background } });

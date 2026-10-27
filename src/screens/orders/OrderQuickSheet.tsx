import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatThread } from "../../chat/ChatThread";
import { assignmentCodes } from "../../domain/assignmentCodes";
import { plainText } from "../../domain/format";
import { driveApi, type DriveApi, type FileDrivePort } from "../../domain/fileDrive";
import type { AssignmentGroup, AssignmentWork, DateRange } from "../../domain/models";
import { threadApi, type ThreadApi, type ThreadPort } from "../../domain/threads";
import { FileDrive } from "../../files/FileDrive";
import { PrivateModal } from "../../security/DeviceSecurityContext";
import { palette } from "../../ui/theme";

export type OrderQuickKind = "files" | "comments";

/** Ventana a pantalla completa con el gestor de archivos o el chat de un registro, encima de la lista. */
export function ResourceSheet({ sheetKey, title, subtitle, drive, thread, onClose }: {
  sheetKey: string; title: string; subtitle?: string; drive?: DriveApi | null; thread?: ThreadApi | null; onClose: () => void;
}) {
  const kind = drive ? "files" : "comments";
  return <PrivateModal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.safe} testID={`order-quick-${kind}`}>
      {drive ? <FileDrive key={sheetKey} api={drive} title={title} subtitle={subtitle} onClose={onClose} />
        : thread ? <ChatThread key={sheetKey} api={thread} title={title} subtitle={subtitle} onClose={onClose} draftKey={sheetKey} /> : null}
    </SafeAreaView>
  </PrivateModal>;
}

/**
 * Archivos o comentarios de una OT, un mantenimiento o un trabajo abiertos desde su tarjeta de Mi jornada, en una
 * ventana encima de la lista (sin entrar al detalle). En la OT son los comentarios generales (los comerciales quedan en
 * la web); en el trabajo, la conversación técnica.
 */
export function OrderQuickSheet({ group, work, kind, range, companyBranchId, drivePort, threadPort, onClose }: {
  group: AssignmentGroup; work?: AssignmentWork | null; kind: OrderQuickKind; range: DateRange; companyBranchId: number;
  drivePort: FileDrivePort; threadPort: ThreadPort; onClose: () => void;
}) {
  const scope = { kind: "assignment" as const, groupId: group.id, ...(work ? { workId: work.id } : {}), range: { startDate: range.startDate, endDate: range.endDate, companyBranchId } };
  const owner = work ? "del trabajo" : group.type === "internal_maintenance" ? "del mantenimiento" : "de la OT";
  const subtitle = (work ? assignmentCodes(group, work).workCode : null) ?? (plainText(group.code) || undefined);
  return <ResourceSheet sheetKey={`${group.id}:${work?.id ?? ""}:${kind}`} title={`${kind === "files" ? "Archivos" : "Comentarios"} ${owner}`} subtitle={subtitle}
    drive={kind === "files" ? driveApi(drivePort, scope) : null} thread={kind === "comments" ? threadApi(threadPort, scope) : null} onClose={onClose} />;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.background } });

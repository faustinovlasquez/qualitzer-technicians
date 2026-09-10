import { assignmentDays } from "../../domain/assignmentSchedule";
import type { AssignmentWork, DateRange } from "../../domain/models";
import type { OfflineResourceMetadata, OfflineSnapshot } from "../../domain/offline";
import { connectionPresentation } from "../../offline/connectionPresentation";

export function isPendingLocalWork(work: Pick<AssignmentWork, "id" | "missingRequiredInfo"> & { offline?: OfflineResourceMetadata }): boolean {
  if (work.id.startsWith("local-") || work.missingRequiredInfo.includes("OFFLINE_AWAITING_SERVER_SNAPSHOT")) return true;
  return "offline" in work && typeof work.offline === "object" && work.offline !== null
    && "confirmed" in work.offline && work.offline.confirmed === false;
}

export function unavailableCoverageDates(snapshot: OfflineSnapshot | null | undefined, range: DateRange, companyBranchId?: number): string[] {
  if (!snapshot || snapshot.online) return [];
  const covered = new Set(snapshot.coverage.filter((entry) => companyBranchId !== undefined && entry.branchId === companyBranchId).map((entry) => entry.date));
  return assignmentDays(range).filter((date) => !covered.has(date));
}

export function offlineStatusLabel(snapshot: OfflineSnapshot | null): string {
  return connectionPresentation(snapshot).label;
}
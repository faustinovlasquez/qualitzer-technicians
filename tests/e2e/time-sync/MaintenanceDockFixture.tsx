import { useState } from "react";
import { OrderDetailScreen } from "../../../src/screens/OrderDetailScreen";
import { makeDemoData, demoUser } from "../../../src/infrastructure/demoData";
import { demoCreationOptions } from "../../../src/infrastructure/creationDemo";
import type { CreationInput } from "../../../src/domain/creation";
import type { AssignmentGroup } from "../../../src/domain/models";

declare global { interface Window { maintenanceDock: { inputs: CreationInput[]; failRead: boolean; starts: number }; } }
export function MaintenanceDockFixture() {
  const template = makeDemoData().groups[0];
  const [group, setGroup] = useState<AssignmentGroup>(() => ({ ...template, id: "maintenance-369", code: "OT-COR-0369", type: "internal_maintenance", status: "pending", scheduledDate: "2026-09-23", works: [{ ...template.works[0], status: "paused" }], products: [] }));
  window.maintenanceDock ??= { inputs: [], failRead: false, starts: 0 };
  const tenant = { id: "tenant-1", name: "Empresa de prueba", portalOrigin: "https://tenant.example.com", environment: "production" as const };
  return <OrderDetailScreen group={group} tenant={tenant} branchName="Taller" mode="live" busy={false} storageKey="maintenance-dock" range={{ startDate: "2026-09-23", endDate: "2026-09-23" }} companyBranchId={1} technicianName="Tecnico"
    onBack={() => {}} onHome={() => {}} onRefresh={async () => {}} onWorkStatus={async () => {}} onOpenWork={() => {}} onLoadFiles={async () => []} onUploadFiles={async () => {}} onDeleteFile={async () => {}}
    onLoadDelivery={async () => ({ groupId: group.id, status: group.status, maintenanceType: "correctivo", finalizationNote: null, damageType: null, durationMinutes: null, startedAt: null, finalizedAt: null, incompleteChecklists: [], canStart: group.status === "pending", canTechnicianDeliver: true, technicianDeliverySupported: true })}
    onStart={async () => { window.maintenanceDock.starts++; setGroup(current => ({ ...current, status: "in_progress" })); }} onDeliver={async () => {}}
    creation={{ user: demoUser, onLoadOptions: async query => demoCreationOptions(query), onSubmit: async input => {
      window.maintenanceDock.inputs.push(input);
      return { kind: "work", groupId: group.id, workId: 901, companyBranchId: 1, schedule: { ...input.schedule, plannedMinutes: null, timezone: "America/Santiago" } };
    }, onCreated: async result => {
      if (window.maintenanceDock.failRead) throw new Error("READ_FAILED");
      const input = window.maintenanceDock.inputs.at(-1);
      if (input?.kind !== "work") throw new Error("INVALID_FIXTURE");
      setGroup(current => ({ ...current, works: [...current.works, { ...template.works[0], id: String(result.workId), title: input.work.title, status: "pending" }] }));
    } }} />;
}
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CreationScreen } from "../../../src/screens/creation/CreationScreen";
import { EquipmentTab } from "../../../src/screens/workDetail/WorkInformation";
import { Button } from "../../../src/ui/components";
import { DeviceSecurityContext, type DeviceSecurityUi } from "../../../src/security/DeviceSecurityContext";
import { DeviceLockController } from "../../../src/security/DeviceLockController";
import { ApiError } from "../../../src/infrastructure/errors";
import { makeDemoData, demoUser } from "../../../src/infrastructure/demoData";
import type { WorkEditDocument, WorkEditInput, CreationOptionsQuery } from "../../../src/domain/creation";
import { creationPlannedMinutes } from "../../../src/domain/creation";
import { demoCreationOptions } from "../../../src/infrastructure/creationDemo";
const tenant = { id: "tenant-1", name: "Empresa de prueba", portalOrigin: "https://tenant.example.com", environment: "production" as const };
const controller = new DeviceLockController({ platformSupported: false, initialForeground: true, readPreference: async () => null, writePreference: async () => {}, authenticate: async () => ({ success: true }), available: async () => true, cancel: async () => {} });

export function EquipmentPickerFixture() {
  const kind = new URLSearchParams(location.search).get("kind") === "maintenance" ? "maintenance" : "work";
  const cacheItems = [
    { id: 2, label: "BULLDOZER D10T · Agrícola", internalNumber: "8", identifier: "CRHD-31", equipmentType: "BULLDOZER" },
    { id: 9, label: "Excavadora de mantenimiento de brazo extendido", internalNumber: "EQ-009", identifier: "EX-009", equipmentType: "Excavadora" },
  ];
  const security: DeviceSecurityUi = { blocked: false, controller, state: controller.getSnapshot(), isUnlocked: () => true };
  return <SafeAreaProvider><DeviceSecurityContext.Provider value={security}>
    <CreationScreen kind={kind} user={demoUser} tenant={tenant} companyBranchId={1} initialDate="2026-09-22" data={null} mode="live" storageKey={`equipment-picker:${kind}`} onBack={() => {}}
      onLoadOptions={async query => ({ ...demoCreationOptions(query), equipment: { items: cacheItems.filter(item => query.internalNumber ? item.internalNumber.toLowerCase() === query.internalNumber.toLowerCase() : !query.search || item.label.toLowerCase().includes(query.search.toLowerCase())), page: query.page ?? 0, pageSize: 25, hasMore: false } })}
      onSubmit={async input => ({ kind, groupId: kind === "maintenance" ? "maintenance-71" : "direct-71", workId: 71, companyBranchId: 1, schedule: { ...input.schedule, plannedMinutes: creationPlannedMinutes(input.schedule), timezone: "America/Santiago" } })} />
  </DeviceSecurityContext.Provider></SafeAreaProvider>;
}

declare global { interface Window { workEditFixture: { saves: WorkEditInput[]; conflict: boolean; confirmed: number }; } }
export function WorkEditFixture() {
  const inherited = new URLSearchParams(location.search).get("inherited") === "true";
  const actor = demoUser;
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<WorkEditDocument>({ groupId: inherited ? "maintenance-5" : "direct-11", workId: 11, companyBranchId: 1, revision: "a".repeat(64), equipmentInherited: inherited, scheduleEditable: true,
    equipment: inherited ? { id: 7, label: "Equipo del mantenimiento 7" } : null, specialty: null,
    fields: { title: "Inspeccionar motor", summary: "Revisar conexiones", priority: "medium", specialtyId: null, rentalEquipmentId: inherited ? 7 : null, schedule: { date: "2026-09-22", startTime: "09:00", endTime: "10:00" } } });
  window.workEditFixture ??= { saves: [], conflict: false, confirmed: 0 };
  const security: DeviceSecurityUi = { blocked: false, isUnlocked: () => true, controller, state: controller.getSnapshot(), runTrustedNativePicker: async <Result,>(operation: () => Promise<Result>) => operation() };
  const equipment = document.equipment ? { label: document.equipment.label, equipmentId: document.equipment.id, equipmentContext: "rental" as const, identifier: "EQ", internalNumber: String(document.equipment.id), ownerLabel: "Propio" } : null;
  const template = makeDemoData().groups[0];
  const item = { ...template.works[0], id: "11", title: document.fields.title, workEquipment: inherited ? { ...equipment!, label: "Equipo hijo incorrecto" } : equipment };
  const parent = { ...template, works: [item], type: inherited ? "internal_maintenance" as const : "direct_assignment" as const, equipment: inherited ? equipment : null };
  async function options(query: CreationOptionsQuery) {
    return { ...demoCreationOptions(query), companyBranchId: 1, userId: actor.id, workerId: actor.workerId!, timezone: "America/Santiago", equipment: { items: [{ id: 9, label: "Equipo elegido 9", internalNumber: "9" }], page: 0, pageSize: 25 as const, hasMore: false } };
  }
  return <SafeAreaProvider><DeviceSecurityContext.Provider value={security}>
    {open ? <CreationScreen editing={document} user={actor} tenant={tenant} storageKey="work-edit-fixture" busy={false} online onBack={() => setOpen(false)} onLoadOptions={options}
      onSave={async input => { window.workEditFixture.saves.push(input); if (window.workEditFixture.conflict) throw new ApiError(409, "WORK_EDIT_CONFLICT", "WORK_EDIT_CONFLICT"); return { ...document, fields: input.fields, equipment: input.fields.rentalEquipmentId ? { id: input.fields.rentalEquipmentId, label: "Equipo elegido 9" } : null }; }}
      onSaved={async result => { window.workEditFixture.confirmed++; setDocument(result); setOpen(false); }} /> : <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}><View><Button title="Editar trabajo" icon="create-outline" onPress={() => setOpen(true)} /></View><EquipmentTab group={parent} work={item} onAssociate={() => setOpen(true)} /></ScrollView>}
  </DeviceSecurityContext.Provider></SafeAreaProvider>;
}
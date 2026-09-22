import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LocationSettingsPanel } from "../../../src/location/LocationSettingsPanel";
import type { LocationTrackingUi } from "../../../src/location/useLocationTracking";
import type { LocationJournalState } from "../../../src/location/LocationJournal";
import { defaultLocationSchedule, locationPointSchema } from "../../../src/domain/locationTracking";
import { LocationHistoryPanel } from "../../../src/location/LocationHistoryPanel";
import { CreationModal } from "../../../src/screens/creation/CreationModal";
import { CreationSuccess } from "../../../src/screens/creation/CreationSuccess";
import { BodyText } from "../../../src/ui/components";
import type { LocationHistoryResource } from "../../../src/domain/locationTracking";
import { EquipmentLocationPanel } from "../../../src/location/EquipmentLocationPanel";
import { DeviceSecurityContext, type DeviceSecurityUi } from "../../../src/security/DeviceSecurityContext";
import type { EquipmentLocation, EquipmentLocationUpdate } from "../../../src/domain/equipmentLocation";

declare global { interface Window { locationFixture: { allow: boolean; prompts: number; confirm?: () => void; saves: unknown[]; offline: boolean; defer: boolean; reads: Array<{ date: string; page: number; resource?: LocationHistoryResource }>; resolves: Array<() => void>; maps: string[]; equipmentSaves: EquipmentLocationUpdate[]; conflict: boolean; failSave: boolean }; } }
window.locationFixture = { allow: true, prompts: 0, saves: [], offline: false, defer: false, reads: [], resolves: [], maps: [], equipmentSaves: [], conflict: false, failSave: false };
const unlocked = { blocked: false, isUnlocked: () => true, runTrustedNativePicker: async <Result,>(operation: () => Promise<Result>) => operation() } as DeviceSecurityUi;
const equipmentAddress = { address: "Calle 4 Poniente", country: "Chile", region: "Metropolitana", county: "Paine", city: "", postalCode: "", lat: "-33.81", lon: "-70.74" };
let equipmentValue: EquipmentLocation = { equipmentId: 5, equipmentContext: "rental", label: "Camión de prueba", canEdit: true, address: equipmentAddress, currentAddress: equipmentAddress, currentSource: "REGISTERED", currentLabel: null };
const equipmentPort = {
  load: async () => ({ ...equipmentValue, canEdit: new URLSearchParams(location.search).get("readonly") !== "true" }),
  save: async (_target: string, input: EquipmentLocationUpdate) => {
    window.locationFixture.equipmentSaves.push(input);
    if (window.locationFixture.failSave) throw new Error("Respuesta de guardado no disponible.");
    if (window.locationFixture.conflict) throw new Error("La ubicación cambió. Actualiza antes de guardar.");
    equipmentValue = { ...equipmentValue, address: input.address, currentAddress: input.address }; return equipmentValue;
  },
};
const point = locationPointSchema.parse({ id: "00000000-0000-4000-8000-000000000001", companyBranchId: 1, capturedAt: "2026-09-21T09:00:00.000Z", locationAt: "2026-09-21T09:00:00.000Z",
  latitude: -33, longitude: -70, accuracy: 20, mocked: false, kind: "periodic", outcome: "located", schedule: defaultLocationSchedule("UTC"), consentedAt: "2026-09-01T08:00:00.000Z", consentVersion: 1 });
function Fixture() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("view") ?? "profile";
  const maintenance = params.get("kind") === "maintenance" || mode === "maintenance";
  const [success, setSuccess] = useState(true);
  const started = { ...point, kind: "action" as const, action: "WORK_PAUSED" as const, actionState: "CONFIRMED" as const, consentVersion: 2 as const, groupId: "maintenance-5", workId: 7 };
  const [state, setState] = useState<LocationJournalState>({ settings: { enabled: false, consentVersion: 1, consentedAt: null, schedule: defaultLocationSchedule("UTC") },
    generation: "fixture", active: true, activatedAt: Date.now(), validUntil: Date.now() + 86400000, points: mode === "profile" ? [] : [started,
      { ...started, id: "00000000-0000-4000-8000-000000000002", capturedAt: "2026-09-21T10:00:00.000Z", locationAt: null, latitude: null, longitude: null, accuracy: null, outcome: "unavailable" }], issue: null });
  const [error, setError] = useState<string | null>(null);
  const tracking: LocationTrackingUi = { state, available: true, busy: false, error, timezone: "UTC", capture: () => async () => {},
    save: async (schedule, enabled) => {
      if (enabled && !window.locationFixture.allow) { setError("Permisos denegados. El trabajo no se bloquea."); return; }
      window.locationFixture.saves.push({ schedule, enabled }); setError(null);
      setState(current => ({ ...current, settings: { enabled, schedule, consentVersion: 2, consentedAt: point.consentedAt } }));
    },
    history: async (date, page, resource) => {
      window.locationFixture.reads.push({ date, page, resource });
      if (window.locationFixture.defer) await new Promise<void>(resolve => window.locationFixture.resolves.push(resolve));
      if (window.locationFixture.offline) throw new Error("Conecta la app para consultar el historial sincronizado.");
      const recorded = { ...(resource ? started : point), id: page === 0 ? point.id : "00000000-0000-4000-8000-000000000003", latitude: page === 0 ? -33 : -34,
        capturedAt: `${date}T09:00:00.000Z`, locationAt: `${date}T09:00:00.000Z` };
      return { page, hasMore: mode !== "profile" && page === 0, items: [{ point: recorded, receivedAt: recorded.capturedAt, evidenceSource: "DEVICE_REPORTED" }] };
    },
  };
  if (mode === "equipment") return <SafeAreaProvider><DeviceSecurityContext.Provider value={unlocked}><ScrollView contentContainerStyle={{ padding: 16 }}>
    <EquipmentLocationPanel port={equipmentPort} target="work" identity="fixture-equipment" disabled={false} online />
  </ScrollView></DeviceSecurityContext.Provider></SafeAreaProvider>;
  if (mode === "success") return <SafeAreaProvider><View><BodyText>{maintenance ? "Ficha de mantenimiento" : "Ficha de trabajo"}</BodyText>
    {success ? <CreationSuccess kind={maintenance ? "maintenance" : "work"} confirmed={params.get("confirmed") !== "false"} name="Inspección del equipo de bombeo" demo={false} onContinue={() => setSuccess(false)} /> : null}
  </View></SafeAreaProvider>;
  if (mode !== "profile") return <SafeAreaProvider><CreationModal title="Mi historial de ubicación" onClose={() => {}}><LocationHistoryPanel tracking={tracking} initialDate="2026-09-21" resource={{ groupId: "maintenance-5", ...(maintenance ? {} : { workId: 7 }) }} /></CreationModal></SafeAreaProvider>;
  return <SafeAreaProvider><ScrollView contentContainerStyle={{ padding: 16, alignItems: "center" }}><View style={{ width: "100%", maxWidth: 720 }}><LocationSettingsPanel tracking={tracking} /></View></ScrollView></SafeAreaProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
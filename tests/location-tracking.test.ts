import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLocationSchedule, locationWorkingDay, locationScheduleSchema, locationPointSchema, shouldRecordPeriodic } from "../src/domain/locationTracking";
import { LocationJournal, locationTrackingStatus } from "../src/location/LocationJournal";
import { MemoryStore, uuid } from "../src/offline/tests/fakes";
import { loadSource } from "./helpers/tenant-challenge";
import * as locationDomain from "../src/domain/locationTracking";
import { equipmentAddressSchema, equipmentLocationUpdateSchema } from "../src/domain/equipmentLocation";
import { validMapPoint } from "../src/location/googleMapProtocol";
import { durableReactFixture, uiModule, action, elements, settle, deferred } from "./helpers/durable-ui";
import type { EquipmentAddress, EquipmentLocation, EquipmentLocationUpdate } from "../src/domain/equipmentLocation";
import type { GoogleMapProps } from "../src/location/googleMapProtocol";
import type { Session } from "../src/domain/models";
import { user } from "../server/tests/fixtures";
import { tenant } from "./helpers/tenant-challenge";
import { uiSnapshot } from "./helpers/durable-ui";
import * as tenantSession from "../src/domain/tenantSession";
import type { TechnicianRepository } from "../src/domain/TechnicianRepository";

for (const permissionGranted of [true, false]) test(`location hook prompts on entry and respects permission ${permissionGranted}`, async context => {
  const hooks = durableReactFixture(); context.after(() => hooks.unmount());
  const store = new MemoryStore(); let fixes = 0; let permits = 0; let sequence = 500; let uploads = 0; let failUpload = false;
  const port: Pick<TechnicianRepository, "uploadLocations" | "locationHistory"> = { uploadLocations: async (_branch: number, points: locationDomain.LocationPoint[]) => {
    uploads++; if (failUpload) throw new Error("UNAVAILABLE"); return { acceptedIds: points.map(point => point.id) };
  } };
  let buttons: { text: string; onPress?(): void }[] = []; let alerts = 0;
  const security = { blocked: false, isUnlocked: () => !security.blocked };
  const appState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
  const session: Session = { token: "fixture-token", tenant, mode: "live", branchId: 1, user: user() };
  const module = loadSource<typeof import("../src/location/useLocationTracking")>("location/useLocationTracking.ts", id => {
    if (id === "react") return hooks.react;
    if (id === "react-native") return { AppState: appState, Linking: { openSettings: async () => {} }, Alert: { alert: (_title: string, _message: string, actions: typeof buttons) => { alerts++; buttons = actions; } } };
    if (id === "expo-crypto") return { randomUUID: () => uuid(sequence++) };
    if (id === "../domain/tenantSession") return tenantSession;
    if (id === "../domain/locationTracking") return locationDomain;
    if (id === "../security/DeviceSecurityContext") return { useDeviceSecurity: () => security };
    if (id === "../security/useTrustedNativePicker") return { useTrustedNativePicker: () => (operation: () => Promise<boolean>) => operation() };
    if (id === "../offline/DurableStore") return { createDurableStore: async () => store };
    if (id === "./LocationJournal") return { LocationJournal };
    if (id === "./locationRuntime") return { locationTrackingAvailable: true, reconcileLocationTracking: async () => {}, scheduleLocationChecks: async () => {},
      locationPermissionReady: async () => permissionGranted, requestLocationPermissions: async () => { permits++; return permissionGranted; },
      currentLocationFix: async (minimum: number) => { fixes++; assert.ok(Math.abs(Date.now() - minimum) < 1000); return { timestamp: Date.now(), coords: { latitude: -33, longitude: -70, accuracy: 10 } }; } };
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  }, { setInterval: () => 1, clearInterval: () => {} });
  const offline = uiSnapshot();
  const render = () => { const result = hooks.render(() => module.useLocationTracking(session, "https://gateway.invalid", offline, Date.now(), port)); hooks.flush(); return result; };
  async function flush() { let result = render(); for (let index = 0; index < 12; index++) { await settle(); result = render(); } return result; }
  await flush(); assert.equal(alerts, 1); assert.equal(fixes, 0);
  buttons.find(button => button.text === "Continuar")?.onPress?.(); const active = await flush();
  if (!permissionGranted) {
    assert.equal(permits, 1); assert.equal(active.state?.settings.enabled, false); assert.match(active.error ?? "", /denegado/);
    await active.capture("WORK_PAUSED", { groupId: "maintenance-1", workId: "2", companyBranchId: 1, startDate: "2026-09-22", endDate: "2026-09-22" })("CONFIRMED");
    await flush(); assert.equal(fixes, 0); assert.equal(alerts, 1); return;
  }
  assert.equal(permits, 1); assert.equal(active.state?.settings.consentVersion, 2); assert.equal(fixes, 0);
  const scope = { groupId: "maintenance-1", workId: "2", companyBranchId: 1, startDate: "2026-09-22", endDate: "2026-09-22" };
  const finish = active.capture("CHECKLIST_SAVED", scope, "1009"); await settle();
  assert.equal(fixes, 1); assert.equal((await flush()).state?.points.length, 0);
  await finish("QUEUED", uuid(800)); await finish("QUEUED", uuid(800));
  const result = await flush(); assert.equal(result.state?.points.length, 1); assert.equal(result.state?.points[0].targetId, "1009");
  assert.equal(result.state?.points[0].actionState, "QUEUED"); assert.equal(alerts, 1);
  appState.currentState = "background"; await result.capture("WORK_PAUSED", scope)("CONFIRMED"); assert.equal(fixes, 1);
  appState.currentState = "active"; security.blocked = true;
  await result.capture("WORK_PAUSED", scope)("CONFIRMED"); assert.equal(fixes, 1);
  security.blocked = false; offline.online = true; let current = await flush();
  await current.capture("ACTIVITY_CREATED", scope)("CONFIRMED");
  current = await flush(); assert.equal(uploads, 1); assert.equal(current.state?.points.length, 0);
  failUpload = true;
  await current.capture("COMMENT_ADDED", scope)("CONFIRMED");
  current = await flush(); assert.equal(uploads, 2); assert.equal(current.state?.points.length, 1);
  assert.match(current.error ?? "", /No se pudo confirmar/);
  failUpload = false; await current.synchronize?.(); current = await flush();
  assert.equal(current.state?.points.length, 0); assert.equal(current.error, null);
});

test("map configuration shows public signing data and distinguishes unverified Cloud settings", () => {
  const hooks = durableReactFixture();
  const module = uiModule<typeof import("../src/location/GoogleMapConfiguration")>("location/GoogleMapConfiguration.tsx", hooks, { "./googlePlaces": { googlePlaces: { diagnose: async () => ({ status: 403, accepted: false, reasons: ["SERVICE_DISABLED"] }) } } });
  const tree = hooks.render(() => module.GoogleMapConfiguration({ loaded: false, configuration: { packageName: "com.example.field", certificateSha1: [Array(20).fill("AB").join(":")], keyConfigured: true, playServicesStatus: 0 } }));
  const text = elements<{ children?: unknown }>(tree, "Text").map(element => JSON.stringify(element.props.children)).join(" ");
  assert.match(text, /Maps SDK for Android/); assert.match(text, /Places API/); assert.match(text, /SHA-1/); assert.match(text, /Pendiente de verificar/);
  assert.equal(text.includes("AIza"), false);
});

test("action locations accept off-hours events, require new consent and deduplicate queued actions", async () => {
  const now = Date.parse("2026-09-22T23:00:00Z"); const journal = new LocationJournal(new MemoryStore(), { namespace: "location:actions", userId: 1, workerId: 7, companyBranchId: 1, timezone: "UTC" }, () => now);
  await journal.activate("actions");
  const event = { action: "WORK_PAUSED" as const, groupId: "maintenance-1", workId: 2, capturedAt: now, actionState: "QUEUED" as const, operationId: uuid(10) };
  assert.equal(await journal.recordAction("actions", uuid(1), null, event), false);
  await journal.configure({ enabled: true, consentVersion: 2, consentedAt: new Date(now).toISOString(), schedule: defaultLocationSchedule("UTC") });
  assert.equal(await journal.recordAction("actions", uuid(1), null, event), true);
  assert.equal(await journal.recordAction("actions", uuid(2), null, event), false);
  const point = (await journal.read()).points[0]; assert.equal(point.kind, "action"); assert.equal(point.action, "WORK_PAUSED"); assert.equal(point.outcome, "unavailable");
  assert.equal(locationPointSchema.safeParse({ ...point, consentVersion: 1 }).success, false);
  assert.equal(locationPointSchema.safeParse({ ...point, operationId: undefined }).success, false);
  await journal.configure({ ...(await journal.read()).settings, enabled: false });
  assert.equal(await journal.recordAction("actions", uuid(3), null, { ...event, operationId: uuid(11) }), false);
});

test("native Places search never emits an address before selecting and resolving an exact result", async context => {
  const hooks = durableReactFixture(); context.after(() => hooks.unmount());
  const address: EquipmentAddress = { address: "Calle 4", country: "Chile", region: "", county: "Paine", city: "", postalCode: "", lat: "-33.8", lon: "-70.7" };
  const searches: string[] = []; const ids: string[] = []; const received: EquipmentAddress[] = [];
  const module = uiModule<typeof import("../src/location/GoogleMap")>("location/GoogleMap.tsx", hooks, {
    "./GoogleMapConfiguration": { GoogleMapConfiguration: "GoogleMapConfiguration" },
    "react-native-maps": { __esModule: true, default: "MapView", Marker: "Marker", Circle: "Circle", PROVIDER_GOOGLE: "google" },
    "./googlePlaces": { googlePlaces: { available: () => true, endSession: () => {}, search: async (query: string) => { searches.push(query); return [{ id: "place-1", label: "Calle 4, Paine" }]; }, details: async (id: string) => { ids.push(id); return address; } } },
  });
  const props: GoogleMapProps = { point: null, editable: true, onAddress: value => received.push(value) };
  const render = () => { const tree = hooks.render(() => module.GoogleMap(props)); hooks.flush(); return tree; };
  assert.equal(action(render(), "Buscar dirección").disabled, true);
  elements<{ onChangeText(value: string): void }>(render(), "Field")[0].props.onChangeText("Paine");
  action(render(), "Buscar dirección").onPress(); await settle();
  assert.deepEqual(searches, ["Paine"]); assert.equal(received.length, 0);
  action(render(), "Calle 4, Paine").onPress(); await settle();
  assert.deepEqual(ids, ["place-1"]); assert.deepEqual(received, [address]);
  assert.equal(elements(render(), "Marker").length, 1);
});

test("native Google map keeps selected coordinates and ignores a late address after locking", async context => {
  const hooks = durableReactFixture(); context.after(() => hooks.unmount());
  const gate = deferred<EquipmentAddress>(); const points: number[] = []; const addresses: EquipmentAddress[] = [];
  const module = uiModule<typeof import("../src/location/GoogleMap")>("location/GoogleMap.tsx", hooks, {
    "./GoogleMapConfiguration": { GoogleMapConfiguration: "GoogleMapConfiguration" },
    "react-native-maps": { __esModule: true, default: "MapView", Marker: "Marker", Circle: "Circle", PROVIDER_GOOGLE: "google" },
    "./googlePlaces": { googlePlaces: { available: () => true, endSession: () => {}, reverse: () => gate.promise } },
  });
  const props: GoogleMapProps = { point: { lat: 0, lng: 0 }, editable: true, disabled: false, onPoint: point => points.push(point.lat), onAddress: address => addresses.push(address) };
  const render = () => {
    const tree = hooks.render(() => module.GoogleMap(props)); hooks.flush(); return tree;
  };
  assert.equal(elements(render(), "WebView").length, 0);
  const map = elements<{ provider: string; onPress(event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }): void }>(render(), "MapView")[0];
  assert.equal(map.props.provider, "google"); assert.equal(elements(render(), "Marker").length, 1);
  map.props.onPress({ nativeEvent: { coordinate: { latitude: -33, longitude: -70 } } }); await settle();
  assert.deepEqual(points, [-33]);
  props.disabled = true; render();
  gate.resolve({ address: "Late", country: "", region: "", county: "", city: "", postalCode: "", lat: "-33", lon: "-70" }); await settle();
  assert.equal(addresses.length, 0);
  map.props.onPress({ nativeEvent: { coordinate: { latitude: -34, longitude: -70 } } });
  assert.deepEqual(points, [-33]);
});

for (const source of ["map", "gps-without-map"] as const) test(`equipment editor keeps a ${source} coordinate-only draft offline and does not duplicate save taps`, async context => {
  const hooks = durableReactFixture(); context.after(() => hooks.unmount());
  const address: EquipmentAddress = { address: "Paine", country: "Chile", region: "", county: "", city: "", postalCode: "", lat: "-33", lon: "-70" };
  const stored: EquipmentLocation = { equipmentId: 5, equipmentContext: "rental", label: "Equipo", address, currentAddress: address, canEdit: true, currentSource: "REGISTERED", currentLabel: null };
  const writes: EquipmentLocationUpdate[] = []; const gate = deferred<EquipmentLocation>();
  const module = uiModule<typeof import("../src/location/EquipmentLocationPanel")>("location/EquipmentLocationPanel.tsx", hooks, {
    "../security/DeviceSecurityContext": { useDeviceSecurity: () => ({ blocked: false, isUnlocked: () => true }) },
    "../screens/creation/CreationModal": { CreationModal: "CreationModal" }, "./GoogleMap": { GoogleMap: "GoogleMap" }, "./equipmentPosition": { requestEquipmentPosition: async () => ({ lat: 0, lng: 0 }) },
  });
  const props = { port: { load: async () => stored, save: async (_target: string, input: EquipmentLocationUpdate) => { writes.push(input); return gate.promise; } }, target: "work" as const, identity: "owner-5", portalOrigin: "https://tenant.invalid", disabled: false, online: true };
  const render = () => { const tree = hooks.render(() => module.EquipmentLocationPanel(props)); hooks.flush(); return tree; };
  render(); await settle(); action(render(), "Editar ubicación actual").onPress();
  if (source === "map") {
    const map = elements<{ onAddress(address: EquipmentAddress): void }>(render(), "GoogleMap")[0];
    map.props.onAddress({ ...address, lat: "0", lon: "0" });
  } else {
    action(render(), "Usar mi ubicación").onPress(); await settle();
  }
  assert.equal(action(render(), "Guardar ubicación").disabled, false);
  props.online = false; render(); assert.equal(action(render(), "Guardar ubicación").disabled, true);
  assert.equal(elements<{ value: string }>(render(), "Field")[0].props.value, "Paine");
  props.online = true; const save = action(render(), "Guardar ubicación"); save.onPress(); save.onPress(); await settle();
  assert.equal(writes.length, 1); assert.equal(writes[0].address.lat, "0"); assert.equal(writes[0].expected?.lat, "-33");
  gate.resolve({ ...stored, address: writes[0].address, currentAddress: writes[0].address }); await settle();
  assert.equal(elements(render(), "CreationModal").length, 0);
});

test("equipment read from an obsolete identity never appears in the next equipment panel", async context => {
  const hooks = durableReactFixture(); context.after(() => hooks.unmount());
  const gate = deferred<EquipmentLocation>();
  const module = uiModule<typeof import("../src/location/EquipmentLocationPanel")>("location/EquipmentLocationPanel.tsx", hooks, {
    "../security/DeviceSecurityContext": { useDeviceSecurity: () => ({ blocked: false, isUnlocked: () => true }) },
    "../screens/creation/CreationModal": { CreationModal: "CreationModal" }, "./GoogleMap": { GoogleMap: "GoogleMap" }, "./equipmentPosition": {},
  });
  const props = { port: { load: () => gate.promise, save: async () => { throw new Error("FORBIDDEN"); } }, target: "work" as const, identity: "old", portalOrigin: "https://tenant.invalid", disabled: false, online: true };
  const render = () => { const tree = hooks.render(() => module.EquipmentLocationPanel(props)); hooks.flush(); return tree; };
  render(); props.identity = "next"; props.online = false; render();
  gate.resolve({ equipmentId: 5, equipmentContext: "rental", label: "Old", address: null, currentAddress: null, canEdit: true, currentSource: "REGISTERED", currentLabel: null }); await settle();
  assert.equal(elements<{ title: string }>(render(), "Button").some(element => element.props.title === "Editar ubicación actual"), false);
});

test("native Google map rejects invalid coordinates and preserves zero coordinates", () => {
  assert.equal(validMapPoint({ lat: 0, lng: 0 }), true);
  for (const point of [null, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: NaN, lng: 0 }, { lat: 0, lng: 0, accuracy: -1 }]) assert.equal(validMapPoint(point), false);
});

test("equipment location preserves the web address contract and rejects partial coordinates or identity injection", () => {
  const address = { address: "Calle 4 Poniente", country: "Chile", region: "Región Metropolitana", county: "Paine", city: "", postalCode: "", lat: "-33.81", lon: "-70.74" };
  assert.deepEqual(equipmentLocationUpdateSchema.parse({ expected: null, address }).address, address);
  assert.equal(equipmentLocationUpdateSchema.safeParse({ expected: address, address: { ...address, lat: "0", lon: "0" } }).success, true);
  assert.equal(equipmentAddressSchema.safeParse({ ...address, lat: null, lon: null }).success, true);
  for (const patch of [{ lat: "" }, { lat: "NaN" }, { lat: "91" }, { lon: "181" }, { lat: null }, { id: 8 }, { userId: 4 }]) {
    assert.equal(equipmentAddressSchema.safeParse({ ...address, ...patch }).success, false);
  }
  assert.equal(equipmentLocationUpdateSchema.safeParse({ expected: null, address, equipmentId: 9 }).success, false);
  assert.equal(equipmentLocationUpdateSchema.safeParse({ expected: null, address: { ...address, address: " " } }).success, false);
});

test("default working hours are 08 to 18 in branch timezone and never depend on device zone", () => {
  const schedule = defaultLocationSchedule("America/Santiago");
  assert.equal(locationWorkingDay(schedule, Date.parse("2026-09-21T10:59:59Z")), null);
  assert.equal(locationWorkingDay(schedule, Date.parse("2026-09-21T11:00:00Z")), "2026-09-21");
  assert.equal(locationWorkingDay(schedule, Date.parse("2026-09-21T20:59:59Z")), "2026-09-21");
  assert.equal(locationWorkingDay(schedule, Date.parse("2026-09-21T21:00:00Z")), null);
  assert.equal(locationWorkingDay({ ...schedule, weekdays: [2] }, Date.parse("2026-09-21T12:00:00Z")), null);
  assert.equal(locationWorkingDay(schedule, Date.parse("2026-06-22T12:00:00Z")), "2026-06-22");
  for (const patch of [{ endTime: "08:00" }, { startTime: "19:00" }, { timezone: "invalid" }, { weekdays: [] }, { weekdays: [1, 1] }]) assert.equal(locationScheduleSchema.safeParse({ ...schedule, ...patch }).success, false);
});

test("periodic sampling is bounded and rejects stale, inaccurate and out-of-hours fixes", () => {
  const schedule = defaultLocationSchedule("UTC");
  const now = Date.parse("2026-09-21T09:00:00Z");
  const fix = { timestamp: now, coords: { latitude: -33.45, longitude: -70.66, accuracy: 25 } };
  assert.equal(shouldRecordPeriodic(schedule, fix, now), true);
  assert.equal(shouldRecordPeriodic(schedule, fix, now, new Date(now - 299999).toISOString()), false);
  assert.equal(shouldRecordPeriodic(schedule, fix, now, new Date(now - 300000).toISOString()), true);
  assert.equal(shouldRecordPeriodic(schedule, { ...fix, timestamp: now - 120001 }, now), false);
  assert.equal(shouldRecordPeriodic(schedule, { ...fix, coords: { ...fix.coords, accuracy: 101 } }, now), false);
  assert.equal(shouldRecordPeriodic(schedule, fix, Date.parse("2026-09-21T20:00:00Z")), false);
});

test("history requires consent, valid coordinates and an explicit start event target", () => {
  const point = { id: "01990000-0000-7000-8000-000000000001", companyBranchId: 1, capturedAt: "2026-09-21T09:00:00.000Z", locationAt: null,
    latitude: null, longitude: null, accuracy: null, mocked: false, kind: "work_started", outcome: "unavailable", groupId: "maintenance-5", workId: 7,
    consentedAt: "2026-09-21T08:00:00.000Z", consentVersion: 1, schedule: defaultLocationSchedule("UTC") };
  assert.equal(locationPointSchema.safeParse(point).success, true);
  for (const patch of [{ capturedAt: "2026-09-21T18:00:00.000Z" }, { latitude: 0 }, { consentedAt: "2026-09-22T09:00:00.000Z" }, { workId: undefined }]) assert.equal(locationPointSchema.safeParse({ ...point, ...patch }).success, false);
});

test("journal preserves scope and pending points across restart, stop and partial acknowledgement", async () => {
  const store = new MemoryStore(); let now = Date.parse("2026-09-21T09:00:00Z");
  const owner = { namespace: "location:tenant-user-1", userId: 1, workerId: 7, companyBranchId: 1, timezone: "UTC" };
  const journal = new LocationJournal(store, owner, () => now);
  await journal.activate("session-1");
  const fix = () => ({ timestamp: now, coords: { latitude: -33, longitude: -70, accuracy: 20 } });
  assert.equal(await journal.record("session-1", uuid(1), fix()), false);
  await journal.configure({ enabled: true, consentVersion: 1, consentedAt: new Date(now).toISOString(), schedule: defaultLocationSchedule("UTC") });
  assert.equal(await journal.record("session-1", uuid(1), fix()), true);
  now += 1000; assert.equal(await journal.record("session-1", uuid(2), fix()), false);
  assert.equal(await journal.record("session-1", uuid(2), null, { kind: "work_started", groupId: "maintenance-3", workId: 4, operationId: uuid(10), capturedAt: now }), true);
  assert.equal(await journal.record("session-1", uuid(3), fix(), { kind: "work_started", groupId: "maintenance-3", workId: 4, operationId: uuid(10), capturedAt: now }), false);
  const recovered = new LocationJournal(store, owner, () => now);
  assert.equal((await recovered.read()).points.length, 2);
  await assert.rejects(recovered.acknowledge((await recovered.read()).points, [uuid(99)]), /INVALID_ACK/);
  await recovered.acknowledge((await recovered.read()).points, [uuid(1)]);
  assert.equal((await recovered.read()).points.length, 1);
  await recovered.deactivate();
  now += 300000; assert.equal(await journal.record("session-1", uuid(4), fix()), false);
  await journal.activate("session-2"); assert.equal(await journal.record("session-1", uuid(5), fix()), false);
  assert.equal((await journal.read()).points.length, 1);
  store.failWrites = true; await assert.rejects(journal.record("session-2", uuid(6), fix()), /DISK_FULL/);
});

test("late fixes cannot escape consent, shift, verification expiry or a different active worker", async () => {
  const store = new MemoryStore(); let now = Date.parse("2026-09-21T17:59:30Z");
  const owner = { namespace: "location:tenant-user-1-worker-7", userId: 1, workerId: 7, companyBranchId: 1, timezone: "UTC" };
  const journal = new LocationJournal(store, owner, () => now);
  await journal.activate("old", now + 60000);
  await journal.configure({ enabled: true, consentVersion: 1, consentedAt: new Date(now).toISOString(), schedule: defaultLocationSchedule("UTC") });
  const fix = { timestamp: now + 30001, coords: { latitude: -33, longitude: -70, accuracy: 20 } };
  assert.equal(await journal.record("old", uuid(1), fix), false);
  const capturedAt = now; now += 31000;
  assert.equal(await journal.record("old", uuid(2), fix, { kind: "order_started", groupId: "maintenance-3", capturedAt }), true);
  assert.equal((await journal.read()).points[0].outcome, "unavailable");
  const other = new LocationJournal(store, { ...owner, namespace: "location:tenant-user-2-worker-8", userId: 2, workerId: 8 }, () => now);
  await other.activate("other");
  assert.equal((await journal.read()).active, false);
  assert.equal((await other.read()).points.length, 0);
  assert.equal(await journal.record("old", uuid(3), null, { kind: "order_started", groupId: "maintenance-3", capturedAt }), false);
  await journal.activate("new", now - 1);
  assert.equal(await journal.record("new", uuid(4), null, { kind: "order_started", groupId: "maintenance-3", capturedAt: now }), false);
});

test("native task controller requests permission only explicitly and stops on denial or outside working hours", async () => {
  let now = Date.parse("2026-09-21T09:00:00Z");
  class PhoneDate extends Date { static now() { return now; } }
  const store = new MemoryStore();
  const journal = new LocationJournal(store, { namespace: "location:native", userId: 1, workerId: 7, companyBranchId: 1, timezone: "UTC" }, () => now);
  await journal.activate("native", now + 86400000);
  await journal.configure({ enabled: true, consentVersion: 1, consentedAt: new Date(now).toISOString(), schedule: defaultLocationSchedule("UTC") });
  let foregroundGranted = true; let backgroundGranted = true; let started = true; let prompts = 0;
  let fixes = 0; let pointNumber = 50; const appState = { currentState: "active" };
  let fixAccuracy = 10; let disableDuringFix = false;
  const options: Array<{ accuracy: number; timeInterval: number; foregroundService: { notificationTitle: string } }> = [];
  const tasks = new Map<string, (input: { data: { locations: unknown[] }; error?: object }) => Promise<void>>();
  const runtime = loadSource<typeof import("../src/location/locationRuntime")>("location/locationRuntime.ts", name => {
    if (name === "expo-location") return { Accuracy: { High: 4 }, getForegroundPermissionsAsync: async () => ({ granted: foregroundGranted, canAskAgain: true }), getBackgroundPermissionsAsync: async () => ({ granted: backgroundGranted }),
      requestForegroundPermissionsAsync: async () => { prompts++; return { granted: foregroundGranted }; }, requestBackgroundPermissionsAsync: async () => { prompts++; return { granted: backgroundGranted }; },
      hasServicesEnabledAsync: async () => true, hasStartedLocationUpdatesAsync: async () => started, stopLocationUpdatesAsync: async () => { started = false; },
      getLastKnownPositionAsync: async () => ({ timestamp: now - 600000, coords: { latitude: -33, longitude: -70, accuracy: 10 } }),
      getCurrentPositionAsync: async () => {
        fixes++;
        if (disableDuringFix) await journal.configure({ ...(await journal.read()).settings, enabled: false });
        return { timestamp: now, coords: { latitude: -33, longitude: -70, accuracy: fixAccuracy } };
      },
      startLocationUpdatesAsync: async (_task: string, input: typeof options[number]) => { options.push(input); started = true; } };
    if (name === "expo-task-manager") return { defineTask: (name: string, callback: typeof tasks extends Map<string, infer Callback> ? Callback : never) => tasks.set(name, callback), isTaskRegisteredAsync: async () => false };
    if (name === "expo-background-task") return { registerTaskAsync: async () => {}, BackgroundTaskResult: { Success: 1, Failed: 2 } };
    if (name === "expo-crypto") return { randomUUID: () => uuid(pointNumber++) };
    if (name === "react-native") return { AppState: appState };
    if (name === "../offline/DurableStore") return { createDurableStore: async () => store };
    if (name === "../domain/locationTracking") return locationDomain;
    if (name === "./LocationJournal") return { LocationJournal: { active: async () => journal } };
    throw new Error(`UNEXPECTED_LOCATION_IMPORT:${name}`);
  }, { Date: PhoneDate, setTimeout, clearTimeout });
  assert.equal(tasks.size, 2);
  await runtime.reconcileLocationTracking(); assert.equal(started, false); assert.equal(prompts, 0);
  assert.equal(fixes, 0); assert.equal((await journal.read()).points.length, 0);
  await runtime.reconcileLocationTracking(); assert.equal(fixes, 0);
  now += 300000; await runtime.scheduleLocationChecks(true); assert.equal(fixes, 0);
  appState.currentState = "background"; now += 300000; await runtime.reconcileLocationTracking(); assert.equal(fixes, 0);
  appState.currentState = "active";
  assert.equal(options.length, 0);
  backgroundGranted = false;
  await tasks.get("qualitzer-labor-location-v1")!({ data: { locations: [{ timestamp: now, coords: { latitude: -33, longitude: -70, accuracy: 10 } }] } });
  assert.equal((await journal.read()).points.length, 0); assert.equal(started, false); assert.equal(fixes, 0);
  assert.equal(await runtime.requestLocationPermissions(), true); assert.equal(prompts, 0);
  foregroundGranted = false; assert.equal(await runtime.requestLocationPermissions(), false); assert.equal(prompts, 1);
  foregroundGranted = true; await runtime.currentLocationFix(); assert.equal(fixes, 1);
  appState.currentState = "background"; assert.equal(await runtime.currentLocationFix(), null); assert.equal(fixes, 1);
});

test("history status distinguishes consent upgrade, disabled capture, expired session and GPS failure", async () => {
  const now = Date.parse("2026-09-21T09:00:00Z");
  const journal = new LocationJournal(new MemoryStore(), { namespace: "location:status", userId: 1, workerId: 7, companyBranchId: 1, timezone: "UTC" }, () => now);
  const state = await journal.read();
  assert.match(locationTrackingStatus(state, now), /desactivado/);
  state.settings.enabled = true; assert.match(locationTrackingStatus(state, now), /verifica/);
  state.active = true; state.validUntil = now + 86400000;
  assert.match(locationTrackingStatus(state, now), /Autoriza/);
  state.settings.consentVersion = 2;
  assert.match(locationTrackingStatus(state, now), /Sin seguimiento continuo/);
  state.issue = "GPS no disponible"; assert.equal(locationTrackingStatus(state, now), state.issue);
  assert.equal(locationTrackingStatus(state, Date.parse("2026-09-21T20:00:00Z")), state.issue);
  assert.match(locationTrackingStatus(state, state.validUntil), /verifica/);
});
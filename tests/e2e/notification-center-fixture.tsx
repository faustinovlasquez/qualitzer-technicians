import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Session } from "../../src/domain/models";
import type { NotificationInboxItem, NotificationPreferences, NotificationStatus } from "../../src/domain/notifications";
import type { NotificationAdapter, NotificationApi } from "../../src/notifications/contracts";
import { MobileNotificationClient } from "../../src/notifications/MobileNotificationClient";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../src/notifications/notificationSafety";
import { NotificationCenterScreen } from "../../src/screens/notifications/NotificationCenterScreen";
import { NotificationSettingsScreen } from "../../src/screens/notifications/NotificationSettingsScreen";
import { NotificationStatusCard } from "../../src/screens/notifications/NotificationStatusCard";
import { notificationCounts, notificationKinds } from "../../src/screens/notifications/notificationPresentation";
import { ProfileScreen } from "../../src/screens/ProfileScreen";
import { DeviceLockController } from "../../src/security/DeviceLockController";
import { DeviceSecurityContext, type DeviceSecurityUi } from "../../src/security/DeviceSecurityContext";

type Scenario = "populated" | "empty" | "loading" | "legacy" | "legacy-read-first" | "token-pending" | "error" | "web" | "blocked" | "missing";
type Screen = "center" | "settings" | "status" | "profile";
const installationId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const session: Session = {
  token: "fixture-only-no-authentication", mode: "live", branchId: 1,
  tenant: { id: "fixture", name: "Empresa ficticia", portalOrigin: "https://fixture.example.com", environment: "development" },
  user: { id: 1, workerId: 1, name: "Persona", lastnames: "Ficticia", email: "fixture@example.com", role: { name: "Técnico" },
    accessBranchs: [{ id: 1, name: "Sucursal ficticia", main: true }], system: { name: "Fixture", timezone: "UTC" } },
};

function items(length = 85): NotificationInboxItem[] {
  const kinds = Object.keys(notificationKinds) as NotificationInboxItem["kind"][];
  const states: NotificationInboxItem["state"][] = ["pending", "accepted", "receipt_ok", "dead", "expired", "cancelled", "sending", "receiving", "receipt_unknown"];
  return Array.from({ length }, (_, index) => {
    const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const kind = kinds[index % kinds.length];
    const test = kind === "MOBILE_PUSH_TEST";
    return { id, kind, state: states[index % states.length], lastFailure: index === 3 ? "EXPO_DEVICE_NOT_REGISTERED" : null,
      readAt: index < 60 ? null : "2026-09-10T08:00:00Z", createdAt: "2026-09-10T07:00:00Z",
      data: { eventId: id, kind, tenantOrigin: session.tenant.portalOrigin, companyBranchId: 1, recipient: { userId: 1, workerId: 1 },
        groupType: test ? null : "work", groupId: test ? null : index + 100, workId: test ? null : index + 100, date: test ? null : "2026-09-12" } };
  });
}

class MemoryNotificationApi implements NotificationApi {
  rows = items();
  preferences: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  inboxCalls: { page: number; unreadOnly: boolean }[] = [];
  reads: string[] = [];
  deletes: string[] = [];
  registrations: NotificationPreferences[] = [];
  badges: number[] = [];
  opened: string[] = [];
  testCalls = 0;
  unregistrations = 0;
  back = 0;
  failDelete = false;
  failRead = false;
  failSave = false;
  holdDelete = false;
  locked = false;
  releaseStatus: (() => void) | null = null;
  releaseDelete: (() => void) | null = null;
  releaseToken: (() => void) | null = null;
  tokenCalls = 0;
  tokenPending = false;
  constructor(readonly scenario: Scenario) {
    if (scenario === "empty") this.rows = [];
    if (scenario === "legacy" || scenario === "legacy-read-first") {
      this.rows = items(scenario === "legacy" ? 87 : 40).map((row, index) => ({ ...row, readAt: index < 25 ? "2026-09-10T08:00:00Z" : null }));
    }
  }
  async notificationStatus(): Promise<NotificationStatus> {
    if (this.scenario === "loading") await new Promise<void>(resolve => { this.releaseStatus = resolve; });
    return { enabled: true, reasons: [], projectId, reconciliationSeconds: 120, deliveryGuaranteed: false,
      device: { installationId, active: this.unregistrations === 0, disabledReason: null, preferences: { ...this.preferences } } };
  }
  notificationRegister: NotificationApi["notificationRegister"] = async (_session, input) => {
    this.registrations.push({ ...input.preferences });
    if (this.failSave) throw new Error("MOBILE_PUSH_FIXTURE_SAVE_FAILED");
    this.preferences = { ...input.preferences };
    return { installationId, active: true, preferences: { ...this.preferences }, baselineCapturedAt: null };
  };
  notificationUnregister: NotificationApi["notificationUnregister"] = async () => { this.unregistrations += 1; };
  notificationInbox: NotificationApi["notificationInbox"] = async (_session, page, unreadOnly = false) => {
    this.inboxCalls.push({ page, unreadOnly });
    if (this.scenario === "error") throw new Error("MOBILE_PUSH_FIXTURE_INBOX_FAILED");
    const legacy = this.scenario === "legacy" || this.scenario === "legacy-read-first";
    const filtered = unreadOnly && !legacy ? this.rows.filter(row => !row.readAt) : this.rows;
    return { items: filtered.slice((page - 1) * 25, page * 25).map(row => ({ ...row })), page, pageSize: 25,
      ...(legacy ? {} : { total: filtered.length, unreadCount: this.rows.filter(row => !row.readAt).length, canDelete: true }) };
  };
  notificationRead: NotificationApi["notificationRead"] = async (_session, id) => {
    this.reads.push(id);
    if (this.failRead) throw new Error("MOBILE_PUSH_FIXTURE_READ_FAILED");
    this.rows = this.rows.map(row => row.id === id ? { ...row, readAt: "2026-09-12T08:00:00Z" } : row);
    return { id, read: true };
  };
  notificationDelete: NotificationApi["notificationDelete"] = async (_session, id) => {
    this.deletes.push(id);
    if (this.holdDelete) await new Promise<void>(resolve => { this.releaseDelete = resolve; });
    if (this.failDelete) throw new Error("MOBILE_PUSH_FIXTURE_DELETE_FAILED");
    this.rows = this.rows.filter(row => row.id !== id);
    return { id, deleted: true };
  };
  notificationTest: NotificationApi["notificationTest"] = async () => {
    this.testCalls += 1;
    throw new Error("FIXTURE_FORBIDS_TEST_NOTIFICATION");
  };
}

function adapter(api: MemoryNotificationApi): NotificationAdapter {
  return { platform: api.scenario === "web" ? "unsupported" : "android", projectId, unsupportedReason: null,
    getPermission: async () => api.scenario === "blocked" ? "blocked" : "granted", requestPermission: async () => { throw new Error("FIXTURE_FORBIDS_PERMISSION_PROMPT"); },
    prepareChannel: async () => {}, getExpoToken: async () => {
      api.tokenCalls += 1;
      if (api.scenario === "token-pending") {
        api.tokenPending = true;
        await new Promise<void>(resolve => { api.releaseToken = resolve; });
        api.tokenPending = false;
      }
      return "ExpoPushToken[fixture_not_a_real_token]";
    }, getInstallationId: async () => installationId,
    readConsent: async () => true, writeConsent: async () => {}, subscribe: () => () => {}, lastResponse: async () => null,
    clearResponse: async () => {}, presented: async () => [], dismiss: async () => {}, setBadge: async count => { api.badges.push(count); return true; },
    openSettings: async () => { throw new Error("FIXTURE_FORBIDS_SYSTEM_SETTINGS"); } };
}

const lockController = new DeviceLockController({ platformSupported: false, initialForeground: true, readPreference: async () => "declined",
  writePreference: async () => {}, available: async () => false, authenticate: async () => { throw new Error("FIXTURE_FORBIDS_AUTH"); }, cancel: async () => {} });
const container = document.getElementById("root");
if (!container) throw new Error("FIXTURE_ROOT_REQUIRED");
const root = createRoot(container);
let active: { api: MemoryNotificationApi; client: MobileNotificationClient; stop: () => void } | null = null;
let revision = 0;
let setFixtureLocked: (value: boolean) => void = () => {};

function Fixture({ api, client, initialScreen }: { api: MemoryNotificationApi; client: MobileNotificationClient; initialScreen: Screen }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [screen, setScreen] = useState(initialScreen);
  const [locked, setLocked] = useState(false);
  useEffect(() => { setFixtureLocked = setLocked; return () => { setFixtureLocked = () => {}; }; }, []);
  const security: DeviceSecurityUi = { controller: lockController, state: { ...lockController.getSnapshot(), ready: true, locked }, blocked: locked, isUnlocked: () => !api.locked };
  const notifications = { client: api.scenario === "missing" ? null : client, state: api.scenario === "missing" ? null : state,
    storageKey: `fixture-${revision}`, revokeForSession: async () => {} };
  const back = () => { api.back += 1; setScreen("profile"); };
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: innerWidth, height: innerHeight }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
    <DeviceSecurityContext.Provider value={security}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <View testID="private-fixture" style={[{ flex: 1, minHeight: 0 }, locked && { display: "none" }]} aria-hidden={locked} pointerEvents={locked ? "none" : "auto"}>
          {screen === "center" ? <NotificationCenterScreen notifications={notifications} onBack={back} />
            : screen === "settings" ? <NotificationSettingsScreen notifications={notifications} onBack={back} />
              : screen === "status" ? <ScrollView contentContainerStyle={{ padding: 16 }}><NotificationStatusCard notifications={notifications} /></ScrollView>
                : <ProfileScreen session={session} gatewayUrl="Fixture aislada sin API HTTP" busy={false} error={null} health={null}
                  companyBranding={{ available: false, busy: false, canPin: false, logoMessage: "Sin dispositivo real", message: "Prueba aislada", onPin: () => {} }}
                  onNotificationSettings={() => setScreen("settings")} onBranch={() => {}} onLogout={() => {}} onCheck={() => {}} />}
        </View>
        {locked ? <Text accessibilityRole="header">Fixture bloqueada</Text> : null}
      </View>
    </DeviceSecurityContext.Provider>
  </SafeAreaProvider>;
}

interface FixtureApi {
  render(scenario: Scenario, screen?: Screen): void;
  lock(value: boolean): void;
  configure(value: { failDelete?: boolean; failRead?: boolean; failSave?: boolean; holdDelete?: boolean }): void;
  release(kind: "status" | "delete" | "token"): void;
  deleteNotification(id: string): Promise<boolean>;
  metrics(): { state: ReturnType<MobileNotificationClient["getSnapshot"]>; inboxCalls: MemoryNotificationApi["inboxCalls"]; reads: string[]; deletes: string[];
    registrations: NotificationPreferences[]; badges: number[]; opened: string[]; rows: number; back: number; testCalls: number; unregistrations: number; countsLabel: string;
    tokenCalls: number; tokenPending: boolean };
}
declare global { interface Window { notificationCenterFixture: FixtureApi } }
window.notificationCenterFixture = {
  render(scenario, initialScreen = "center") {
    active?.stop();
    active?.api.releaseStatus?.();
    active?.api.releaseDelete?.();
    active?.api.releaseToken?.();
    const api = new MemoryNotificationApi(scenario);
    const client: MobileNotificationClient = new MobileNotificationClient({ session, storageKey: "isolated-notification-fixture", api, adapter: adapter(api),
      isCurrent: (): boolean => active?.client === client, isInteractionAllowed: () => !api.locked,
      onOpen: data => { api.opened.push(data.eventId); return true; } });
    active = { api, client, stop: () => {} };
    active.stop = client.start();
    root.render(<Fixture key={++revision} api={api} client={client} initialScreen={initialScreen} />);
  },
  lock(value) { if (active) active.api.locked = value; setFixtureLocked(value); },
  configure(value) { if (active) Object.assign(active.api, value); },
  release(kind) {
    if (kind === "status") active?.api.releaseStatus?.();
    else if (kind === "token") active?.api.releaseToken?.();
    else active?.api.releaseDelete?.();
  },
  deleteNotification(id) { return active?.client.deleteNotification(id) ?? Promise.resolve(false); },
  metrics() {
    if (!active) throw new Error("FIXTURE_NOT_MOUNTED");
    const { api, client } = active;
    const state = client.getSnapshot();
    return { state, inboxCalls: [...api.inboxCalls], reads: [...api.reads], deletes: [...api.deletes], registrations: [...api.registrations],
      badges: [...api.badges], opened: [...api.opened], rows: api.rows.length, back: api.back, testCalls: api.testCalls, unregistrations: api.unregistrations,
      countsLabel: notificationCounts(state.unreadCount, state.total), tokenCalls: api.tokenCalls, tokenPending: api.tokenPending };
  },
};
window.notificationCenterFixture.render("populated");
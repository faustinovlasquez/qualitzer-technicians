/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { assignments, user } from "../server/tests/fixtures";
import type { useTechnicianApp } from "../src/application/useTechnicianApp";
import { companyBrandingContext } from "../src/branding/companyBrandingContext";
import type { CompanyBrandingInput, CompanyBrandingUi } from "../src/branding/contracts";
import type { Session } from "../src/domain/models";
import type { MobileNotificationState } from "../src/notifications/MobileNotificationClient";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../src/notifications/notificationSafety";
import type { MobileNotificationsModel } from "../src/notifications/useMobileNotifications";
import type { ProfileScreen } from "../src/screens/ProfileScreen";
import type { DeviceSecurityUi } from "../src/security/DeviceSecurityContext";
import { loadSource, reactFixture, tenant } from "./helpers/tenant-challenge";

type AppModel = ReturnType<typeof useTechnicianApp>;
type FixtureApp = Pick<AppModel,
  "session" | "notifications" | "tab" | "setTab" | "backTab" | "homeTab" | "busy" | "loading" | "restoring" |
  "finalizingSession" | "forcePassword" | "selectedTenant" | "selected" | "selectedOrder" |
  "selectedCreationKind" | "selectedOffline" | "offlineController" | "offline" | "offlineSetupError" |
  "offlineVerifiedAt" | "gatewayUrl" | "storageKey" | "data" | "range" | "agendaFocusDate" |
  "error" | "health" | "liveVerified" | "logout" | "refresh" | "openOffline" | "syncOffline" |
  "branch" | "checkConnection" | "closeOffline" | "focusAgendaDay" | "changeRange" | "openGroup" |
  "openWork" | "onWorkStatus" | "openCreate">;

interface Props {
  children?: unknown;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; disabled?: boolean };
  title?: string;
  label?: string;
  disabled?: boolean;
  visible?: boolean;
  onPress?: () => void;
  onBack?: () => void;
  notifications?: MobileNotificationsModel;
  app?: FixtureApp;
  allowAutomaticPin?: boolean;
}
interface Element { type: unknown; props: Props; }
interface AppExports {
  Application?: (props: { app: FixtureApp; allowAutomaticPin: boolean }) => Element;
  ApplicationRoot?: () => Element;
}
interface Access { allowed: boolean; isAllowed: () => boolean; }

const appUrl = new URL("../App.tsx", import.meta.url);
const appSource = readFileSync(appUrl, "utf8");
const forbidden = (id: string): never => { throw new Error(`UNEXPECTED_TEST_IMPORT:${id}`); };
const noop = (): void => {};
const resolved = async (): Promise<void> => {};
const jsx = (type: unknown, props: Props = {}): Element => ({ type, props });

function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return Array.from(value, (child: unknown) => child).flatMap(elements);
  if (!isElement(value)) return [];
  return [value, ...elements(value.props.children)];
}

function one(value: unknown, predicate: (element: Element) => boolean): Element {
  const found = elements(value).filter(predicate);
  assert.equal(found.length, 1, "Expected exactly one matching rendered element");
  return found[0];
}

function textLeaves(value: unknown): Array<string | number> {
  if (typeof value === "string" || typeof value === "number") return [value];
  if (Array.isArray(value)) return Array.from(value, (child: unknown) => child).flatMap(textLeaves);
  return isElement(value) ? textLeaves(value.props.children) : [];
}

function session(mode: Session["mode"] = "live"): Session {
  const actor = user();
  actor.accessBranchs.push({ id: 2, name: "Segunda sucursal", main: false });
  return { token: "qzm_notification_navigation_fixture", user: actor, branchId: 1, mode, tenant: { ...tenant } };
}

function notificationState(unreadCount: number | null): MobileNotificationState {
  return {
    ready: true, busy: false, inboxBusy: false, filterLocal: false, inboxError: null, permission: "granted", optedIn: true, registered: true,
    installationId: "navigation-fixture", status: null, preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    inbox: [{
      id: "00000000-0000-4000-8000-000000000001", kind: "WORK_TECHNICIAN_ASSIGNED", state: "pending",
      readAt: null, lastFailure: null, createdAt: "2026-09-12T12:00:00Z",
      data: { tenantOrigin: tenant.portalOrigin, companyBranchId: 1, eventId: "00000000-0000-4000-8000-000000000001",
        kind: "WORK_TECHNICIAN_ASSIGNED", groupType: "work", groupId: 11, workId: 11, date: "2026-09-12" },
    }],
    unreadCount, total: 240, canDelete: true, unreadOnly: false, page: 1, hasMore: true, error: null, notice: null,
  };
}

// Only App and Profile execute here; native ports and leaf screens are observable boundaries, not a mounted security provider.
function fixture(tab: FixtureApp["tab"] = "profile", unreadCount: number | null = 87, mode: Session["mode"] = "live") {
  const hooks = reactFixture();
  const rootHooks = reactFixture();
  const profileHooks = reactFixture();
  let activeHooks = hooks;
  const security: Pick<DeviceSecurityUi, "blocked" | "isUnlocked"> & { controller: { offer(): void; invalidateTrustedNativeInteraction(): void } } = {
    blocked: false, isUnlocked: () => !security.blocked, controller: { offer: noop, invalidateTrustedNativeInteraction: noop },
  };
  const branding: CompanyBrandingUi = { available: false, busy: false, canPin: false, message: "", logoMessage: "", onPin: noop };
  const brandingCalls: Array<{ input: CompanyBrandingInput; busy: boolean; automatic: boolean }> = [];
  const accessCalls: Access[] = [];
  const tabCalls: FixtureApp["tab"][] = [];
  const backHandlers = new Set<() => boolean>();
  const app: FixtureApp = {
    session: session(mode), tab, notifications: { client: null, state: notificationState(unreadCount), storageKey: "fixture-notifications", revokeForSession: resolved },
    setTab(next) { tabCalls.push(next); app.tab = next; },
    backTab() { tabCalls.push("today"); app.tab = "today"; },
    homeTab() { tabCalls.push("today"); app.tab = "today"; },
    busy: false, loading: false, restoring: false, finalizingSession: false, forcePassword: false,
    selectedTenant: null, selected: null, selectedOrder: null, selectedCreationKind: null, selectedOffline: false,
    offlineController: null, offline: null, offlineSetupError: null, offlineVerifiedAt: null,
    gatewayUrl: "https://gateway.example.test/mobile", storageKey: "fixture-session", data: assignments(),
    range: { startDate: "2026-09-12", endDate: "2026-09-12" }, agendaFocusDate: null,
    error: null, health: null, liveVerified: false, logout: resolved, refresh: resolved,
    openOffline: noop, syncOffline: resolved, branch: resolved, checkConnection: resolved, closeOffline: noop,
    focusAgendaDay: noop, changeRange: noop, openGroup: noop, openWork: noop, onWorkStatus: resolved, openCreate: noop,
  };
  const react = {
    Component: class {},
    useState: <T>(initial: T | (() => T)) => activeHooks.react.useState(initial),
    useRef: <T>(initial: T) => activeHooks.react.useRef(initial),
    useEffect: (effect: () => void | (() => void), dependencies: readonly unknown[]) => activeHooks.react.useEffect(effect, dependencies),
  };
  const native = {
    ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", View: "View", Text: "Text", ScrollView: "ScrollView",
    Platform: { OS: "android" }, useWindowDimensions: () => ({ width: 390, height: 844 }),
    StyleSheet: { create: <T>(styles: T): T => styles },
    BackHandler: { addEventListener(name: string, handler: () => boolean) {
      assert.equal(name, "hardwareBackPress"); backHandlers.add(handler);
      return { remove() { backHandlers.delete(handler); } };
    } },
  };
  const ui = {
    BodyText: "BodyText", Brand: "Brand", Button: "Button", Card: "Card", EmptyState: "EmptyState",
    IconButton: "IconButton", SectionTitle: "SectionTitle", Badge: "Badge",
  };
  const theme = loadSource<typeof import("../src/ui/theme")>("ui/theme.ts", forbidden);
  const profile = loadSource<{ ProfileScreen: (props: Parameters<typeof ProfileScreen>[0]) => Element }>("screens/ProfileScreen.tsx", id => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (id === "react-native") return native;
    if (id === "../ui/components") return ui;
    if (id === "../ui/theme") return theme;
    if (id === "../security/DeviceSecurityCard") return { DeviceSecurityCard: "DeviceSecurityCard" };
    return forbidden(id);
  });
  const imports = new Map<string, unknown>([
    ["react", react], ["react/jsx-runtime", { jsx, jsxs: jsx, Fragment: "Fragment" }], ["react-native", native],
    ["@expo/vector-icons", { Ionicons: "Ionicons" }], ["expo-status-bar", { StatusBar: "StatusBar" }],
    ["react-native-safe-area-context", { SafeAreaView: "SafeAreaView", SafeAreaProvider: "SafeAreaProvider" }],
    ["./src/application/useTechnicianApp", { useTechnicianApp(access: Access) { accessCalls.push(access); return app; } }],
    ["./src/screens/ProfileScreen", profile], ["./src/ui/components", ui], ["./src/ui/theme", theme],
    ["./src/branding/companyBrandingContext", { companyBrandingContext }],
    ["./src/branding/useCompanyBranding", { useCompanyBranding(input: CompanyBrandingInput, busy: boolean, automatic: boolean) {
      brandingCalls.push({ input, busy, automatic }); return branding;
    } }],
    ["./src/infrastructure/gatewayConfig", { gatewayConfiguration: { locked: true } }],
    ["./src/security/DeviceSecurityProvider", { DeviceSecurityProvider: "DeviceSecurityProvider" }],
    ["./src/security/DeviceSecurityContext", { PrivateModal: "PrivateModal", useDeviceSecurity: () => security }],
    ["./src/notifications", { NotificationCenterScreen: "NotificationCenterScreen" }],
    ["./src/screens/notifications/NotificationSettingsScreen", { NotificationSettingsScreen: "NotificationSettingsScreen" }],
    ["./src/screens/creation", { CreationScreen: "CreationScreen", CreationQuickMenu: "CreationQuickMenu" }],
    ["./src/domain/format", { weekRange: forbidden }], ["./src/domain/assignmentSchedule", { dailyRange: forbidden }],
  ]);
  for (const [path, name] of [
    ["screens/LoginScreen", "LoginScreen"], ["screens/TenantSelectionScreen", "TenantSelectionScreen"],
    ["screens/DashboardScreen", "DashboardScreen"], ["screens/WorkDetailScreen", "WorkDetailScreen"],
    ["screens/OrderDetailScreen", "OrderDetailScreen"], ["screens/workDetail/DetailUi", "Notice"],
    ["screens/ForcedPasswordScreen", "ForcedPasswordScreen"], ["screens/SessionSetupScreen", "SessionSetupScreen"],
    ["ui/SessionContextBar", "SessionContextBar"], ["ui/DevelopmentQrPanel", "DevelopmentQrPanel"],
    ["screens/offline/OfflineStatusBar", "OfflineStatusBar"], ["screens/offline/OfflineCenterScreen", "OfflineCenterScreen"],
  ]) imports.set(`./src/${path}`, { [name]: name });

  const module: { exports: AppExports } = { exports: {} };
  const code = ts.transpileModule(`${appSource}\nexport { Application, ApplicationRoot };`, {
    fileName: fileURLToPath(appUrl), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, __DEV__: false, require(id: string): unknown {
    return imports.has(id) ? imports.get(id) : forbidden(id);
  } }, { filename: fileURLToPath(appUrl) });
  const { Application, ApplicationRoot } = module.exports;
  assert.ok(Application);
  assert.ok(ApplicationRoot);
  let tree: Element;
  function render(): Element {
    activeHooks = hooks;
    hooks.render(() => Application!({ app, allowAutomaticPin: false }));
    hooks.flush();
    tree = hooks.render(() => Application!({ app, allowAutomaticPin: false }));
    hooks.flush();
    return tree;
  }
  render();
  return {
    app, security, accessCalls, tabCalls, backHandlers, brandingCalls, Application, render,
    get tree() { return tree; },
    renderRoot(): Element {
      activeHooks = rootHooks;
      const output = rootHooks.render(() => ApplicationRoot!());
      rootHooks.flush();
      return output;
    },
    settingsButton(): Element {
      const node = one(tree, element => element.type === profile.ProfileScreen);
      // Props originate from actual App JSX; this concrete boundary keeps the real Profile button callback intact.
      const props = node.props as Parameters<typeof ProfileScreen>[0];
      activeHooks = profileHooks;
      const output = profileHooks.render(() => profile.ProfileScreen(props));
      profileHooks.flush();
      return one(output, element => element.type === "Button" && element.props.title === "Configurar notificaciones");
    },
    close() { hooks.unmount(); rootHooks.unmount(); profileHooks.unmount(); },
  };
}

function navTab(tree: Element, label: string): Element {
  return one(tree, element => element.type === "Pressable" && element.props.accessibilityRole === "tab"
    && element.props.accessibilityLabel === label);
}

function press(element: Element): void {
  assert.notEqual(element.props.disabled, true);
  assert.ok(element.props.onPress);
  element.props.onPress();
}

for (const tab of ["notifications", "profile"] as const) {
  test(`actual App ${tab}: global 87 unread renders once in the navigation, not the partial inbox length`, t => {
    const f = fixture(tab); t.after(f.close);
    assert.equal(f.app.notifications.state?.inbox.length, 1);
    const avisos = navTab(f.tree, "Avisos, 87 sin leer");
    assert.equal(avisos.props.accessibilityState?.selected, tab === "notifications");
    assert.deepEqual(textLeaves(avisos), [87, "Avisos"]);
    const tabs = elements(f.tree).filter(element => element.props.accessibilityRole === "tab");
    assert.equal(tabs.length, 4);
    assert.deepEqual(tabs.flatMap(textLeaves).filter(value => typeof value === "number"), [87]);
    assert.equal(elements(avisos).filter(element => element.type === "Text" && element.props.children === 87).length, 1);
  });
}

test("actual App caps only the visual badge at 99+ and announces all 100 unread", t => {
  const f = fixture("notifications", 100); t.after(f.close);
  assert.deepEqual(textLeaves(navTab(f.tree, "Avisos, 100 sin leer")), ["99+", "Avisos"]);
});

for (const count of [0, null] as const) {
  test(`actual App unread ${count}: no badge and plain Avisos accessibility label`, t => {
    const f = fixture("profile", count); t.after(f.close);
    assert.deepEqual(textLeaves(navTab(f.tree, "Avisos")), ["Avisos"]);
  });
}

test("actual App absent notification state does not invent a numeric badge", t => {
  const f = fixture(); t.after(f.close);
  f.app.notifications = { ...f.app.notifications, state: null };
  assert.deepEqual(textLeaves(navTab(f.render(), "Avisos")), ["Avisos"]);
});

test("actual Profile button opens local Settings with the same model; Back returns without changing the app tab", t => {
  const f = fixture(); t.after(f.close);
  press(f.settingsButton());
  const settings = one(f.render(), element => element.type === "NotificationSettingsScreen");
  assert.equal(settings.props.notifications, f.app.notifications);
  assert.equal(elements(f.tree).some(element => element.type === "NotificationCenterScreen"), false);
  assert.deepEqual(f.tabCalls, []);
  assert.ok(settings.props.onBack); settings.props.onBack(); f.render();
  assert.equal(f.app.tab, "profile");
  assert.ok(f.settingsButton());
  assert.equal(elements(f.tree).some(element => element.type === "NotificationSettingsScreen"), false);
});

test("actual Avisos tab click routes directly to Center, not Settings or a push configuration panel", t => {
  const f = fixture(); t.after(f.close);
  press(navTab(f.tree, "Avisos, 87 sin leer"));
  const center = one(f.render(), element => element.type === "NotificationCenterScreen");
  assert.deepEqual(f.tabCalls, ["notifications"]);
  assert.equal(center.props.notifications, f.app.notifications);
  assert.equal(elements(f.tree).some(element => element.type === "NotificationSettingsScreen" || element.type === "NotificationStatusCard"), false);
  assert.ok(center.props.onBack); center.props.onBack(); f.render();
  assert.deepEqual(f.tabCalls, ["notifications", "today"]);
  assert.equal(elements(f.tree).some(element => element.type === "DashboardScreen"), true);
});

test("actual App Android Back exits Avisos, respects busy, and removes the subscription on leaving", t => {
  const f = fixture("notifications"); t.after(f.close);
  assert.equal(f.backHandlers.size, 1);
  f.app.busy = true; f.render();
  assert.equal([...f.backHandlers][0](), true);
  assert.deepEqual(f.tabCalls, []);
  f.app.busy = false; f.render();
  assert.equal([...f.backHandlers][0](), true); f.render();
  assert.deepEqual(f.tabCalls, ["today"]);
  assert.equal(f.backHandlers.size, 0);
});

for (const reset of ["token", "branch", "tenant", "tab"] as const) {
  test(`actual App resets local notification Settings after ${reset} changes`, t => {
    const f = fixture(); t.after(f.close);
    press(f.settingsButton());
    one(f.render(), element => element.type === "NotificationSettingsScreen");
    assert.ok(f.app.session);
    if (reset === "tab") { f.app.tab = "notifications"; f.render(); f.app.tab = "profile"; }
    else if (reset === "branch") f.app.session = { ...f.app.session, branchId: 2 };
    else if (reset === "token") f.app.session = { ...f.app.session, token: "qzm_reauthenticated_fixture" };
    else f.app.session = { ...session(), token: "qzm_other_tenant_fixture", tenant: { ...tenant, id: "tenant-2", name: "Empresa 2" } };
    f.render();
    assert.ok(f.settingsButton());
    assert.equal(elements(f.tree).some(element => element.type === "NotificationSettingsScreen"), false);
  });
}

test("actual App retained Profile callback cannot open Settings while device security is locked", t => {
  const f = fixture(); t.after(f.close);
  const button = f.settingsButton();
  assert.ok(button.props.onPress);
  f.security.blocked = true;
  button.props.onPress(); f.render();
  assert.equal(elements(f.tree).some(element => element.type === "NotificationSettingsScreen"), false);
  assert.equal(f.brandingCalls.at(-1)?.busy, true);
  assert.equal(f.brandingCalls.at(-1)?.automatic, false);
  f.security.blocked = false;
  button.props.onPress();
  one(f.render(), element => element.type === "NotificationSettingsScreen");
});

test("actual App blocks Profile settings callback while busy and retains Settings on locked Back", t => {
  const f = fixture(); t.after(f.close);
  f.app.busy = true; f.render();
  const disabled = f.settingsButton();
  assert.equal(disabled.props.disabled, true);
  assert.ok(disabled.props.onPress); disabled.props.onPress(); f.render();
  assert.equal(elements(f.tree).some(element => element.type === "NotificationSettingsScreen"), false);
  f.app.busy = false; f.render(); press(f.settingsButton());
  const settings = one(f.render(), element => element.type === "NotificationSettingsScreen");
  assert.ok(settings.props.onBack);
  f.security.blocked = true; settings.props.onBack();
  one(f.render(), element => element.type === "NotificationSettingsScreen");
  f.security.blocked = false; settings.props.onBack(); f.render(); assert.ok(f.settingsButton());
});

test("actual ApplicationRoot passes the live security predicate and allowed flag to useTechnicianApp", t => {
  const f = fixture(); t.after(f.close);
  const child = one(f.renderRoot(), element => element.type === f.Application);
  assert.equal(child.props.app, f.app);
  assert.equal(f.accessCalls.length, 1);
  const captured = f.accessCalls[0];
  assert.equal(captured.allowed, true);
  assert.equal(captured.isAllowed, f.security.isUnlocked);
  f.security.blocked = true;
  assert.equal(captured.isAllowed(), false);
  f.renderRoot();
  assert.equal(f.accessCalls[1].allowed, false);
});

test("actual App demo/null notifications keeps navigation and Profile Settings reachable without a client", t => {
  const f = fixture("profile", null, "demo"); t.after(f.close);
  f.app.notifications = { ...f.app.notifications, state: null }; f.render();
  assert.equal(f.app.session?.user.workerId, 42);
  assert.equal(f.brandingCalls.at(-1)?.input.session?.mode, "demo");
  assert.deepEqual(textLeaves(navTab(f.tree, "Avisos")), ["Avisos"]);
  press(f.settingsButton());
  assert.equal(one(f.render(), element => element.type === "NotificationSettingsScreen").props.notifications?.client, null);
});

test("AST wiring: technician notifications receive the security predicate and tab changes use the guarded context", () => {
  const source = ts.createSourceFile("useTechnicianApp.ts", readFileSync(new URL("../src/application/useTechnicianApp.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [];
  const functions: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isFunctionDeclaration(node)) functions.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const notificationCalls = calls.filter(call => ts.isIdentifier(call.expression) && call.expression.text === "useMobileNotifications");
  assert.equal(notificationCalls.length, 1);
  const options = notificationCalls[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(options));
  const predicate = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "isInteractionAllowed");
  assert.ok(predicate && ts.isPropertyAssignment(predicate));
  assert.equal(predicate.initializer.getText(source), "isAccessAllowed");
  const changeTab = functions.find(fn => fn.name?.text === "changeTab");
  assert.ok(changeTab?.body);
  const guard = changeTab.body.statements[0];
  assert.ok(ts.isIfStatement(guard));
  assert.match(guard.expression.getText(source), /!currentContext\(\)/);
  assert.ok(ts.isReturnStatement(guard.thenStatement));
  const context = functions.find(fn => fn.name?.text === "currentContext");
  assert.ok(context?.body);
  assert.match(context.getText(source), /requireUnlocked\s*=\s*true/);
  assert.match(context.body.getText(source), /!requireUnlocked \|\| isAccessAllowed\(\)/);
  assert.match(source.text, /const isAccessAllowed = access\?\.isAllowed \?\? alwaysAllowed/);
});
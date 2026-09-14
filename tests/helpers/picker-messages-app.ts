import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Session } from "../../src/domain/models";
import type { DeviceSecurityUi } from "../../src/security/DeviceSecurityContext";
import { tenantStorageNamespace } from "../../src/domain/tenantSession";
import { user } from "../../server/tests/fixtures";
import { agendaReactFixture } from "./agenda-load-lifecycle";
import { tenant } from "./tenant-challenge";

export function pickerAppRootFixture(security: () => DeviceSecurityUi) {
  const hooks = agendaReactFixture();
  const session: Session = { token: "fixture-token", tenant, user: user(), branchId: 1, mode: "live" };
  const gateway = "https://gateway.example.test/mobile";
  const model = { session: session as Session | null, storageKey: tenantStorageNamespace(session, gateway, 1), liveVerified: false,
    busy: false, loading: false, restoring: false, finalizingSession: false, forcePassword: false, selected: null,
    selectedOrder: null, selectedCreationKind: null, selectedOffline: false, offlineController: null,
    notifications: { client: null }, closeOffline: () => {}, offlineSetupError: null };
  const accessCalls: Array<{ allowed: boolean; isAllowed(): boolean }> = [];
  const native = { StyleSheet: { create: <T>(styles: T) => styles }, Platform: { OS: "android" }, View: "View", Text: "Text", useWindowDimensions: () => ({ width: 390 }) };
  const imports = new Map<string, unknown>([
    ["react", { ...hooks.react, Component: class {} }],
    ["react/jsx-runtime", { jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) }],
    ["react-native", native], ["@expo/vector-icons", {}], ["expo-status-bar", {}], ["react-native-safe-area-context", {}],
    ["./src/application/useTechnicianApp", { useTechnicianApp: (access: { allowed: boolean; isAllowed(): boolean }) => { accessCalls.push(access); return model; } }],
    ["./src/security/DeviceSecurityContext", { useDeviceSecurity: security, PrivateModal: "Modal" }],
    ["./src/ui/theme", { palette: {} }], ["./src/ui/components", { EmptyState: "EmptyState", Button: "Button" }],
    ["./src/infrastructure/gatewayConfig", { gatewayConfiguration: { locked: true } }],
  ]);
  for (const leaf of ["screens/LoginScreen", "screens/TenantSelectionScreen", "screens/DashboardScreen", "screens/WorkDetailScreen", "screens/OrderDetailScreen", "screens/workDetail/DetailUi", "screens/ProfileScreen", "screens/ForcedPasswordScreen", "screens/SessionSetupScreen", "ui/SessionContextBar", "ui/DevelopmentQrPanel", "screens/creation", "notifications", "screens/notifications/NotificationSettingsScreen", "screens/offline/OfflineStatusBar", "screens/offline/OfflineCenterScreen", "domain/format", "domain/assignmentSchedule", "branding/useCompanyBranding", "branding/companyBrandingContext", "security/DeviceSecurityProvider"]) imports.set(`./src/${leaf}`, {});
  const filename = new URL("../../App.tsx", import.meta.url);
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(`${source}\nexport { ApplicationRoot };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module: { exports: { ApplicationRoot?: () => unknown } } = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, __DEV__: false, require(id: string) {
    assert.ok(imports.has(id), `UNEXPECTED_APP_IMPORT:${id}`); return imports.get(id);
  } });
  assert.ok(module.exports.ApplicationRoot);
  const root = module.exports.ApplicationRoot;
  function render() { const tree = hooks.render(root); hooks.commit(); return tree; }
  render();
  return { model, accessCalls, render, close: hooks.unmount,
    setSession(next: Session | null) { model.session = next; model.storageKey = next ? tenantStorageNamespace(next, gateway, next.branchId) : "anonymous"; },
  };
}
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import * as jsx from "react/jsx-runtime";
import type { OfflineOperation, OfflineSnapshot } from "../../src/domain/offline";
import { OfflineQueuedError } from "../../src/domain/offline";
import { loadSource } from "./tenant-challenge";
import { agendaReactFixture } from "./agenda-load-lifecycle";

export const uiScope = { groupId: "direct-11", workId: "11", companyBranchId: 1, startDate: "2026-09-01", endDate: "2026-09-01" };
export const uiOperation = { id: "00000000-0000-4000-8000-000000000001", createdAt: 1000, attempts: 0, nextAttemptAt: 0, status: "pending" as const, scope: uiScope };
export function uiSnapshot(operations: OfflineOperation[] = []): OfflineSnapshot {
  return { online: false, preparing: false, syncing: false, authBlocked: false, pending: operations.filter((entry) => entry.status !== "applied").length,
    conflicts: 0, lastSyncedAt: null, lastError: null, coverage: [], operations };
}
export function queued(kind: "timer" | "answer" | "comment" | "checklist" | "document", operationId = uiOperation.id): OfflineQueuedError {
  return new OfflineQueuedError({ kind, operationId, operationIds: [operationId], date: uiScope.startDate, ownsFiles: kind === "document" });
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function settle(): Promise<void> { await new Promise<void>((done) => setImmediate(done)); }
export function durableReactFixture() {
  const hooks = agendaReactFixture();
  return { ...hooks, flush: hooks.commit };
}
export interface UiHooks {
  react: object;
  render<T>(render: () => T): T;
  flush(): void;
  unmount(): void;
}
export type Wrapped<P> = (props: P) => { type: (props: P) => ReactNode; props: P };
export function renderWrapped<P>(hooks: UiHooks, component: Wrapped<P>, props: P): ReactNode {
  const root = component(props);
  const tree = hooks.render(() => root.type(root.props));
  hooks.flush();
  return tree;
}
export function elements<P extends object>(node: ReactNode, type: string): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type && isValidElement<P>(node) ? [node] : []), ...elements<P>(node.props.children, type)];
}
export interface UiAction { title?: string; label?: string; accessibilityLabel?: string; disabled?: boolean; loading?: boolean; onPress(): void; }
export function action(node: ReactNode, label: string): UiAction {
  const found = [...elements<UiAction>(node, "Button"), ...elements<UiAction>(node, "IconButton")].find(({ props }) =>
    props.title === label || props.label === label || props.accessibilityLabel === label);
  assert.ok(found, `Missing action: ${label}`);
  return found.props;
}
export function uiModule<T>(relative: string, hooks: UiHooks, overrides: { [name: string]: unknown } = {}): T {
  const localRequire = createRequire(resolve(__dirname, "../../src", relative));
  return loadSource<T>(relative, (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id === "react") return new Proxy(hooks.react, { get: (target, property) => Reflect.get(target, property) ?? (property === "useContext" ? () => null : undefined) });
    if (id === "react/jsx-runtime") return jsx;
    if (id === "react-native") return { Platform: { OS: "web" }, StyleSheet: { create: (styles: object) => styles },
      View: "View", Text: "Text", Image: "Image", ScrollView: "ScrollView", Pressable: "Pressable", RefreshControl: "RefreshControl", KeyboardAvoidingView: "KeyboardAvoidingView", ActivityIndicator: "ActivityIndicator" };
    if (id === "@expo/vector-icons") return { Ionicons: "Ionicons" };
    if (id === "expo-linear-gradient") return { LinearGradient: "LinearGradient" };
    if (id === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
    if (id.endsWith("/ui/components")) return { Badge: "Badge", BodyText: "BodyText", Button: "Button", Card: "Card", Field: "Field", IconButton: "IconButton", SectionTitle: "SectionTitle" };
    if (id.endsWith("/ui/time/TimeField")) return { TimeField: "TimeField" };
    if (id.endsWith("/ui/time/NumericSelectField")) return { NumericSelectField: "NumericSelectField", DayOffsetField: "DayOffsetField" };
    if (id.endsWith("/DetailUi")) return { Notice: "Notice", AttachmentList: "AttachmentList" };
    if (id.endsWith("/detailStyles")) return { styles: {} };
    if (id.endsWith("/workspaceStyles")) return { workspaceStyles: {} };
    if (id.endsWith("/DeviceSecurityContext")) return { PrivateModal: "Modal", DeviceSecurityContext: {} };
    if (id.endsWith("/files/useCameraPermissionGuide")) return uiModule("screens/workDetail/files/useCameraPermissionGuide.ts", hooks, overrides);
    if (id.endsWith("/files/CameraPermissionGuide")) return { CameraPermissionGuide: "CameraPermissionGuide" };
    if (id.endsWith("/security/useTrustedNativePicker")) return { useTrustedNativePicker: () => <T>(operation: () => Promise<T>) => operation() };
    if (id.endsWith("/OfflineFileCard")) return { OfflineFileCard: "OfflineFileCard" };
    if (id === "./fileRules" || id === "./files/fileRules") return uiModule("screens/workDetail/files/fileRules.ts", hooks, {
      "expo-file-system": {}, "../localPhotos": { MAX_PHOTO_BYTES: 25 * 1024 * 1024, MAX_TOTAL_BYTES: 40 * 1024 * 1024 },
    });
    return localRequire(id);
  }, { URL, setInterval, clearInterval, addEventListener: () => {}, removeEventListener: () => {} });
}
export function memoryDraftStorage() {
  const values = new Map<string, string>();
  const control = { fail: false, failSentMarker: false };
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (control.fail || (control.failSentMarker && key.endsWith("/comment-sent"))) throw new Error("LOCAL_STORAGE_FAILED");
      values.set(key, value);
    },
    removeItem: async (key: string) => { if (control.fail) throw new Error("LOCAL_STORAGE_FAILED"); values.delete(key); },
    getAllKeys: async () => [...values.keys()],
    multiRemove: async (keys: string[]) => { keys.forEach((key) => values.delete(key)); },
  };
  return { values, control, storage };
}
import assert from "node:assert/strict";
import type { DependencyList, Dispatch, SetStateAction } from "react";
import type { AssignmentReadOptions } from "../../src/domain/assignmentRead";
import type { Assignments, DateRange, Tenant, User, WorkScope } from "../../src/domain/models";
import type { OfflineSnapshot } from "../../src/domain/offline";
import * as creation from "../../src/domain/creation";
import * as workActivities from "../../src/domain/workActivities";
import * as userSignatures from "../../src/domain/userSignatures";
import * as progress from "../../src/domain/assignmentChecklistProgress";
import * as schedule from "../../src/domain/assignmentSchedule";
import * as format from "../../src/domain/format";
import * as weeklySchedule from "../../src/domain/weeklySchedule";
import * as tenantSession from "../../src/domain/tenantSession";
import * as tenantSchemas from "../../src/infrastructure/tenantSchemas";
import * as notificationSafety from "../../src/notifications/notificationSafety";
import type { UseMobileNotificationsOptions } from "../../src/notifications/useMobileNotifications";
import type { NotificationData } from "../../src/domain/notifications";
import * as connection from "../../src/infrastructure/gatewayConnection";
import * as errors from "../../src/infrastructure/errors";
import { bindForegroundSource } from "../../src/offline/foregroundBinding";
import { user } from "../../server/tests/fixtures";
import { equipmentChecklistPayload } from "./assignment-checklist";
import { loadSource, tenant } from "./tenant-challenge";

export type AgendaApp = ReturnType<typeof import("../../src/application/useTechnicianApp").useTechnicianApp>;
export const frozenNow = Date.parse("2026-09-11T15:00:00.000Z");

interface EffectSlot {
  dependencies?: DependencyList;
  run(): void | (() => void);
  cleanup?: () => void;
}

function sameDependencies(previous: DependencyList | undefined, next: DependencyList | undefined): boolean {
  return previous !== undefined && next !== undefined && previous.length === next.length
    && next.every((value, index) => Object.is(value, previous[index]));
}

export function agendaReactFixture() {
  const slots: unknown[] = [];
  const effects = new Map<number, EffectSlot>();
  const pending = new Set<number>();
  let cursor = 0;
  let dirty = true;
  let disposed = false;
  const react = {
    useState<T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
      const index = cursor++;
      if (!(index in slots)) {
        const slot = {
          value: typeof initial === "function" ? (initial as () => T)() : initial,
          set(next: SetStateAction<T>) {
            if (disposed) return;
            const value = typeof next === "function" ? (next as (value: T) => T)(slot.value) : next;
            if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
          },
        };
        slots[index] = slot;
      }
      const slot = slots[index] as { value: T; set: Dispatch<SetStateAction<T>> };
      return [slot.value, slot.set];
    },
    useRef<T>(initial: T): { current: T } {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useMemo<T>(factory: () => T, dependencies: DependencyList): T {
      const index = cursor++;
      const previous = slots[index] as { dependencies: DependencyList; value: T } | undefined;
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
        slots[index] = { dependencies: [...dependencies], value: factory() };
      }
      return (slots[index] as { value: T }).value;
    },
    useCallback<T>(callback: T, dependencies: DependencyList): T {
      return react.useMemo(() => callback, dependencies);
    },
    useEffect(run: EffectSlot["run"], dependencies?: DependencyList): void {
      const index = cursor++;
      const previous = effects.get(index);
      if (!previous || !sameDependencies(previous.dependencies, dependencies)) {
        effects.set(index, { run, dependencies: dependencies ? [...dependencies] : undefined, cleanup: previous?.cleanup });
        pending.add(index);
      }
    },
    useSyncExternalStore<T>(subscribe: (listener: () => void) => () => void, snapshot: () => T): T {
      const [, force] = react.useState(0);
      const current = react.useRef(snapshot());
      current.current = snapshot();
      react.useEffect(() => {
        const check = () => {
          const next = snapshot();
          if (!Object.is(current.current, next)) { current.current = next; force((value) => value + 1); }
        };
        const detach = subscribe(check);
        check();
        return detach;
      }, [subscribe, snapshot]);
      return current.current;
    },
  };
  return {
    react,
    get dirty() { return dirty; },
    get pending() { return pending.size; },
    render<T>(read: () => T): T {
      assert.equal(disposed, false, "cannot render an unmounted fixture");
      cursor = 0; dirty = false;
      return read();
    },
    commit(): void {
      const batch = [...pending].map((index) => effects.get(index)!);
      pending.clear();
      for (const effect of batch) { effect.cleanup?.(); effect.cleanup = undefined; }
      for (const effect of batch) effect.cleanup = effect.run() ?? undefined;
    },
    unmount(): void {
      if (disposed) return;
      disposed = true;
      for (const effect of effects.values()) effect.cleanup?.();
      pending.clear();
    },
  };
}

export interface ControlledRead {
  range: DateRange;
  branchId: number;
  signal: AbortSignal;
  aborts: number;
  settled: boolean;
  resolve(data?: Assignments): void;
  reject(error: Error): void;
}

export function agendaFixture(options: { online?: boolean; overrides?: { [specifier: string]: unknown } } = {}) {
  const hooks = agendaReactFixture();
  const access = { allowed: true, isAllowed: (): boolean => access.allowed };
  const reads: ControlledRead[] = [];
  const calls = { loadSession: 0, repositories: 0, me: 0, saves: 0, removeSession: 0, answers: 0, options: 0, binds: 0, detaches: 0, localAssignments: 0, statuses: 0 };
  const listeners = new Set<(active: boolean) => void>();
  let foreground = true;
  let ignoreNextAbort = false;
  let data = equipmentChecklistPayload();
  let answerGate: (() => Promise<void>) | undefined;
  let localGate: (() => Promise<Assignments>) | undefined;
  let statusGate: (() => Promise<void>) | undefined;
  let notificationData: Assignments | undefined;
  let notificationOptions: UseMobileNotificationsOptions | undefined;
  const account: User = { ...user(), accessBranchs: [...user().accessBranchs, { id: 2, name: "Secundaria", main: false }] };
  const snapshot = (): OfflineSnapshot => ({ online: options.online ?? false, preparing: false, syncing: false, authBlocked: false,
    pending: 0, conflicts: 0, lastSyncedAt: null, lastError: null, coverage: [], operations: [] });

  function assignments(range: DateRange, branchId: number, readOptions?: AssignmentReadOptions): Promise<Assignments> {
    if (!readOptions && notificationData) return Promise.resolve(structuredClone(notificationData));
    assert.ok(readOptions?.signal, "assignments must receive third-argument options.signal");
    const signal = readOptions.signal;
    const ignoreAbort = ignoreNextAbort;
    ignoreNextAbort = false;
    const captured = structuredClone(data);
    return new Promise<Assignments>((resolve, reject) => {
      const finish = (action: () => void) => {
        if (call.settled) return;
        call.settled = true;
        signal.removeEventListener("abort", abort);
        action();
      };
      const call: ControlledRead = {
        range: { ...range }, branchId, signal, aborts: 0, settled: false,
        resolve: (value = captured) => finish(() => resolve(structuredClone(value))),
        reject: (error) => finish(() => reject(error)),
      };
      const abort = () => {
        call.aborts++;
        if (!ignoreAbort) call.reject(Object.assign(new Error("fixture read cancelled"), { name: "AbortError" }));
      };
      reads.push(call);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  async function answer(_scope: WorkScope, stepId: string): Promise<void> {
    calls.answers++;
    assert.equal(stepId, "1009");
    await answerGate?.();
    data = structuredClone(data);
    data.groups[0].works[0].checklists[0].steps[8].selectValue = "approved";
  }

  class HttpRepository {
    token = "";
    onUnauthorized: (() => void) | null = null;
    constructor(readonly baseUrl: string, public tenant: Tenant) { calls.repositories++; }
    me = async (): Promise<User> => { calls.me++; return structuredClone(account); };
    assignments = assignments;
    answer = answer;
    logout = async (): Promise<void> => {};
  }

  class OfflineRepository {
    dependencies: { onVerified?: (value: User) => Promise<void> } = {};
    private snapshot = snapshot();
    private listeners = new Set<() => void>();
    starts = 0;
    stops = 0;
    foreground: boolean[] = [];
    constructor(readonly remote: HttpRepository) {}
    getSnapshot = (): OfflineSnapshot => this.snapshot;
    subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    update = (next: Partial<OfflineSnapshot>): void => { this.snapshot = { ...this.snapshot, ...next }; for (const listener of this.listeners) listener(); };
    start = (): void => { this.starts++; };
    stop = (): void => { this.stops++; };
    setForeground = (active: boolean): void => { this.foreground.push(active); };
    syncNow = async (): Promise<void> => {};
    hasPendingChanges = async (): Promise<boolean> => false;
    engine = { refresh: async (): Promise<void> => {}, blockAuth: async (): Promise<void> => {} };
    assignments = assignments;
    answer = answer;
    localAssignments = async (): Promise<Assignments> => { calls.localAssignments++; return localGate ? localGate() : structuredClone(data); };
    status = async (): Promise<void> => { calls.statuses++; await statusGate?.(); };
    creationOptions = async (): Promise<void> => { calls.options++; };
  }

  const wrappers: OfflineRepository[] = [];
  const gateway = "https://gateway.example.test/mobile";
  const configuration = { locked: true, url: gateway, error: null };
  const noop = async (): Promise<void> => {};
  const module = loadSource<typeof import("../../src/application/useTechnicianApp")>("application/useTechnicianApp.ts", (id) => {
    if (options.overrides && Object.hasOwn(options.overrides, id)) return options.overrides[id];
    if (id === "react") return hooks.react;
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id === "expo-constants") return {};
    if (id === "../infrastructure/HttpTechnicianRepository") return { HttpTechnicianRepository: HttpRepository };
    if (id === "../infrastructure/gatewayConfig") return { gatewayConfiguration: configuration };
    if (id === "../infrastructure/gatewayConnection") return connection;
    if (id === "../infrastructure/errors") return errors;
    if (id === "../domain/tenantSession") return tenantSession;
    if (id === "../infrastructure/tenantSchemas") return tenantSchemas;
    if (id === "../domain/assignmentChecklistProgress") return progress;
    if (id === "../domain/assignmentSchedule") return schedule;
    if (id === "../domain/format") return format;
    if (id === "../domain/creation") return creation;
    if (id === "../domain/workActivities") return workActivities;
    if (id === "../domain/userSignatures") return userSignatures;
    if (id === "../domain/weeklySchedule") return weeklySchedule;
    if (id === "../notifications") return { useMobileNotifications: (options: UseMobileNotificationsOptions) => { notificationOptions = options; return { client: null, revokeForSession: noop }; }, bindNotificationApi: () => null };
    if (id === "../notifications/notificationSafety") return notificationSafety;
    if (id === "../offline") return {
      OfflineTechnicianRepository: OfflineRepository,
      createOfflineRepository: async (remote: HttpRepository) => { const wrapped = new OfflineRepository(remote); wrappers.push(wrapped); return wrapped; },
      saveOfflineProfile: noop, restoreOfflineProfile: async () => null, establishVerifiedOfflineSession: noop, disableOfflineProfile: noop,
    };
    if (id === "../offline/connectivity") return { createConnectivity: () => ({ current: async () => true, subscribe: () => () => {} }) };
    if (id === "../offline/foreground") return {
      readForeground: () => foreground,
      bindForeground: (controller: { setForeground(active: boolean): void }) => bindForegroundSource(controller, {
        current: () => foreground,
        subscribe: (listener) => { calls.binds++; listeners.add(listener); return () => { calls.detaches++; listeners.delete(listener); }; },
      }),
    };
    if (id === "../infrastructure/sessionStorage") return {
      loadSession: async () => { calls.loadSession++; return { token: "fixture-token", gatewayUrl: gateway, branchId: 1, tenant }; },
      saveSession: async () => { calls.saves++; }, saveGateway: noop,
      removeSession: async () => { calls.removeSession++; },
    };
    if (id === "../screens/orders/lifecycle/lifecycleDrafts") return { clearOrderLifecycleDrafts: noop };
    if (id === "../screens/workDetail/useWorkDraft") return { clearWorkDetailDrafts: noop };
    if (id === "../screens/workDetail/files/WorkspaceDraftStore") return { cleanupFileWorkspace: noop };
    if (id === "../screens/creation/creationDrafts") return { clearCreationDrafts: noop };
    if (["../infrastructure/DemoTechnicianRepository", "../infrastructure/tenantChallengeClock", "../domain/creation", "../notifications/notificationSafety", "../offline/DurableStore", "../domain/checklistAssignment"].includes(id)) return {};
    throw new Error(`UNEXPECTED_IMPORT:${id}`);
  }, { AbortController, __DEV__: false, fetch: () => { throw new Error("NETWORK_FORBIDDEN"); } });

  let app: AgendaApp | undefined;
  const render = (): AgendaApp => { app = hooks.render(() => module.useTechnicianApp(access)); return app; };
  async function flush(): Promise<AgendaApp> {
    for (let turn = 0; turn < 40; turn++) {
      if (hooks.dirty || !app) render();
      hooks.commit();
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!hooks.dirty && !hooks.pending) return app!;
    }
    throw new Error("HOOK_DID_NOT_SETTLE: unstable dependencies or an effect loop");
  }
  return {
    access, calls, reads, wrappers, render, flush,
    unmount: hooks.unmount,
    ignoreNextAbort: () => { ignoreNextAbort = true; },
    setAnswerGate: (gate: () => Promise<void>) => { answerGate = gate; },
    setLocalAssignments: (gate: () => Promise<Assignments>) => { localGate = gate; },
    setStatusGate: (gate: () => Promise<void>) => { statusGate = gate; },
    setNotificationAssignments: (value: Assignments) => { notificationData = value; },
    async openNotification(payload: NotificationData): Promise<boolean> {
      assert.ok(notificationOptions?.session);
      return notificationOptions.onOpen(payload, { session: notificationOptions.session, storageKey: notificationOptions.storageKey, isCurrent: () => true });
    },
    foreground(active: boolean): void { foreground = active; for (const listener of listeners) listener(active); },
    async restore(): Promise<AgendaApp> {
      const loaded = await flush();
      assert.equal(loaded.restoring, false);
      assert.equal(loaded.busy, false);
      assert.equal(loaded.session?.branchId, 1, loaded.error ?? "session must restore");
      assert.equal(calls.loadSession, 1);
      assert.equal(reads.length, 1, "only the foreground day read may start during restoration");
      assert.equal(loaded.loading, true);
      return loaded;
    },
    async loadDay(): Promise<AgendaApp> { await this.restore(); reads[0].resolve(); return flush(); },
  };
}
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import type { TechnicianRepository } from "../domain/TechnicianRepository";
import type { MaintenanceDeliveryInput } from "../domain/orderLifecycle";
import { workActions, type WorkActivityInput } from "../domain/workActivities";
import { clearOrderLifecycleDrafts } from "../screens/orders/lifecycle/lifecycleDrafts";
import type { AssignmentGroup, Assignments, AssignmentWork, Attachment, CommentPage, DateRange, GroupScope, Health, LocalPhoto, LoginResult, Session, StatusInput, StepAnswer, Tenant, TenantLoginChallenge, User, WorkDetailTab, WorkOpenOptions, WorkScope } from "../domain/models";
import { dateKey, weekRange } from "../domain/format";
import { assignmentDay, assignmentDays, assignmentWorkForDay, assignmentWorkForQueryDate, assignmentWorkQueryRange, assignmentWorkSnapshotForQueryDate, dailyRange } from "../domain/assignmentSchedule";
import { normalizeAssignmentsChecklistProgress } from "../domain/assignmentChecklistProgress";
import { DEMO_TENANT, requireSessionTenant, sameTenant, tenantStorageNamespace } from "../domain/tenantSession";
import { getTenantChallengeRemaining } from "../infrastructure/tenantChallengeClock";
import { HttpTechnicianRepository } from "../infrastructure/HttpTechnicianRepository";
import { DemoTechnicianRepository } from "../infrastructure/DemoTechnicianRepository";
import { ApiError, NetworkError, errorText } from "../infrastructure/errors";
import { loadGateway, loadSession, removeSession, saveGateway, saveSession, type StoredSession } from "../infrastructure/sessionStorage";
import { tenantSchema } from "../infrastructure/tenantSchemas";
import { clearWorkDetailDrafts } from "../screens/workDetail/useWorkDraft";
import { cleanupFileWorkspace } from "../screens/workDetail/files/WorkspaceDraftStore";
import { creationInputSchema, creationKindSchema, creationOptionsQuerySchema, creationOptionsSchema, creationResultSchema, type CreationInput, type CreationKind, type CreationOptions, type CreationOptionsQuery, type CreationResult } from "../domain/creation";
import { clearCreationDrafts } from "../screens/creation/creationDrafts";
import { scheduleClock } from "../domain/weeklySchedule";
import { bindNotificationApi, useMobileNotifications, type MobileNotificationClient, type NotificationData, type NotificationOpenContext } from "../notifications";
import { notificationForSession, sameNotification, sameNotificationSession } from "../notifications/notificationSafety";
import { createOfflineRepository, disableOfflineProfile, establishVerifiedOfflineSession, hasPendingChanges, OfflineTechnicianRepository, restoreOfflineSession, saveOfflineProfile } from "../offline";
import { createDurableStore } from "../offline/DurableStore";
import { createConnectivity } from "../offline/connectivity";
import { bindForeground, readForeground } from "../offline/foreground";
import { checklistAssignmentResultSchema, checklistCatalogPageSchema, type ChecklistAssignmentResult, type ChecklistCatalogQuery } from "../domain/checklistAssignment";
import type { OfflineController, OfflineQueuedOutcome, OfflineSnapshot } from "../domain/offline";
import { loginConnectionError, requireConfiguredGateway, storedGatewayMismatch, suggestedExpoGatewayUrl } from "../infrastructure/gatewayConnection";
import { gatewayConfiguration } from "../infrastructure/gatewayConfig";

const subscribeNothing = (): (() => void) => () => {};
const emptyOfflineSnapshot = (): null => null;
const alwaysAllowed = (): boolean => true;

function remoteRepository(repo: TechnicianRepository | null): TechnicianRepository | null {
  return repo instanceof OfflineTechnicianRepository ? repo.remote : repo;
}

async function pendingOfflineChanges(repo: TechnicianRepository | null): Promise<boolean> {
  return repo instanceof OfflineTechnicianRepository ? repo.hasPendingChanges() : hasPendingChanges(await createDurableStore());
}

type AppTab = "today" | "agenda" | "notifications" | "profile";
interface SelectedWork {
  groupId: string;
  workId: string;
  draftGroupId?: string;
  draftWorkId?: string;
  queryDate: string;
  scheduledDate: string;
  initialTab?: WorkDetailTab;
  initialAction?: "deliver";
}
interface SelectedOrder { id: string; draftGroupId?: string; queryDate: string; initialTab: "works" | "files"; }
interface PendingLogin {
  readonly repo: HttpTechnicianRepository;
  readonly pendingLoginGateway: string;
  readonly challenge: TenantLoginChallenge;
  readonly version: number;
}
interface SessionSetup {
  repo: HttpTechnicianRepository;
  token: string;
  url: string;
  tenant: Tenant;
  version: number;
  preferredBranch: number | null;
  canRequirePasswordChange: boolean;
  verifiedUser?: User;
}

function selectedWorkDetails(assignments: Assignments | null, selection: SelectedWork | null) {
  const group = assignments?.groups.find((item) => item.id === selection?.groupId);
  const foundWork = group?.works.find((item) => item.id === selection?.workId);
  const scheduledWork = foundWork && selection ? assignmentWorkForDay(foundWork, selection.scheduledDate) : undefined;
  const schedule = scheduledWork && selection ? assignmentWorkSnapshotForQueryDate(scheduledWork, selection.queryDate) : undefined;
  const work = scheduledWork && selection && assignmentDay(scheduledWork.scheduledDate) === selection.scheduledDate
    ? assignmentWorkForQueryDate(scheduledWork, selection.queryDate) : undefined;
  return { group, work, schedule };
}

async function clearSessionDrafts(storageKey: string): Promise<void> {
  clearOrderLifecycleDrafts(storageKey);
  const orderPrefix = `${JSON.stringify(["order-files", storageKey]).slice(0, -1)},`;
  const results = await Promise.allSettled([
    clearCreationDrafts(storageKey),
    clearWorkDetailDrafts(storageKey),
    cleanupFileWorkspace(storageKey),
    cleanupFileWorkspace(orderPrefix),
  ]);
  if (results.some((result) => result.status === "rejected")) throw new Error("No se pudieron eliminar todos los borradores y archivos locales de esta sesión.");
}

function persistSession(value: StoredSession): Promise<void> {
  const { id, name, portalOrigin, environment } = value.tenant;
  return saveSession({ ...value, tenant: { id, name, portalOrigin, environment } });
}

function defaultGateway(): string {
  return gatewayConfiguration.url;
}
export function useTechnicianApp(access?: { allowed: boolean; isAllowed(): boolean }) {
  const accessAllowed = access?.allowed ?? true;
  const isAccessAllowed = access?.isAllowed ?? alwaysAllowed;
  const [gatewayUrl, setGatewayUrl] = useState(defaultGateway);
  const [challenge, setChallenge] = useState<TenantLoginChallenge | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Assignments | null>(null);
  const [range, setRange] = useState<DateRange>(() => dailyRange(dateKey()));
  const [agendaFocusDate, setAgendaFocusDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedWork | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<SelectedOrder | null>(null);
  const [selectedCreationKind, setSelectedCreationKind] = useState<CreationKind | null>(null);
  const [tab, setTab] = useState<AppTab>("today");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [forcePassword, setForcePassword] = useState(false);
  const [finalizingSession, setFinalizingSession] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [offlineController, setOfflineController] = useState<OfflineTechnicianRepository | null>(null);
  const [offlineVerifiedAt, setOfflineVerifiedAt] = useState<number | null>(null);
  const [offlineSetupError, setOfflineSetupError] = useState<string | null>(null);
  const [liveVerified, setLiveVerified] = useState(false);
  const [selectedOffline, setSelectedOffline] = useState(false);
  const offline: OfflineSnapshot | null = useSyncExternalStore(offlineController?.subscribe ?? subscribeNothing, offlineController?.getSnapshot ?? emptyOfflineSnapshot, offlineController?.getSnapshot ?? emptyOfflineSnapshot);
  const repository = useRef<TechnicianRepository | null>(null);
  const gatewayBlock = useRef<string | null>(gatewayConfiguration.error);
  const requestVersion = useRef(0);
  const assignmentRead = useRef<{ key: string; version: number; generation: number; repo: TechnicianRepository; controller: AbortController; pending: Promise<void> } | null>(null);
  const baselineRead = useRef<AbortController | null>(null);
  const sessionVersion = useRef(0);
  const creationVersion = useRef(0);
  const pendingLogin = useRef<PendingLogin | null>(null);
  const sessionSetup = useRef<SessionSetup | null>(null);
  const actionLock = useRef<symbol | null>(null);
  const logoutInProgress = useRef(false);
  const notificationClient = useRef<MobileNotificationClient | null>(null);
  const manualRefresh = useRef<{ session: Session; range: DateRange } | null>(null);
  const appliedRefresh = useRef<{ repo: OfflineTechnicianRepository; revision: string } | null>(null);
  const baselinePrepared = useRef<OfflineTechnicianRepository | null>(null);
  const state = useRef({ session, data, range, gatewayUrl, selected, selectedOrder, selectedCreationKind, tab });
  state.current = { session, data, range, gatewayUrl, selected, selectedOrder, selectedCreationKind, tab };
  const renderVersion = sessionVersion.current;
  const renderCreationVersion = creationVersion.current;

  function beginAction(): symbol {
    const action = Symbol();
    actionLock.current = action;
    setBusy(true); setError(null);
    return action;
  }

  function endAction(action: symbol): void {
    if (actionLock.current !== action) return;
    actionLock.current = null;
    setBusy(false);
  }

  const unauthorized = useCallback(() => {
    assignmentRead.current?.controller.abort();
    baselineRead.current?.abort();
    const capturedRepo = repository.current;
    const capturedSession = state.current.session;
    const capturedSetup = sessionSetup.current;
    const stored = capturedSession?.mode === "live" ? { token: capturedSession.token, tenant: capturedSession.tenant, branchId: capturedSession.branchId, gatewayUrl: state.current.gatewayUrl }
      : capturedSetup ? { token: capturedSetup.token, tenant: capturedSetup.tenant, branchId: capturedSetup.preferredBranch, gatewayUrl: capturedSetup.url } : null;
    if (capturedRepo instanceof OfflineTechnicianRepository) {
      capturedRepo.stop();
      void capturedRepo.engine.blockAuth().catch(() => undefined);
    }
    const capturedClient = notificationClient.current;
    if (capturedClient) {
      const { adapter, session: capturedSession } = capturedClient.options;
      const inbox = capturedClient.getSnapshot().inbox;
      const owned = (value: unknown): boolean => {
        const payload = notificationForSession(value, capturedSession);
        return payload !== null && inbox.some((item) => sameNotification(item.data, payload));
      };
      void (async () => {
        const last = await adapter.lastResponse();
        if (last && owned(last.data)) await adapter.clearResponse(last.identifier);
        for (const item of await adapter.presented()) if (owned(item.data)) await adapter.dismiss(item.identifier);
      })().catch(() => undefined);
    }
    const version = ++sessionVersion.current;
    requestVersion.current += 1;
    repository.current = null;
    setOfflineController(null); setOfflineVerifiedAt(null); setOfflineSetupError(null); setLiveVerified(false); setSelectedOffline(false);
    sessionSetup.current = null;
    pendingLogin.current = null;
    const cleanupAction = Symbol();
    actionLock.current = cleanupAction;
    state.current = { ...state.current, session: null, data: null, selected: null, selectedOrder: null, selectedCreationKind: null };
    setSession(null); setData(null); setSelected(null); setSelectedOrder(null); setSelectedCreationKind(null); setSelectedTenant(null); setChallenge(null);
    setAgendaFocusDate(null);
    setForcePassword(false); setFinalizingSession(false); setLoading(false); setRestoring(false); setBusy(true); setHealth(null);
    setError("Tu sesión venció o fue cerrada desde otro dispositivo. Ingresa nuevamente. Los borradores se conservan para el mismo usuario.");
    void (async () => {
      if (capturedRepo instanceof OfflineTechnicianRepository) await capturedRepo.syncNow().catch(() => undefined);
      try { if (stored) await disableOfflineProfile(stored); }
      finally { await removeSession(); }
    })().catch(() => {
      if (version === sessionVersion.current) setError("No se pudo eliminar la sesión local. Cierra la app y vuelve a ingresar.");
    }).finally(() => endAction(cleanupAction));
  }, []);

  function attachUnauthorized(repo: HttpTechnicianRepository, version: number): void {
    repo.onUnauthorized = () => {
      if (version === sessionVersion.current && remoteRepository(repository.current) === repo) unauthorized();
    };
  }

  async function bindOffline(repo: TechnicianRepository, next: Session, url: string, version: number, cached = false) {
    const connectivity = createConnectivity();
    let networkAllowed = !cached;
    const wrapped = await createOfflineRepository(repo, next, {
      gatewayUrl: url, storageKey: tenantStorageNamespace(next, url, next.branchId),
      connectivity: { current: () => networkAllowed ? connectivity.current() : Promise.resolve(false), subscribe: (listener) => connectivity.subscribe((online) => listener(networkAllowed && online)) },
    });
    const onVerified = wrapped.dependencies.onVerified;
    wrapped.dependencies.onVerified = async (user) => {
      if (version !== sessionVersion.current || remoteRepository(repository.current) !== repo) return;
      await onVerified?.(user);
      if (version !== sessionVersion.current || remoteRepository(repository.current) !== repo) return;
      if (next.mode === "live") { setOfflineVerifiedAt(Date.now()); setLiveVerified(true); }
    };
    if (!cached && wrapped.getSnapshot().authBlocked) await establishVerifiedOfflineSession(wrapped);
    return { wrapped, allowNetwork: () => { networkAllowed = true; } };
  }

  async function establish(repo: TechnicianRepository, token: string, mode: Session["mode"], url: string, tenant: Tenant, version: number, preferredBranch?: number | null) {
    const previous = repository.current;
    if (previous instanceof OfflineTechnicianRepository) previous.stop();
    let user = await repo.me();
    if (version !== sessionVersion.current) return;
    let verifiedTenant = repo instanceof HttpTechnicianRepository ? requireSessionTenant(tenant, tenantSchema.parse(repo.tenant)) : tenant;
    if (sessionSetup.current?.repo === repo && sessionSetup.current.version === version) {
      sessionSetup.current.canRequirePasswordChange = false;
      sessionSetup.current.tenant = verifiedTenant;
      sessionSetup.current.verifiedUser = user;
    }
    setSelectedTenant(verifiedTenant);
    const branches = user.accessBranchs.filter((branch) => branch.isEnabled !== false && branch.isDeleted !== true);
    const branchId = branches.find((branch) => branch.id === preferredBranch)?.id ?? branches.find((branch) => branch.main)?.id ?? branches[0]?.id ?? null;
    if (branchId !== null) {
      const scopedUser = await repo.me(branchId);
      if (version !== sessionVersion.current) return;
      if (scopedUser.id !== user.id || scopedUser.workerId !== user.workerId) { unauthorized(); return; }
      if (!scopedUser.accessBranchs.some((branch) => branch.id === branchId && branch.isEnabled !== false && branch.isDeleted !== true)) throw new Error("La sucursal ya no está habilitada para esta cuenta.");
      user = scopedUser;
      verifiedTenant = repo instanceof HttpTechnicianRepository ? requireSessionTenant(tenant, tenantSchema.parse(repo.tenant)) : tenant;
    }
    setSelectedTenant(verifiedTenant);
    if (mode === "live") await persistSession({ token, gatewayUrl: url, branchId, tenant: verifiedTenant });
    if (version !== sessionVersion.current) return;
    const nextSession: Session = { token, user, branchId, mode, tenant: verifiedTenant };
    repository.current = repo;
    let wrapped: OfflineTechnicianRepository | null = null;
    let offlineWarning: string | null = null;
    const verifiedAt = Date.now();
    try {
      if (mode === "live") await saveOfflineProfile(nextSession, url);
      if (version !== sessionVersion.current) return;
      if (branchId !== null && user.workerId !== null) wrapped = (await bindOffline(repo, nextSession, url, version)).wrapped;
    } catch (caught) {
      if (version !== sessionVersion.current) return;
      if (caught instanceof ApiError && caught.status === 401) { unauthorized(); return; }
      if (caught instanceof ApiError && caught.status === 403) throw caught;
      offlineWarning = `Acceso online disponible, pero no se pudo preparar el almacenamiento sin conexión. No cierres la app confiando en una copia local. ${errorText(caught)}`;
    }
    if (version !== sessionVersion.current) { wrapped?.stop(); return; }
    repository.current = wrapped ?? repo;
    setOfflineSetupError(offlineWarning);
    setOfflineController(wrapped); setOfflineVerifiedAt(mode === "live" ? verifiedAt : null); setLiveVerified(mode === "live"); setSelectedOffline(false);
    const nextRange = dailyRange(scheduleClock(user.system.timezone)?.day ?? dateKey());
    state.current = { ...state.current, session: nextSession, data: null, range: nextRange, selected: null, selectedOrder: null, selectedCreationKind: null, tab: "today" };
    requestVersion.current += 1;
    setSession(nextSession); setRange(nextRange);
    setAgendaFocusDate(null);
    sessionSetup.current = null;
    setSelected(null); setSelectedOrder(null); setSelectedCreationKind(null); setData(null); setError(offlineWarning); setForcePassword(false); setFinalizingSession(false); setTab("today"); setLoading(false);
  }

  async function restoreCachedSession(stored: StoredSession, repo: HttpTechnicianRepository, caught: NetworkError, version: number): Promise<boolean> {
    const profile = await restoreOfflineSession(stored, caught);
    if (!profile || version !== sessionVersion.current || stored.branchId === null || profile.user.workerId === null) return false;
    const verified = sessionSetup.current?.verifiedUser;
    if (verified && (verified.id !== profile.user.id || verified.workerId !== profile.user.workerId
      || !verified.accessBranchs.some((branch) => branch.id === stored.branchId && branch.isEnabled !== false && branch.isDeleted !== true))) return false;
    const next: Session = { token: stored.token, tenant: stored.tenant, branchId: stored.branchId, user: profile.user, mode: "live" };
    const { wrapped, allowNetwork } = await bindOffline(repo, next, stored.gatewayUrl, version, true);
    if (version !== sessionVersion.current) { wrapped.stop(); return false; }
    if (wrapped.getSnapshot().authBlocked) { wrapped.stop(); return false; }
    const today = scheduleClock(next.user.system.timezone)?.day ?? dateKey();
    const week = weekRange(today);
    const coverage = new Set(wrapped.getSnapshot().coverage.filter((entry) => entry.branchId === next.branchId).map((entry) => entry.date));
    const nextRange = assignmentDays(week).every((day) => coverage.has(day)) ? week : dailyRange(today);
    let cachedData: Assignments | null = null;
    let warning: string | null = null;
    try { cachedData = await wrapped.assignments(nextRange, stored.branchId); }
    catch (failure) { warning = `No hay una copia disponible para todo este período. Revisa la cobertura en Sin conexión. ${errorText(failure)}`; }
    if (version !== sessionVersion.current) { wrapped.stop(); return false; }
    allowNetwork();
    const nextTab = nextRange.startDate === nextRange.endDate ? "today" : "agenda";
    repository.current = wrapped;
    sessionSetup.current = null;
    manualRefresh.current = { session: next, range: nextRange };
    state.current = { ...state.current, session: next, data: cachedData, range: nextRange, selected: null, selectedOrder: null, selectedCreationKind: null, tab: nextTab };
    setSession(next); setSelectedTenant(next.tenant); setData(cachedData); setRange(nextRange); setTab(nextTab); setAgendaFocusDate(today);
    setSelected(null); setSelectedOrder(null); setSelectedCreationKind(null); setSelectedOffline(false);
    setOfflineController(wrapped); setOfflineVerifiedAt(profile.verifiedAt); setLiveVerified(false);
    setForcePassword(false); setFinalizingSession(false); setError(warning); setLoading(false);
    return true;
  }

  async function finishSessionSetup() {
    const pending = sessionSetup.current;
    if (!pending || pending.version !== sessionVersion.current) return;
    await persistSession({ token: pending.token, gatewayUrl: pending.url, branchId: pending.preferredBranch, tenant: pending.tenant });
    if (pending.version !== sessionVersion.current) return;
    await saveGateway(pending.url);
    if (pending.version !== sessionVersion.current) return;
    try {
      await establish(pending.repo, pending.token, "live", pending.url, pending.tenant, pending.version, pending.preferredBranch);
    } catch (caught) {
      if (pending.version !== sessionVersion.current) return;
      if (pending.canRequirePasswordChange && caught instanceof ApiError && caught.code === "PASSWORD_CHANGE_REQUIRED") {
        sessionSetup.current = null;
        setFinalizingSession(false); setForcePassword(true); setError(null);
        return;
      }
      throw caught;
    }
  }

  async function retrySessionSetup() {
    if (!isAccessAllowed() || renderVersion !== sessionVersion.current || actionLock.current || !sessionSetup.current) return;
    const version = sessionVersion.current;
    const action = beginAction();
    try { await finishSessionSetup(); }
    catch (caught) { if (version === sessionVersion.current) setError(errorText(caught)); }
    finally { endAction(action); }
  }

  useEffect(() => {
    let active = true;
    const version = ++sessionVersion.current;
    const action = beginAction();
    void (async () => {
      try {
        if (gatewayConfiguration.error) throw new Error(gatewayConfiguration.error);
        const savedUrl = gatewayConfiguration.locked ? null : await loadGateway();
        const stored = await loadSession();
        if (!active || version !== sessionVersion.current) return;
        if (stored) {
          const mismatch = storedGatewayMismatch(gatewayConfiguration, stored.gatewayUrl);
          if (mismatch) { gatewayBlock.current = mismatch; throw new Error(mismatch); }
        }
        const url = requireConfiguredGateway(gatewayConfiguration, gatewayConfiguration.locked ? defaultGateway() : stored?.gatewayUrl ?? savedUrl ?? defaultGateway());
        state.current = { ...state.current, gatewayUrl: url };
        setGatewayUrl(url);
        if (!stored) return;
        const repo = new HttpTechnicianRepository(url, stored.tenant);
        repo.token = stored.token;
        attachUnauthorized(repo, version);
        repository.current = repo;
        sessionSetup.current = { repo, token: stored.token, url, tenant: stored.tenant, version, preferredBranch: stored.branchId, canRequirePasswordChange: true };
        setSelectedTenant(stored.tenant); setFinalizingSession(true);
        try { await finishSessionSetup(); }
        catch (caught) {
          if (!active || version !== sessionVersion.current) return;
          if (caught instanceof NetworkError && await restoreCachedSession(stored, repo, caught, version)) return;
          throw caught;
        }
      } catch (caught) {
        if (active && version === sessionVersion.current) {
          if (gatewayConfiguration.locked && !repository.current) gatewayBlock.current = errorText(caught);
          setError(errorText(caught));
        }
      }
      finally {
        if (active) {
          if (version === sessionVersion.current) setRestoring(false);
          endAction(action);
        }
      }
    })();
    return () => {
      active = false;
      assignmentRead.current?.controller.abort();
      baselineRead.current?.abort();
      sessionVersion.current += 1; requestVersion.current += 1;
      if (repository.current instanceof OfflineTechnicianRepository) repository.current.stop();
      repository.current = null; sessionSetup.current = null; pendingLogin.current = null; actionLock.current = null;
    };
  }, [unauthorized]);

  useEffect(() => {
    if (!offlineController || repository.current !== offlineController || !session) return;
    offlineController.setForeground(readForeground() && isAccessAllowed());
    offlineController.start();
    return () => offlineController.stop();
  }, [offlineController, session, isAccessAllowed]);

  useEffect(() => {
    if (!offlineController || repository.current !== offlineController || !session) return;
    const detachForeground = bindForeground({ setForeground: (active) => offlineController.setForeground(active && isAccessAllowed()) });
    return detachForeground;
  }, [offlineController, session, accessAllowed, isAccessAllowed]);

  useEffect(() => {
    if (accessAllowed) return;
    assignmentRead.current?.controller.abort();
    baselineRead.current?.abort();
  }, [accessAllowed]);

  useEffect(() => {
    if (offline?.authBlocked && repository.current === offlineController) unauthorized();
  }, [offline?.authBlocked, offlineController, unauthorized]);

  const refreshAssignments = useCallback(async (background = false, reportError = true): Promise<void> => {
    const { session: current, range: currentRange } = state.current;
    const repo = repository.current;
    if (!isAccessAllowed() || !current || current.branchId === null || !repo) return;
    const key = `${current.branchId}:${currentRange.startDate}:${currentRange.endDate}`;
    const existing = assignmentRead.current;
    if (existing && existing.key === key && existing.repo === repo && existing.version === requestVersion.current
      && existing.generation === sessionVersion.current && !existing.controller.signal.aborted) return existing.pending;
    existing?.controller.abort();
    baselineRead.current?.abort();
    const version = ++requestVersion.current;
    const generation = sessionVersion.current;
    const controller = new AbortController();
    const branchId = current.branchId;
    setLoading(!background);
    const pending = Promise.resolve().then(async () => {
    try {
      const next = normalizeAssignmentsChecklistProgress(await repo.assignments(currentRange, branchId, { signal: controller.signal }));
      if (controller.signal.aborted || version !== requestVersion.current || generation !== sessionVersion.current || repository.current !== repo) return;
      if (next.technician.id !== current.user.workerId) { unauthorized(); throw new Error("La identidad del trabajador cambió. Vuelve a ingresar; la cola se conserva."); }
      let nextWork = state.current.selected;
      let nextOrder = state.current.selectedOrder;
      if (repo instanceof OfflineTechnicianRepository) {
        for (const operation of repo.getSnapshot().operations) {
          if (operation.kind !== "create" || operation.status !== "applied" || !operation.result) continue;
          const result = operation.result;
          const confirmedGroup = next.groups.find((group) => group.id === result.groupId);
          if (!confirmedGroup?.works.some((work) => work.id === String(result.workId))) continue;
          if (nextWork?.groupId === operation.localGroupId && nextWork.workId === operation.localWorkId) {
            nextWork = { ...nextWork, groupId: result.groupId, workId: String(result.workId), draftGroupId: operation.localGroupId, draftWorkId: operation.localWorkId };
          }
          if (nextOrder?.id === operation.localGroupId) nextOrder = { ...nextOrder, id: result.groupId, draftGroupId: operation.localGroupId };
        }
      }
      state.current = { ...state.current, data: next, selected: nextWork, selectedOrder: nextOrder };
      setSelected(nextWork); setSelectedOrder(nextOrder);
      setData(next); setError(null);
    } catch (caught) {
      if (version !== requestVersion.current || generation !== sessionVersion.current) return;
      if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
      if (reportError) setError(errorText(caught));
      throw caught;
    } finally {
      if (assignmentRead.current?.controller === controller) assignmentRead.current = null;
      if (version === requestVersion.current) setLoading(false);
    }
    });
    assignmentRead.current = { key, version, generation, repo, controller, pending };
    return pending;
  }, [unauthorized, isAccessAllowed]);

  function notificationContextIsCurrent(context: NotificationOpenContext): boolean {
    const current = state.current.session;
    return isAccessAllowed() && context.isCurrent() && current !== null && current === context.session && sameNotificationSession(current, context.session)
      && context.storageKey === tenantStorageNamespace(current, state.current.gatewayUrl, current.branchId);
  }

  async function openNotification(payload: NotificationData, context: NotificationOpenContext): Promise<boolean> {
    const current = state.current.session;
    const repo = repository.current;
    if (!notificationContextIsCurrent(context) || !current || !repo || !notificationForSession(payload, current) || actionLock.current) return false;
    if (state.current.selectedCreationKind || state.current.selected || state.current.selectedOrder) {
      setError("Vuelve al listado antes de abrir la notificación. Se conservará tu selección y cualquier borrador.");
      return false;
    }
    if (state.current.tab === "profile") {
      setError("Vuelve a la bandeja de avisos para abrir la notificación. Se conservan los cambios de configuración sin guardar.");
      return false;
    }
    if (payload.kind === "MOBILE_PUSH_TEST") {
      state.current = { ...state.current, tab: "notifications" };
      setTab("notifications"); setError(null);
      return true;
    }
    const version = sessionVersion.current;
    const action = beginAction();
    requestVersion.current += 1;
    setLoading(false);
    try {
      const day = payload.date ?? scheduleClock(current.user.system.timezone)?.day;
      if (!day || current.branchId === null) throw new Error("La sucursal no tiene una fecha o zona horaria válida para abrir el aviso.");
      const nextRange = dailyRange(day);
      const fresh = normalizeAssignmentsChecklistProgress(await repo.assignments(nextRange, current.branchId));
      if (version !== sessionVersion.current || repository.current !== repo || !notificationContextIsCurrent(context)) return false;
      if (fresh.technician.id !== current.user.workerId) throw new Error("La identidad del trabajador cambió. Vuelve a ingresar.");
      const group = fresh.groups.find((item) => payload.groupType === "maintenance"
        ? item.type === "internal_maintenance" && item.id === `maintenance-${payload.groupId}`
        : payload.groupType === "negotiation"
          ? item.type === "external_ot" && item.id === `external-${payload.groupId}`
          : payload.groupType === "work" && item.type === "direct_assignment" && (item.id === `direct-${payload.groupId}` || item.id === `direct-np-${payload.groupId}`));
      if (!group) throw new Error("La orden ya no está disponible para este trabajador en la fecha del aviso.");
      let nextWork: SelectedWork | null = null;
      if (payload.workId !== null) {
        const work = group.works.find((item) => item.id === String(payload.workId) && (payload.groupType !== "work"
          || (group.id === `direct-${item.id}` && item.workType === "productive")
          || (group.id === `direct-np-${item.id}` && item.workType === "non_productive")));
        const snapshots = work?.schedules?.filter((item) => item.queryDates.includes(day));
        const snapshot = snapshots?.find((item) => assignmentDay(item.work.scheduledDate) === day) ?? snapshots?.[0];
        if (!work || (work.schedules && !snapshot)) throw new Error("La orden o el trabajo ya no está disponible en la fecha del aviso.");
        nextWork = { groupId: group.id, workId: work.id, queryDate: day, scheduledDate: assignmentDay(snapshot?.work.scheduledDate ?? work.scheduledDate), initialTab: "work" };
      } else if (payload.groupType !== "negotiation" && payload.groupType !== "maintenance") {
        throw new Error("La notificación no identifica un trabajo disponible.");
      }
      const nextOrder: SelectedOrder = { id: group.id, queryDate: day, initialTab: "works" };
      manualRefresh.current = { session: current, range: nextRange };
      state.current = { ...state.current, data: fresh, range: nextRange, selected: nextWork, selectedOrder: nextOrder, tab: "today" };
      setData(fresh); setRange(nextRange); setSelected(nextWork); setSelectedOrder(nextOrder); setTab("today"); setError(null);
      setAgendaFocusDate(day);
      return true;
    } catch (caught) {
      if (version === sessionVersion.current && notificationContextIsCurrent(context)) setError(errorText(caught));
      return false;
    } finally { endAction(action); }
  }

  async function refreshFromNotification(context: NotificationOpenContext): Promise<void> {
    const live = state.current;
    if (!notificationContextIsCurrent(context) || actionLock.current || live.selectedCreationKind || live.selected || live.selectedOrder || (live.tab !== "today" && live.tab !== "agenda")) return;
    const action = beginAction();
    try { await refreshAssignments().catch(() => undefined); }
    finally { endAction(action); }
  }

  const notificationHandlers = useRef({ openNotification, refreshFromNotification });
  notificationHandlers.current = { openNotification, refreshFromNotification };
  const notificationRepo = remoteRepository(repository.current);
  const notificationApi = useMemo(() => session && notificationRepo ? bindNotificationApi(session, notificationRepo) : null, [session, notificationRepo]);
  const notifications: Readonly<ReturnType<typeof useMobileNotifications>> = useMobileNotifications({
    session, storageKey: session ? tenantStorageNamespace(session, gatewayUrl, session.branchId) : "anonymous", api: notificationApi,
    enabled: liveVerified && !offline?.authBlocked,
    isInteractionAllowed: isAccessAllowed,
    onOpen: (payload, context) => notificationHandlers.current.openNotification(payload, context),
    onForegroundRefresh: (context) => notificationHandlers.current.refreshFromNotification(context),
  });
  notificationClient.current = notifications.client;

  useEffect(() => {
    if (!accessAllowed || !session || session.branchId === null) return;
    if (manualRefresh.current?.session === session && manualRefresh.current.range === range) {
      manualRefresh.current = null;
      return;
    }
    void refreshAssignments().catch(() => undefined);
  }, [session, range, refreshAssignments, accessAllowed]);

  const appliedRevision = offline?.operations.filter((operation) => operation.status === "applied").map((operation) => operation.id).sort().join("|") ?? "";
  useEffect(() => {
    if (!accessAllowed || !offlineController || repository.current !== offlineController || !session || offline?.authBlocked) return;
    if (appliedRefresh.current?.repo !== offlineController) {
      appliedRefresh.current = { repo: offlineController, revision: appliedRevision };
      return;
    }
    if (busy || actionLock.current || selectedCreationKind || offline?.syncing || appliedRefresh.current.revision === appliedRevision) return;
    appliedRefresh.current = { repo: offlineController, revision: appliedRevision };
    void refreshAssignments(true).catch(() => undefined);
  }, [offlineController, session, appliedRevision, offline?.syncing, offline?.authBlocked, busy, selectedCreationKind, refreshAssignments, accessAllowed]);

  useEffect(() => {
    if (!accessAllowed || loading || assignmentRead.current || !offlineController || !session?.branchId || !offline?.online || offline.authBlocked || busy || actionLock.current || selected || selectedOrder || selectedCreationKind || baselinePrepared.current === offlineController) return;
    baselinePrepared.current = offlineController;
    const controller = new AbortController();
    baselineRead.current = controller;
    const version = sessionVersion.current;
    const branchId = session.branchId;
    void (async () => {
      const day = scheduleClock(session.user.system.timezone)?.day ?? dateKey();
      await offlineController.assignments(weekRange(day), branchId, { signal: controller.signal });
      if (controller.signal.aborted || version !== sessionVersion.current || repository.current !== offlineController) return;
      await offlineController.creationOptions({ companyBranchId: branchId, search: "", page: 0 });
    })().catch((caught: unknown) => {
      if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
      if (version === sessionVersion.current && repository.current === offlineController) setOfflineSetupError(`La semana no quedó preparada completamente. Reintenta desde Sin conexión. ${errorText(caught)}`);
    }).finally(() => { if (baselineRead.current === controller) baselineRead.current = null; });
    return () => controller.abort();
  }, [offlineController, session, offline?.online, offline?.authBlocked, busy, selected, selectedOrder, selectedCreationKind, accessAllowed, loading]);

  async function refresh(): Promise<void> {
    if (!currentContext() || actionLock.current || selectedCreationKind) return;
    await refreshAssignments();
  }

  function openOffline(): void {
    if (!currentContext() || actionLock.current) return;
    setSelectedOffline(true);
  }

  function closeOffline(): void {
    if (!isAccessAllowed() || actionLock.current) return;
    setSelectedOffline(false);
  }

  async function syncOffline(): Promise<void> {
    const repo = repository.current;
    if (!currentContext() || actionLock.current || !(repo instanceof OfflineTechnicianRepository)) throw new Error("La sincronización no está disponible en este momento.");
    const version = sessionVersion.current;
    const appliedBefore = new Set(repo.getSnapshot().operations.filter((operation) => operation.status === "applied").map((operation) => operation.id));
    const action = Symbol();
    actionLock.current = action;
    setBusy(true);
    let refreshConfirmed = false;
    try {
      await (repo.requestSync ? repo.requestSync() : repo.syncNow());
      if (version !== sessionVersion.current || repository.current !== repo) return;
      const snapshot = repo.getSnapshot();
      if (snapshot.authBlocked || snapshot.connection?.status === "auth_required") {
        unauthorized();
        throw new Error("Vuelve a ingresar con la misma cuenta para continuar. La cola se conserva.");
      }
      refreshConfirmed = snapshot.operations.some((operation) => operation.status === "applied" && !appliedBefore.has(operation.id));
    } catch (caught) {
      if (version === sessionVersion.current && repository.current === repo) {
        const snapshot = repo.getSnapshot();
        if (snapshot.authBlocked || snapshot.connection?.status === "auth_required" || caught instanceof ApiError && caught.status === 401) unauthorized();
        else refreshConfirmed = snapshot.operations.some((operation) => operation.status === "applied" && !appliedBefore.has(operation.id));
      }
      throw caught;
    } finally {
      endAction(action);
      if (refreshConfirmed && version === sessionVersion.current && repository.current === repo && isAccessAllowed()) {
        void refreshAssignments(true, false).catch(() => undefined);
      }
    }
  }

  async function prepareOfflineWeek(): Promise<void> {
    const repo = repository.current;
    const current = state.current.session;
    if (!currentContext() || actionLock.current || selectedCreationKind || !(repo instanceof OfflineTechnicianRepository) || !current?.branchId) throw new Error("Vuelve al listado para preparar la semana sin conexión.");
    if (!repo.getSnapshot().online || repo.getSnapshot().authBlocked) throw new Error("Conéctate a Qualitzer para preparar una copia actualizada de la semana.");
    const version = sessionVersion.current;
    const action = beginAction();
    try {
      await repo.creationOptions({ companyBranchId: current.branchId, search: "", page: 0 });
      if (version !== sessionVersion.current || repository.current !== repo) return;
      await repo.prepareWeek(weekRange(state.current.range.startDate), current.branchId);
      if (version !== sessionVersion.current || repository.current !== repo) return;
      if (!repo.getSnapshot().online) throw new Error("La conexión se interrumpió. Revisa la cobertura; no se garantiza una copia actualizada de toda la semana.");
      setOfflineSetupError(null);
      await refreshAssignments();
    } catch (caught) {
      if (version === sessionVersion.current && repository.current === repo) setError(errorText(caught));
      throw caught;
    } finally { endAction(action); }
  }

  async function retryOffline(operationId: string): Promise<void> {
    const repo = repository.current;
    if (!currentContext() || actionLock.current || !(repo instanceof OfflineTechnicianRepository)) throw new Error("Espera a que termine la operación actual.");
    const version = sessionVersion.current;
    const action = beginAction();
    try {
      await repo.retry(operationId);
      if (version !== sessionVersion.current || repository.current !== repo) return;
      await refreshAssignments();
    } catch (caught) {
      if (version === sessionVersion.current && repository.current === repo) setError(errorText(caught));
      throw caught;
    } finally { endAction(action); }
  }

  async function acceptLogin(repo: HttpTechnicianRepository, result: LoginResult, url: string, version: number, expectedTenant?: Tenant): Promise<void> {
    if (version !== sessionVersion.current) return;
    const authenticatedTenant = tenantSchema.parse(result.tenant);
    if (expectedTenant) requireSessionTenant(expectedTenant, authenticatedTenant);
    repo.tenant = authenticatedTenant;
    repo.token = result.token;
    attachUnauthorized(repo, version);
    repository.current = repo;
    pendingLogin.current = null;
    setChallenge(null); setSelectedTenant(authenticatedTenant); setHealth(null);
    if (result.nextStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      sessionSetup.current = null;
      setForcePassword(true); setFinalizingSession(false);
      await persistSession({ token: result.token, gatewayUrl: url, branchId: null, tenant: authenticatedTenant });
      if (version === sessionVersion.current) await saveGateway(url);
      return;
    }
    sessionSetup.current = { repo, token: result.token, url, tenant: authenticatedTenant, version, preferredBranch: null, canRequirePasswordChange: false };
    setForcePassword(false); setFinalizingSession(true);
    await finishSessionSetup();
  }

  async function login(username: string, password: string) {
    if (!isAccessAllowed() || renderVersion !== sessionVersion.current || actionLock.current || restoring || state.current.session || repository.current || pendingLogin.current) return;
    const version = ++sessionVersion.current;
    const action = beginAction();
    const loginGateway = state.current.gatewayUrl;
    try {
      if (gatewayBlock.current) throw new Error(gatewayBlock.current);
      const pendingLoginGateway = requireConfiguredGateway(gatewayConfiguration, loginGateway);
      const repo = new HttpTechnicianRepository(pendingLoginGateway);
      const result = await repo.startLogin(username, password);
      if (version !== sessionVersion.current) return;
      if (result.nextStep === "SELECT_TENANT") {
        pendingLogin.current = { repo, pendingLoginGateway, challenge: result, version };
        setChallenge(result);
        return;
      }
      await acceptLogin(repo, result, pendingLoginGateway, version);
    } catch (caught) { if (version === sessionVersion.current) setError(loginConnectionError(caught, loginGateway)); }
    finally { endAction(action); }
  }

  function clearLoginChallenge(message: string | null): void {
    sessionVersion.current += 1; requestVersion.current += 1;
    pendingLogin.current = null;
    setChallenge(null); setSelectedTenant(null); setHealth(null); setError(message);
  }

  async function selectTenant(tenant: Tenant): Promise<void> {
    const pending = pendingLogin.current;
    if (!isAccessAllowed() || actionLock.current || !pending || pending.challenge !== challenge || pending.version !== sessionVersion.current || repository.current || state.current.session) return;
    const version = pending.version;
    const action = beginAction();
    try {
      const candidate = pending.challenge.tenants.find((item) => sameTenant(item, tenant));
      if (!candidate) throw new Error("La empresa no pertenece a esta selección. Vuelve a ingresar tus credenciales.");
      const timing = getTenantChallengeRemaining(pending.challenge);
      if (timing.remainingMs === 0) throw new Error(timing.source === "invalid"
        ? "No se pudo validar el tiempo de esta selección. Vuelve a ingresar tus credenciales."
        : timing.source === "unverified" ? "Se agotó el tiempo local para seleccionar la empresa. Vuelve a ingresar tus credenciales."
          : "La selección de empresa venció. Vuelve a ingresar tus credenciales.");
      const result = await pending.repo.completeLogin(pending.challenge.challenge, candidate);
      if (version !== sessionVersion.current || pendingLogin.current !== pending) return;
      await acceptLogin(pending.repo, result, pending.pendingLoginGateway, version, candidate);
    } catch (caught) {
      if (version !== sessionVersion.current) return;
      if (pendingLogin.current === pending) clearLoginChallenge(`${errorText(caught)} Vuelve al acceso con tu usuario y contraseña; esta selección no se reutilizará.`);
      else setError(errorText(caught));
    } finally { endAction(action); }
  }

  function cancelLoginChallenge(): void {
    if (!isAccessAllowed() || actionLock.current || !pendingLogin.current || pendingLogin.current.challenge !== challenge || renderVersion !== sessionVersion.current) return;
    clearLoginChallenge(null);
  }

  async function changePassword(password: string, confirmation: string) {
    const repo = remoteRepository(repository.current);
    if (!isAccessAllowed() || renderVersion !== sessionVersion.current || actionLock.current || !forcePassword || !(repo instanceof HttpTechnicianRepository) || !selectedTenant) return;
    const tenant = selectedTenant;
    const version = sessionVersion.current;
    const action = beginAction();
    try {
      const result = await repo.forcePassword(password, confirmation);
      if (version !== sessionVersion.current) return;
      await acceptLogin(repo, result, repo.baseUrl, version, tenant);
    } catch (caught) { if (version === sessionVersion.current) setError(errorText(caught)); }
    finally { endAction(action); }
  }

  async function demo() {
    if (!isAccessAllowed() || renderVersion !== sessionVersion.current || actionLock.current || restoring || state.current.session || repository.current || pendingLogin.current) return;
    const version = ++sessionVersion.current;
    const action = beginAction();
    try {
      if (gatewayBlock.current) throw new Error(gatewayBlock.current);
      const url = requireConfiguredGateway(gatewayConfiguration, state.current.gatewayUrl);
      if (version !== sessionVersion.current) return;
      await establish(new DemoTechnicianRepository(), "demo", "demo", url, DEMO_TENANT, version);
    }
    catch (caught) { if (version === sessionVersion.current) setError(errorText(caught)); }
    finally { endAction(action); }
  }

  async function branch(branchId: number) {
    const repo = repository.current;
    if (!currentContext() || actionLock.current || selected || selectedOrder || selectedCreationKind || !session || !repo || branchId === session.branchId) return;
    if (!session.user.accessBranchs.some((item) => item.id === branchId && item.isEnabled !== false && item.isDeleted !== true)) return;
    const version = sessionVersion.current;
    assignmentRead.current?.controller.abort();
    baselineRead.current?.abort();
    const current = session;
    const url = state.current.gatewayUrl;
    const action = beginAction();
    let replacement: OfflineTechnicianRepository | null = null;
    try {
      if (repo instanceof OfflineTechnicianRepository) {
        if (!repo.getSnapshot().online || repo.getSnapshot().authBlocked) throw new Error("Necesitas conexión y una sesión vigente para cambiar de sucursal.");
        repo.stop();
        await repo.syncNow();
        await repo.engine.refresh();
        if (repo.getSnapshot().pending > 0) throw new Error("Hay cambios sin confirmar en la sucursal actual. Sincroniza o revisa su cola antes de cambiar; no se borrará ningún pendiente.");
      } else if (current.user.workerId !== null && offlineSetupError) {
        throw new Error("No se pudo comprobar la cola de la sucursal actual. Recupera el almacenamiento offline antes de cambiar de sucursal.");
      }
      if (version !== sessionVersion.current) return;
      const remote = remoteRepository(repo);
      if (!remote) return;
      const user = await remote.me(branchId);
      if (version !== sessionVersion.current) return;
      if (user.id !== current.user.id || user.workerId !== current.user.workerId) { unauthorized(); return; }
      if (!user.accessBranchs.some((item) => item.id === branchId && item.isEnabled !== false && item.isDeleted !== true)) throw new Error("La sucursal ya no está habilitada para esta cuenta.");
      const tenant = remote instanceof HttpTechnicianRepository ? requireSessionTenant(current.tenant, tenantSchema.parse(remote.tenant)) : current.tenant;
      const next: Session = { ...current, user, branchId, tenant };
      if (current.mode === "live") await saveOfflineProfile(next, url);
      if (version !== sessionVersion.current) return;
      if (user.workerId !== null) replacement = (await bindOffline(remote, next, url, version)).wrapped;
      try { await notifications.revokeForSession(); }
      catch { throw new Error("No se pudo revocar el registro de notificaciones. Se mantiene la sucursal actual; reintenta el cambio antes de continuar."); }
      if (version !== sessionVersion.current || repository.current !== repo || state.current.session !== current) return;
      if (current.mode === "live") await persistSession({ token: current.token, gatewayUrl: url, branchId, tenant });
      if (version !== sessionVersion.current) return;
      requestVersion.current += 1;
      repository.current = replacement ?? remote;
      setOfflineController(replacement); setOfflineVerifiedAt(current.mode === "live" ? Date.now() : null); setLiveVerified(current.mode === "live"); setOfflineSetupError(null); setSelectedOffline(false);
      state.current = { ...state.current, session: next, data: null, selected: null, selectedOrder: null, selectedCreationKind: null };
      setData(null); setSelected(null); setSelectedOrder(null); setSelectedCreationKind(null); setSession(next); setSelectedTenant(tenant); setError(null); setLoading(false);
      setAgendaFocusDate(null);
    } catch (caught) { if (version === sessionVersion.current) setError(errorText(caught)); }
    finally {
      if (repository.current !== replacement) replacement?.stop();
      if (version === sessionVersion.current && repository.current === repo && repo instanceof OfflineTechnicianRepository) {
        repo.setForeground(readForeground() && isAccessAllowed()); repo.start();
      }
      endAction(action);
    }
  }

  async function logout() {
    if (!isAccessAllowed()) return;
    if (gatewayBlock.current) { setError(gatewayBlock.current); return; }
    if (renderVersion !== sessionVersion.current || session !== state.current.session || (session && !currentContext()) || actionLock.current || logoutInProgress.current) return;
    if (pendingLogin.current && !repository.current) { cancelLoginChallenge(); return; }
    logoutInProgress.current = true;
    assignmentRead.current?.controller.abort();
    baselineRead.current?.abort();
    const current = state.current.session;
    const url = state.current.gatewayUrl;
    const repo = repository.current;
    const expectedVersion = sessionVersion.current;
    const action = beginAction();
    try {
      if (await pendingOfflineChanges(repo)) throw new Error("No se cerró la sesión: hay cambios sin confirmar en este dispositivo, posiblemente en otra sucursal o cuenta. Sincroniza o revisa la cola. Se conservan tu sesión, archivos y borradores.");
      if (repo instanceof OfflineTechnicianRepository) { repo.stop(); await repo.syncNow(); }
      if (await pendingOfflineChanges(repo)) throw new Error("Hay cambios pendientes. La sesión y la cola se conservan; revisa Sin conexión antes de salir.");
      if (expectedVersion !== sessionVersion.current || repository.current !== repo) { logoutInProgress.current = false; endAction(action); return; }
      const remote = remoteRepository(repo);
      const tenant = current?.tenant ?? sessionSetup.current?.tenant ?? selectedTenant;
      const token = current?.token ?? (remote instanceof HttpTechnicianRepository ? remote.token : null);
      if (tenant && token && current?.mode !== "demo") await disableOfflineProfile({ token, tenant, gatewayUrl: url, branchId: current?.branchId ?? null });
    } catch (caught) {
      if (repository.current === repo) {
        if (repo instanceof OfflineTechnicianRepository) { repo.setForeground(readForeground() && isAccessAllowed()); repo.start(); }
        setError(errorText(caught));
      }
      logoutInProgress.current = false; endAction(action); return;
    }
    const raw = remoteRepository(repo);
    if (expectedVersion !== sessionVersion.current || repository.current !== repo) { logoutInProgress.current = false; endAction(action); return; }
    if (raw instanceof HttpTechnicianRepository) raw.onUnauthorized = null;
    let notificationWarning: string | null = null;
    try { await notifications.revokeForSession(); }
    catch { notificationWarning = "No se pudo confirmar la revocación de las notificaciones del dispositivo."; }
    const version = ++sessionVersion.current;
    requestVersion.current += 1;
    repository.current = null; sessionSetup.current = null; pendingLogin.current = null;
    setOfflineController(null); setOfflineVerifiedAt(null); setOfflineSetupError(null); setLiveVerified(false); setSelectedOffline(false);
    state.current = { ...state.current, session: null, data: null, selected: null, selectedOrder: null, selectedCreationKind: null };
    setSelected(null); setSelectedOrder(null); setSelectedCreationKind(null); setData(null); setSession(null); setChallenge(null); setForcePassword(false); setFinalizingSession(false); setLoading(false); setRestoring(false); setSelectedTenant(null); setHealth(null);
    setAgendaFocusDate(null);
    try {
      const branchIds = current ? [...new Set([current.branchId, ...current.user.accessBranchs.map((item) => item.id)])] : [];
      const [remote, ...cleanups] = await Promise.allSettled([
        Promise.resolve().then(() => raw?.logout()),
        removeSession(),
        ...branchIds.map((id) => current ? clearSessionDrafts(tenantStorageNamespace(current, url, id)) : Promise.resolve()),
      ]);
      if (version !== sessionVersion.current) return;
      let warning = remote.status === "rejected" ? "Se cerró la sesión local, pero no se pudo confirmar el cierre remoto. La sesión del servidor seguirá su política de expiración y revocación." : null;
      if (cleanups.some((item) => item.status === "rejected")) warning = "Sesión cerrada. No se pudo eliminar toda la información local; vuelve a abrir la app y revisa el almacenamiento del dispositivo.";
      setError([notificationWarning, warning].filter(Boolean).join(" ") || null);
    } catch (caught) { if (version === sessionVersion.current) setError(`No se pudo terminar la limpieza local: ${errorText(caught)}`); }
    finally { logoutInProgress.current = false; endAction(action); }
  }

  function currentContext(requireUnlocked = true): boolean {
    return (!requireUnlocked || isAccessAllowed()) && renderVersion === sessionVersion.current && renderCreationVersion === creationVersion.current && session !== null && session === state.current.session && range === state.current.range && selected === state.current.selected && selectedOrder === state.current.selectedOrder && selectedCreationKind === state.current.selectedCreationKind && tab === state.current.tab;
  }

  function openCreate(kind: CreationKind): void {
    if (!currentContext() || actionLock.current || selected || selectedOrder || selectedCreationKind || (tab !== "today" && tab !== "agenda")) return;
    if (!session?.branchId || !session.user.workerId || !session.user.accessBranchs.some((item) => item.id === session.branchId && item.isEnabled !== false && item.isDeleted !== true)) {
      setError("Para crear necesitas un trabajador y una sucursal habilitada en tu sesión.");
      return;
    }
    const next = creationKindSchema.parse(kind);
    creationVersion.current += 1;
    state.current = { ...state.current, selectedCreationKind: next };
    setSelectedCreationKind(next); setError(null);
  }

  function closeCreate(): void {
    if (!currentContext() || actionLock.current || !selectedCreationKind) return;
    creationVersion.current += 1;
    state.current = { ...state.current, selectedCreationKind: null };
    setSelectedCreationKind(null); setError(null);
  }

  function creationContext(companyBranchId: number, requireUnlocked = true): { current: Session; repo: TechnicianRepository } {
    const current = state.current.session;
    const repo = repository.current;
    if (!currentContext(requireUnlocked) || !selectedCreationKind || selected || selectedOrder || !current || !repo || !current.user.workerId
      || companyBranchId !== current.branchId || !current.user.accessBranchs.some((item) => item.id === companyBranchId && item.isEnabled !== false && item.isDeleted !== true)) {
      throw new Error("La sesión o la creación cambió. Vuelve a abrir el formulario en la sucursal correcta.");
    }
    return { current, repo };
  }

  async function creationOptions(query: CreationOptionsQuery): Promise<CreationOptions> {
    const input = creationOptionsQuerySchema.parse(query);
    const { current, repo } = creationContext(input.companyBranchId);
    if (actionLock.current) throw new Error("Hay una operación en curso. Espera a que termine.");
    const version = sessionVersion.current;
    const result = creationOptionsSchema.parse(await repo.creationOptions(input));
    if (version !== sessionVersion.current || repository.current !== repo || !currentContext()) throw new Error("La sesión o el formulario cambió durante la consulta.");
    if (result.companyBranchId !== current.branchId || result.userId !== current.user.id || result.workerId !== current.user.workerId || !scheduleClock(result.timezone)) {
      throw new Error("Las opciones no corresponden al trabajador o la sucursal de esta sesión.");
    }
    return result;
  }

  async function createRecord(input: CreationInput): Promise<CreationResult> {
    const value = creationInputSchema.parse(input);
    const { current, repo } = creationContext(value.companyBranchId);
    if (value.kind !== selectedCreationKind) throw new Error("El tipo de creación no corresponde al formulario abierto.");
    if (actionLock.current) throw new Error("Hay una operación en curso. Espera a que termine.");
    const version = sessionVersion.current;
    const action = beginAction();
    try {
      const result = creationResultSchema.parse(await repo.createRecord(value));
      if (version !== sessionVersion.current || repository.current !== repo || !currentContext(false)) throw new Error("La sesión cambió. Conserva la misma solicitud y verifica su confirmación antes de crear otra.");
      if (result.kind !== value.kind || result.companyBranchId !== current.branchId || result.schedule.date !== value.schedule.date
        || result.schedule.startTime !== value.schedule.startTime || result.schedule.endTime !== value.schedule.endTime) throw new Error("La respuesta no corresponde a la solicitud enviada. Reintenta con el mismo identificador.");
      return result;
    } finally { endAction(action); }
  }

  async function onCreated(value: CreationResult): Promise<void> {
    const result = creationResultSchema.parse(value);
    const { current, repo } = creationContext(result.companyBranchId, false);
    if (result.kind !== selectedCreationKind || actionLock.current) return;
    const version = sessionVersion.current;
    const action = beginAction();
    const nextTab = state.current.tab === "agenda" ? "agenda" : "today";
    const nextRange = nextTab === "agenda" ? weekRange(result.schedule.date) : dailyRange(result.schedule.date);
    creationVersion.current += 1;
    requestVersion.current += 1;
    manualRefresh.current = { session: current, range: nextRange };
    state.current = { ...state.current, selectedCreationKind: null, selected: null, selectedOrder: null, data: null, range: nextRange, tab: nextTab };
    setSelectedCreationKind(null); setSelected(null); setSelectedOrder(null); setData(null); setRange(nextRange); setTab(nextTab);
    setAgendaFocusDate(result.schedule.date);
    try { await refreshAssignments(); }
    catch (caught) {
      if (version === sessionVersion.current && repository.current === repo) setError(`La creación está confirmada. No repitas el envío; no se pudo actualizar la agenda. ${errorText(caught)}`);
    } finally { endAction(action); }
  }

  async function onOfflineQueuedCreate(outcome: OfflineQueuedOutcome): Promise<void> {
    const repo = repository.current;
    const current = state.current.session;
    if (!currentContext() || actionLock.current || !selectedCreationKind || !current || current.branchId === null || !(repo instanceof OfflineTechnicianRepository)) return;
    const operation = repo.getSnapshot().operations.find((item) => item.id === outcome.operationId);
    if (!operation || operation.kind !== "create" || outcome.kind !== "create" || operation.input.kind !== selectedCreationKind
      || operation.input.companyBranchId !== current.branchId || operation.input.schedule.date !== outcome.date
      || operation.localGroupId !== outcome.localGroupId || operation.localWorkId !== outcome.localWorkId) {
      setError("La creación quedó pendiente, pero no se pudo vincular a esta pantalla. Revisa Sin conexión antes de volver a crear.");
      return;
    }
    const version = sessionVersion.current;
    const action = beginAction();
    const nextRange = dailyRange(outcome.date);
    assignmentRead.current?.controller.abort();
    baselineRead.current?.abort();
    const request = ++requestVersion.current;
    setLoading(false);
    try {
      const local = normalizeAssignmentsChecklistProgress(await repo.localAssignments(nextRange, current.branchId));
      if (version !== sessionVersion.current || request !== requestVersion.current || repository.current !== repo || !currentContext()) return;
      if (local.technician.id !== current.user.workerId) throw new Error("La identidad del trabajador cambió. La cola se conserva.");
      const updated = repo.getSnapshot().operations.find((item) => item.id === operation.id);
      const result = updated?.kind === "create" && updated.status === "applied" ? updated.result : undefined;
      const candidates = [{ groupId: operation.localGroupId, workId: operation.localWorkId }, ...(result ? [{ groupId: result.groupId, workId: String(result.workId) }] : [])];
      const found = candidates.find((candidate) => local.groups.some((group) => group.id === candidate.groupId && group.works.some((work) => work.id === candidate.workId)));
      if (!found) throw new Error("No se pudo encontrar la creación en la copia local. Revisa la cola antes de repetir el envío.");
      const next: SelectedWork = { ...found, draftGroupId: operation.localGroupId, draftWorkId: operation.localWorkId, queryDate: outcome.date, scheduledDate: outcome.date, initialTab: "work" };
      creationVersion.current += 1;
      manualRefresh.current = { session: current, range: nextRange };
      state.current = { ...state.current, selectedCreationKind: null, selected: next, selectedOrder: null, data: local, range: nextRange, tab: "today" };
      setSelectedCreationKind(null); setSelected(next); setSelectedOrder(null); setData(local); setRange(nextRange); setTab("today"); setAgendaFocusDate(outcome.date);
      setError(result ? null : "Creación guardada en este dispositivo; pendiente de confirmación del servidor.");
      if (result) void refreshAssignments(true).catch(() => undefined);
    } catch (caught) {
      if (version === sessionVersion.current && repository.current === repo) setError(`La creación sigue guardada en la cola. No repitas el envío; no se pudo abrir la ficha. ${errorText(caught)}`);
    } finally { endAction(action); }
  }

  function scope(stepId?: string): WorkScope {
    if (!currentContext() || !session?.branchId || !selected || !repository.current) throw new Error("Selecciona una asignación y sucursal.");
    const { group, work } = selectedWorkDetails(state.current.data, selected);
    if (!group || !work) throw new Error("La asignación ya no está disponible. Actualiza la información.");
    if (stepId !== undefined && !work.checklists.some((checklist) => checklist.steps.some((step) => String(step.stepId) === stepId))) throw new Error("El paso no pertenece al trabajo seleccionado.");
    return { ...dailyRange(selected.queryDate), groupId: selected.groupId, workId: selected.workId, companyBranchId: session.branchId };
  }

  function groupScope(): GroupScope {
    if (!currentContext() || !session?.branchId || !selectedOrder || selected || !repository.current) throw new Error("Selecciona una orden y sucursal.");
    const group = state.current.data?.groups.find((item) => item.id === selectedOrder.id);
    if (!group) throw new Error("La orden ya no está disponible. Actualiza la información.");
    return { ...dailyRange(selectedOrder.queryDate), groupId: group.id, companyBranchId: session.branchId };
  }

  async function performMutation<T extends GroupScope, Result = void>(value: T, operation: (repo: TechnicianRepository, value: T) => Promise<Result>, refreshAfter = false): Promise<Result> {
    if (!isAccessAllowed()) throw new Error("Desbloquea la aplicación antes de continuar.");
    if (actionLock.current) throw new Error("Hay una operación en curso. Espera a que termine.");
    const repo = repository.current;
    if (!repo) throw new Error("La sesión no está disponible.");
    const version = sessionVersion.current;
    const action = beginAction();
    assignmentRead.current?.controller.abort();
    baselineRead.current?.abort();
    requestVersion.current += 1;
    setLoading(false);
    try {
      const result = await operation(repo, value);
      if (version !== sessionVersion.current || repository.current !== repo) throw new Error("La sesión cambió durante la operación. Verifica el resultado antes de repetir el envío.");
      if (refreshAfter) {
        void refreshAssignments(true).catch((caught: unknown) => {
          if (version === sessionVersion.current && repository.current === repo) setError(`El cambio fue confirmado, pero no se pudo actualizar la información. No repitas el envío; actualiza las asignaciones. ${errorText(caught)}`);
        });
      }
      return result;
    } finally { endAction(action); }
  }

  function mutation(operation: (repo: TechnicianRepository, value: WorkScope) => Promise<void>, stepId?: string, retainCreationDependency = false): Promise<void> {
    const value = scope(stepId);
    if (retainCreationDependency && !stepId && selected?.draftGroupId && selected.draftWorkId) {
      value.groupId = selected.draftGroupId; value.workId = selected.draftWorkId;
    }
    return performMutation(value, operation);
  }

  function saveAnswer(stepId: string, answer: StepAnswer): Promise<void> {
    return performMutation(scope(stepId), (repo, value) => repo.answer(value, stepId, answer), true);
  }

  function performMutationGroup(operation: (repo: TechnicianRepository, value: GroupScope) => Promise<void>): Promise<void> {
    return performMutation(groupScope(), operation);
  }

  async function readWork<T>(operation: (repo: TechnicianRepository, value: WorkScope) => Promise<T>): Promise<T> {
    const value = scope(); const repo = repository.current;
    if (!repo) throw new Error("La sesión no está disponible.");
    const version = sessionVersion.current;
    const result = await operation(repo, value);
    if (version !== sessionVersion.current || repository.current !== repo || !currentContext()) throw new Error("La sesión o el trabajo cambió durante la consulta.");
    return result;
  }

  async function attachChecklist(checklistId: number): Promise<ChecklistAssignmentResult> {
    const value = scope();
    const repo = repository.current;
    if (!repo?.attachChecklist) throw new Error("La asociación de checklists no está disponible.");
    if (actionLock.current) throw new Error("Espera a que termine la operación actual.");
    const version = sessionVersion.current;
    const action = beginAction();
    try {
      const result = checklistAssignmentResultSchema.parse(await repo.attachChecklist(value, checklistId));
      if (version !== sessionVersion.current || repository.current !== repo) throw new Error("La sesión cambió. Actualiza el trabajo antes de repetir la asociación.");
      return result;
    } finally { endAction(action); }
  }

  async function readGroup<T>(operation: (repo: TechnicianRepository, value: GroupScope) => Promise<T>): Promise<T> {
    const value = groupScope(); const repo = repository.current;
    if (!repo) throw new Error("La sesión no está disponible.");
    const version = sessionVersion.current;
    const result = await operation(repo, value);
    if (version !== sessionVersion.current || repository.current !== repo || !currentContext()) throw new Error("La sesión o la orden cambió durante la consulta.");
    return result;
  }

  function requireFileId(fileId: string): string {
    if (!fileId.trim() || fileId !== fileId.trim() || /[\u0000-\u001f\u007f/\\]/.test(fileId)) throw new Error("Selecciona un archivo válido.");
    return fileId;
  }

  async function checkConnection() {
    if (!currentContext() || actionLock.current || pendingLogin.current || !session) return;
    const version = sessionVersion.current;
    const action = beginAction();
    try {
      const result = await new HttpTechnicianRepository(requireConfiguredGateway(gatewayConfiguration, state.current.gatewayUrl), session.mode === "live" ? session.tenant : undefined).health();
      if (version === sessionVersion.current) setHealth(result);
    } catch (caught) { if (version === sessionVersion.current) { setHealth(null); setError(errorText(caught)); } }
    finally { endAction(action); }
  }

  function updateRange(next: DateRange): void {
    const current = state.current.range;
    if (next.startDate === current.startDate && next.endDate === current.endDate) return;
    assignmentRead.current?.controller.abort();
    baselineRead.current?.abort();
    const nextWeek = weekRange(next.startDate);
    setAgendaFocusDate((day) => day && day >= nextWeek.startDate && day <= nextWeek.endDate ? day : null);
    requestVersion.current += 1;
    state.current = { ...state.current, data: null, range: next, selected: null, selectedOrder: null };
    setData(null); setSelected(null); setSelectedOrder(null); setRange(next); setLoading(false);
  }

  function changeRange(next: DateRange): void {
    if (!currentContext() || actionLock.current || selected || selectedOrder || selectedCreationKind || (state.current.tab !== "today" && state.current.tab !== "agenda")) return;
    updateRange(state.current.tab === "today" ? dailyRange(next.startDate) : weekRange(next.startDate));
  }

  function focusAgendaDay(day: string): void {
    if (!currentContext() || actionLock.current || selected || selectedOrder || selectedCreationKind || state.current.tab !== "agenda") return;
    if (assignmentDay(day) !== day || day < state.current.range.startDate || day > state.current.range.endDate) return;
    setAgendaFocusDate(day);
  }

  const mainHistory = useRef<{ version: number; branchId: number | null; entries: Array<{ tab: AppTab; range: DateRange }> }>({ version: -1, branchId: null, entries: [] });
  function changeTab(next: AppTab, remember = true): void {
    if (!currentContext() || actionLock.current || selected || selectedOrder || selectedCreationKind || next === state.current.tab) return;
    if (mainHistory.current.version !== sessionVersion.current || mainHistory.current.branchId !== state.current.session?.branchId) mainHistory.current = { version: sessionVersion.current, branchId: state.current.session?.branchId ?? null, entries: [] };
    if (remember) mainHistory.current.entries.push({ tab: state.current.tab, range: state.current.range });
    const currentRange = state.current.range;
    if (next === "agenda") updateRange(weekRange(currentRange.startDate));
    else if (next === "today" && currentRange.startDate !== currentRange.endDate) {
      const today = dateKey();
      updateRange(dailyRange(today >= currentRange.startDate && today <= currentRange.endDate ? today : currentRange.startDate));
    }
    state.current = { ...state.current, tab: next };
    setTab(next);
  }

  function backTab(): void {
    if (!currentContext() || actionLock.current || selected || selectedOrder || selectedCreationKind) return;
    const previous = mainHistory.current.version === sessionVersion.current && mainHistory.current.branchId === state.current.session?.branchId ? mainHistory.current.entries.pop() : undefined;
    changeTab(previous?.tab ?? "today", false);
    if (previous) updateRange(previous.range);
  }

  function homeTab(): void {
    if (!currentContext() || actionLock.current || selected || selectedOrder || selectedCreationKind) return;
    mainHistory.current.entries = [];
    changeTab("today", false);
  }

  function changeGatewayUrl(value: string) {
    if (!isAccessAllowed() || gatewayConfiguration.locked) return;
    if (renderVersion !== sessionVersion.current || actionLock.current || restoring || state.current.session || repository.current || sessionSetup.current || pendingLogin.current || challenge || forcePassword || finalizingSession || value === state.current.gatewayUrl) return;
    sessionVersion.current += 1; requestVersion.current += 1;
    state.current = { ...state.current, gatewayUrl: value, data: null, selected: null, selectedOrder: null, selectedCreationKind: null };
    setSelectedTenant(null); setData(null); setSelected(null); setSelectedOrder(null); setSelectedCreationKind(null); setHealth(null); setError(null);
    setGatewayUrl(value);
  }

  function canonicalGroup(group: AssignmentGroup): AssignmentGroup {
    const canonical = state.current.data?.groups.find((item) => item.id === group.id && item.type === group.type);
    if (!canonical) throw new Error("La orden ya no pertenece a las asignaciones cargadas. Actualiza la información.");
    return canonical;
  }

  function workQueryRange(work: AssignmentWork): DateRange {
    return assignmentWorkQueryRange(work, range);
  }

  function workSelection(group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions): SelectedWork {
    const canonical = canonicalGroup(group);
    const foundWork = canonical.works.find((item) => item.id === work.id && item.workType === work.workType);
    const scheduledDate = assignmentDay(work.scheduledDate);
    if (!foundWork || (foundWork.schedules ? !foundWork.schedules.some((item) => assignmentDay(item.work.scheduledDate) === scheduledDate) : assignmentDay(foundWork.scheduledDate) !== scheduledDate)) throw new Error("El trabajo o su fecha ya no pertenece a esta orden. Actualiza la información.");
    const detailRange = workQueryRange(assignmentWorkForDay(foundWork, scheduledDate));
    if (!assignmentWorkForQueryDate(assignmentWorkForDay(foundWork, scheduledDate), detailRange.startDate)) throw new Error("La consulta de esta fecha ya no está disponible. Actualiza la información.");
    const repo = repository.current;
    const creation = repo instanceof OfflineTechnicianRepository ? repo.getSnapshot().operations.find((operation) => operation.kind === "create" && operation.result?.groupId === canonical.id && String(operation.result.workId) === foundWork.id) : undefined;
    return { groupId: canonical.id, workId: foundWork.id, queryDate: detailRange.startDate, scheduledDate, initialTab: options?.tab, initialAction: options?.action,
      ...(creation?.kind === "create" ? { draftGroupId: creation.localGroupId, draftWorkId: creation.localWorkId } : {}) };
  }

  function openGroup(group: AssignmentGroup, initialTab: "works" | "files" = "works"): void {
    if (!currentContext() || actionLock.current || selected || selectedOrder || selectedCreationKind || (tab !== "today" && tab !== "agenda")) return;
    const canonical = canonicalGroup(group);
    const queryDate = canonical.works[0] ? workQueryRange(canonical.works[0]).startDate : range.startDate;
    const next: SelectedOrder = { id: canonical.id, initialTab, queryDate };
    state.current = { ...state.current, selected: null, selectedOrder: next };
    setSelected(null); setSelectedOrder(next); setError(null);
  }

  function openWork(group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions): void {
    if (!currentContext() || actionLock.current || selected || selectedCreationKind || (tab !== "today" && tab !== "agenda") || (selectedOrder && selectedOrder.id !== group.id)) return;
    const next = workSelection(group, work, options);
    state.current = { ...state.current, selected: next };
    setSelected(next); setError(null);
  }

  async function onWorkStatus(group: AssignmentGroup, work: AssignmentWork, input: StatusInput): Promise<void> {
    if (!currentContext() || !session?.branchId || selected || selectedCreationKind || (tab !== "today" && tab !== "agenda") || (selectedOrder && selectedOrder.id !== group.id)) throw new Error("La selección cambió. Vuelve a abrir la asignación.");
    const selection = workSelection(group, work);
    const value: WorkScope = { ...dailyRange(selection.queryDate), groupId: selection.groupId, workId: selection.workId, companyBranchId: session.branchId };
    await performMutation(value, (repo, scope) => repo.status(scope, { ...input, executionDates: input.executionDates ?? [scope.startDate] }), true);
  }

  function closeWork(): void {
    if (!currentContext() || actionLock.current || !selected) return;
    state.current = { ...state.current, selected: null };
    setSelected(null);
  }

  function closeOrder(): void {
    if (!currentContext() || actionLock.current || selected || !selectedOrder) return;
    state.current = { ...state.current, selectedOrder: null };
    setSelectedOrder(null);
  }

  function closeDetails(): void {
    if (!currentContext() || actionLock.current) return;
    state.current = { ...state.current, selected: null, selectedOrder: null };
    setSelected(null); setSelectedOrder(null);
  }

  const { group: canonicalDetailGroup, work: canonicalDetailWork, schedule } = selectedWorkDetails(data, selected);
  const group = useMemo(() => canonicalDetailGroup && selected?.draftGroupId ? { ...canonicalDetailGroup, id: selected.draftGroupId } : canonicalDetailGroup, [canonicalDetailGroup, selected?.draftGroupId]);
  const work = useMemo(() => canonicalDetailWork && selected?.draftWorkId ? { ...canonicalDetailWork, id: selected.draftWorkId } : canonicalDetailWork, [canonicalDetailWork, selected?.draftWorkId]);
  const orderGroup = data?.groups.find((item) => item.id === selectedOrder?.id);
  const detailRange = dailyRange(selected?.queryDate ?? range.startDate);
  const detailGeneratedAt = schedule?.generatedAt ?? data?.generatedAt ?? "";
  const offlineActions = useRef({ syncOffline, retryOffline });
  offlineActions.current = { syncOffline, retryOffline };
  const managedOfflineController = useMemo<OfflineController | null>(() => offlineController ? {
    getSnapshot: offlineController.getSnapshot, subscribe: offlineController.subscribe,
    start: offlineController.start, stop: offlineController.stop, setForeground: offlineController.setForeground,
    syncNow: () => repository.current === offlineController ? offlineActions.current.syncOffline() : Promise.reject(new Error("La sesión offline cambió.")),
    requestSync: () => repository.current === offlineController ? offlineActions.current.syncOffline() : Promise.reject(new Error("La sesión offline cambió.")),
    retry: (id) => repository.current === offlineController ? offlineActions.current.retryOffline(id) : Promise.reject(new Error("La sesión offline cambió.")),
    hasPendingChanges: offlineController.hasPendingChanges, readLocalFile: offlineController.readLocalFile,
    prepareWeek: (nextRange, branchId, options) => isAccessAllowed() && repository.current === offlineController ? offlineController.prepareWeek(nextRange, branchId, options) : Promise.reject(new Error("Desbloquea la app y verifica la sesión offline.")),
  } : null, [offlineController, isAccessAllowed]);

  return {
    gatewayUrl, setGatewayUrl: changeGatewayUrl, challenge, selectedTenant, selectTenant, cancelLoginChallenge,
    suggestedGatewayUrl: !gatewayConfiguration.locked && __DEV__ && Platform.OS !== "web" ? suggestedExpoGatewayUrl(Constants.expoConfig?.hostUri, gatewayUrl) : undefined,
    session, data, range, selected, selectedOrder, selectedCreationKind, selectedGroupId: selectedOrder?.id ?? null, orderGroup, group, work, detailRange, detailGeneratedAt, tab, setTab: changeTab, error: error ?? offlineSetupError, busy, loading, restoring, forcePassword, finalizingSession, health, notifications, liveVerified,
    offline, offlineController: managedOfflineController, offlineVerifiedAt, offlineSetupError, selectedOffline, openOffline, closeOffline, prepareOfflineWeek, syncOffline,
    canonicalDetailGroup, canonicalDetailWork,
    detailDraftIdentity: selected?.draftGroupId && selected.draftWorkId ? { groupId: selected.draftGroupId, workId: selected.draftWorkId } : undefined,
    storageKey: session ? tenantStorageNamespace(session, gatewayUrl, session.branchId) : "anonymous",
    login, demo, changePassword, retrySessionSetup, branch, logout, checkConnection, refresh, changeRange, agendaFocusDate, focusAgendaDay, openGroup, closeOrder, openWork, closeWork, closeDetails, backTab, homeTab, onWorkStatus,
    openCreate, closeCreate, creationOptions, createRecord, onCreated, onOfflineQueuedCreate,
    changeStatus: (input: StatusInput) => performMutation(scope(), (repo, value) => repo.status(value, input), true),
    reopenWork: () => performMutation(scope(), (repo, value) => workActions(repo).reopenWork(value), true),
    loadActivities: () => readWork((repo, value) => workActions(repo).activities(value)),
    createActivity: (input: WorkActivityInput) => performMutation(scope(), (repo, value) => workActions(repo).createActivity(value, input), true),
    updateActivity: (id: number, input: WorkActivityInput) => performMutation(scope(), (repo, value) => workActions(repo).updateActivity(value, id, input), true),
    completeActivity: (id: number, isCompleted = true) => performMutation(scope(), (repo, value) => workActions(repo).completeActivity(value, id, isCompleted), true),
    deleteActivity: (id: number) => performMutation(scope(), (repo, value) => workActions(repo).deleteActivity(value, id), true),
    loadActivityFiles: (id: number) => readWork((repo, value) => workActions(repo).activityFiles(value, id)),
    uploadActivityFiles: (id: number, files: LocalPhoto[]) => performMutation(scope(), (repo, value) => workActions(repo).uploadActivityFiles(value, id, files)),
    saveAnswer,
    loadChecklistOptions: (query: ChecklistCatalogQuery) => readWork(async (repo, value) => {
      if (!repo.checklistOptions) throw new Error("El catálogo de checklists no está disponible.");
      return checklistCatalogPageSchema.parse(await repo.checklistOptions(value, query));
    }),
    attachChecklist,
    loadFiles: (): Promise<Attachment[]> => readWork((repo, value) => repo.files(value)),
    loadStepFiles: (stepId: string): Promise<Attachment[]> => readWork((repo, value) => repo.stepFiles(value, stepId)),
    upload: (photos: LocalPhoto[], stepId?: string) => mutation((repo, value) => repo.upload(value, photos, stepId), stepId, true),
    uploadDocuments: (files: LocalPhoto[], stepId?: string) => mutation((repo, value) => repo.uploadDocuments(value, files, stepId), stepId, true),
    deleteFile: (fileId: string, stepId?: string) => mutation((repo, value) => repo.deleteFile(value, requireFileId(fileId), stepId), stepId),
    loadComments: (page: number): Promise<CommentPage> => readWork((repo, value) => {
      if (!Number.isSafeInteger(page) || page < 0) throw new Error("La página de comentarios no es válida.");
      return repo.comments(value, page);
    }),
    addComment: (text: string) => mutation((repo, value) => repo.addComment(value, text), undefined, true),
    loadGroupFiles: (): Promise<Attachment[]> => readGroup((repo, value) => repo.groupFiles(value)),
    uploadGroupFiles: (files: LocalPhoto[]) => performMutationGroup((repo, value) => repo.uploadGroupFiles(value, files)),
    deleteGroupFile: (fileId: string) => performMutationGroup((repo, value) => repo.deleteGroupFile(value, requireFileId(fileId))),
    loadOrderDelivery: () => readGroup((repo, value) => repo.orderDelivery(value)),
    startOrder: () => performMutation(groupScope(), (repo, value) => repo.startOrder(value), true),
    deliverOrder: (input: MaintenanceDeliveryInput) => performMutation(groupScope(), (repo, value) => repo.deliverOrder(value, input), true),
    report: (note: string) => mutation((repo, value) => repo.report(value, note)),
  };
}
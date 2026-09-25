import { syncCapabilitiesSchema, syncCommandSchema, syncScopeSchema } from "../domain/offlineProtocol";
import { creationInputSchema, creationResultSchema } from "../domain/creation";
import type { LocalPhoto, User, WorkScope } from "../domain/models";
import { sameTenant } from "../domain/tenantSession";
import { OfflineUnavailableError, type OfflineCommand, type OfflineConnection, type OfflineOperation, type OfflineReceipt, type OfflineScope, type OfflineSnapshot } from "../domain/offline";
import { ApiError, NetworkError } from "../infrastructure/errors";
import { OFFLINE_LIMITS, type EngineDependencies, type OfflineState } from "./contracts";
import { cloneState, emptyState, hasPendingChanges, pendingOperation, receiptSchema, updateState } from "./state";
import { resourceCacheKey, sameResource } from "./cacheSchemas";
import { connectionErrorCode as errorCode, failedConnection, isServiceFailure, requiresDeployment } from "./connection";
import { prepareQueuedActivity, prepareQueuedIntention } from "./queueIntentions";
import { awaitingDeploymentCounts, canAdvanceManualRetry, deploymentKinds, deploymentWaits, protectDeploymentCooldown, runnableOperations } from "./syncScheduling";

export function canUseCache(error: unknown): boolean { return error instanceof NetworkError; }
export function backoffMs(attempts: number): number { return Math.min(OFFLINE_LIMITS.maxBackoffMs, 2_000 * 2 ** Math.min(8, Math.max(0, attempts - 1))); }
export function sameOfflineUser(expected: User, actual: User, branchId: number): boolean {
  return expected.id === actual.id && expected.workerId === actual.workerId
    && (!expected.tenant ? !actual.tenant : !!actual.tenant && sameTenant(expected.tenant, actual.tenant))
    && actual.accessBranchs.some((branch) => branch.id === branchId && branch.isEnabled !== false && branch.isDeleted !== true);
}
export function resolveScope(scope: OfflineScope, operations: readonly OfflineOperation[]): OfflineScope | null {
  if (!scope.groupId.startsWith("local-") && !scope.workId?.startsWith("local-")) return scope;
  const creation = operations.find((entry) => entry.kind === "create" && entry.localGroupId === scope.groupId);
  if (!creation || creation.kind !== "create" || creation.status !== "applied" || !creation.result) return null;
  if (creation.input.companyBranchId !== scope.companyBranchId || creation.result.companyBranchId !== scope.companyBranchId) return null;
  if (scope.workId && scope.workId !== creation.localWorkId) return null;
  return { ...scope, groupId: creation.result.groupId, ...(scope.workId ? { workId: String(creation.result.workId) } : {}) };
}
export function resolveDocumentScope(scope: OfflineScope, operations: readonly OfflineOperation[]): OfflineScope | null {
  const resolved = resolveScope(scope, operations);
  if (!resolved) return null;
  if (scope.groupId.startsWith("local-")) {
    const parent = operations.find((entry) => entry.kind === "create" && entry.localGroupId === scope.groupId);
    if (parent?.kind !== "create" || !parent.result || parent.input.kind !== parent.result.kind
      || !creationResultSchema.safeParse(parent.result).success) return null;
    if (parent.result.kind !== "maintenance" && parent.result.groupId !== `${parent.result.kind === "non_productive" ? "direct-np" : "direct"}-${parent.result.workId}`) return null;
  }
  const direct = /^(?:direct|direct-np)-([1-9]\d*)$/.exec(resolved.groupId);
  if (direct && resolved.workId !== undefined && resolved.workId !== direct[1]) return null;
  const documentScope = direct && resolved.workId === undefined ? { ...resolved, workId: direct[1] } : resolved;
  return syncScopeSchema.safeParse(documentScope).success ? documentScope : null;
}
function recoverableDirectDocument(operation: OfflineOperation, operations: readonly OfflineOperation[]): boolean {
  if (operation.kind !== "document" || operation.status !== "needs_review" || operation.receipt
    || operation.lastError !== "OFFLINE_DOCUMENT_UNEXPECTED_ERROR" || operation.scope.workId !== undefined || operation.stepId !== undefined) return false;
  if (operation.scope.groupId.startsWith("local-")) {
    const parent = operations.find((entry) => entry.kind === "create" && entry.localGroupId === operation.scope.groupId);
    if (!parent || (operation.dependencyId !== undefined && operation.dependencyId !== parent.id)) return false;
  } else if (operation.dependencyId !== undefined) return false;
  const resolved = resolveDocumentScope(operation.scope, operations);
  return resolved !== null && /^(?:direct|direct-np)-[1-9]\d*$/.test(resolved.groupId);
}
export function sameSubmissionScope(left: OfflineScope, right: OfflineScope, operations: readonly OfflineOperation[]): boolean {
  const canonicalLeft = resolveScope(left, operations) ?? left;
  const canonicalRight = resolveScope(right, operations) ?? right;
  return sameResource(canonicalLeft, canonicalRight) && left.startDate === right.startDate && left.endDate === right.endDate;
}
export function findDraftDocument(operations: readonly OfflineOperation[], namespace: string, scope: OfflineScope, sourceDraftId: string, stepId?: string): Extract<OfflineOperation, { kind: "document" }> | undefined {
  return operations.find((entry): entry is Extract<OfflineOperation, { kind: "document" }> => entry.kind === "document"
    && entry.file.namespace === namespace && entry.sourceDraftId === sourceDraftId && entry.stepId === stepId
    && sameSubmissionScope(entry.scope, scope, operations));
}
function recoverableContractRejection(operation: OfflineOperation): boolean {
  if (operation.status !== "blocked" || operation.lastError !== "INVALID_INPUT" || operation.receipt || operation.contractRecoveryVersion) return false;
  if (operation.kind === "create") return !operation.result && operation.input.clientRequestId === operation.id && operation.input.kind === "work"
    && (!operation.input.work.summary || !operation.input.schedule.startTime || !operation.input.schedule.endTime) && creationInputSchema.safeParse(operation.input).success;
  if (operation.kind !== "completion" && operation.kind !== "timer" && operation.kind !== "checklist") return false;
  return syncCommandSchema.safeParse({ operationId: operation.id, kind: operation.kind, scope: operation.scope, payload: operation.payload }).success;
}
export class OfflineEngine {
  private state: OfflineState = emptyState();
  private connection: OfflineConnection = { status: "checking", networkConnected: null, foreground: true, checkedAt: null };
  private snapshot: OfflineSnapshot = { connection: this.connection, online: false, preparing: false, syncing: false, authBlocked: false, pending: 0, conflicts: 0, lastSyncedAt: null, lastError: null, coverage: [], operations: [] };
  private listeners = new Set<() => void>();
  private generation = 0;
  private started = false;
  private foreground = true;
  private stopped = false;
  private unsubscribeNetwork?: () => void;
  private networkSubscription = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private cycle?: Promise<void>;
  private probeFailures = 0;
  private connectionRevision = 0;
  private authRevision = 0;
  private authBlock?: Promise<void>;
  private authBlockComplete = false;
  private wakeRequested = false;
  private retryTransportOnWake = false;
  private manualRequest?: Promise<void>;
  private lastManualRequestAt?: number;
  private manualRetryGeneration?: number;
    private compatibilityNextAt = 0;
  constructor(readonly dependencies: EngineDependencies) {}

  getSnapshot = (): OfflineSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<OfflineSnapshot> = {}): void {
    this.snapshot = {
      ...this.snapshot, ...patch,
      connection: { ...this.connection, ...(this.state.authBlocked ? { status: "auth_required" as const } : {}) },
      online: !this.state.authBlocked && this.connection.status === "ready",
      authBlocked: this.state.authBlocked,
      pending: this.state.operations.filter(pendingOperation).length,
      conflicts: this.state.operations.filter((op) => ["blocked", "conflict", "needs_review", "auth_required"].includes(op.status)).length,
      lastSyncedAt: this.state.lastSyncedAt,
      cachedAt: this.state.cache.length ? Math.max(...this.state.cache.map((entry) => entry.fetchedAt)) : undefined,
      coverage: this.state.cache.flatMap((entry) => entry.coverage ? [entry.coverage] : []),
      awaitingDeploymentByKind: awaitingDeploymentCounts(this.state.operations),
      operations: cloneState(this.state).operations,
    };
    for (const listener of this.listeners) {
      try { listener(); } catch { /* UI observers cannot invalidate an already committed queue write. */ }
    }
  }
  async refresh(): Promise<void> {
    this.state = await this.dependencies.store.read(this.dependencies.namespace);
    if (!this.state.authBlocked && this.authBlockComplete) {
      this.authBlock = undefined;
      this.authBlockComplete = false;
    }
    const storage = await this.dependencies.fileStore.storageUsage?.().catch(() => undefined);
    this.publish({ storage });
  }
  setPreparing(preparing: boolean): void { this.publish({ preparing }); }
  setMissingDates(missingDates: string[]): void { this.publish({ missingDates }); }
  getConnectionGeneration(): number { return this.generation; }
  noteNetworkState(networkConnected: boolean | null): void {
    const previous = this.connection.networkConnected;
    this.connection = { ...this.connection, networkConnected };
    if (networkConnected === false) {
      if (previous !== false) this.generation++;
      this.connection = { ...this.connection, status: "offline", errorCode: undefined, checkedAt: this.dependencies.now() };
    } else if (previous === false) {
      this.connection = { ...this.connection, status: "checking", errorCode: undefined };
    }
    this.publish();
  }
  noteConnectionSuccess(generation = this.generation): void {
    if (generation !== this.generation || this.stopped || this.state.authBlocked || this.connection.networkConnected === false) return;
    this.connectionRevision++;
    const deployment = this.state.operations.find((op) => op.status !== "applied" && requiresDeployment(op.lastError));
    this.connection = { ...this.connection, status: deployment ? "service_error" : "ready", checkedAt: this.dependencies.now(), errorCode: deployment?.lastError };
    this.publish({ lastError: deployment?.lastError ?? null });
  }
  noteConnectionFailure(error: unknown, generation = this.generation): void {
    if (generation !== this.generation || this.stopped || this.state.authBlocked) return;
    this.connection = failedConnection(this.connection, error, this.dependencies.now());
    this.publish({ lastError: errorCode(error) });
  }
  private wake(): void {
    this.probeFailures = 0;
    this.retryTransportOnWake = true;
    this.wakeRequested = true;
    this.schedule(0);
  }
  private listenNetwork(): void {
    this.unsubscribeNetwork?.();
    const subscription = ++this.networkSubscription;
    this.unsubscribeNetwork = this.dependencies.connectivity.subscribe((connected) => {
      if (subscription !== this.networkSubscription || !this.started || !this.foreground || this.stopped) return;
      const previous = this.connection.networkConnected;
      this.noteNetworkState(connected);
      if (connected === true && previous !== true) this.wake();
    });
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.generation++;
    if (this.foreground) { this.listenNetwork(); this.wake(); }
  }
  stop(): void {
    this.started = false;
    this.stopped = true;
    this.generation++;
    this.networkSubscription++;
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.dependencies.fileStore.releaseURLs();
  }
  setForeground(active: boolean): void {
    if (active === this.foreground) return;
    this.foreground = active;
    this.connection = { ...this.connection, foreground: active };
    this.publish();
    this.generation++;
    if (!active) {
      this.wakeRequested = false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      this.networkSubscription++;
      this.unsubscribeNetwork?.();
      this.unsubscribeNetwork = undefined;
    } else if (this.started) { this.listenNetwork(); this.wake(); }
  }
  private schedule(delay: number): void {
    if (!this.started || !this.foreground || this.stopped || this.state.authBlocked) return;
    if (this.timer) clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (generation !== this.generation) return;
      void this.syncNow().catch(() => undefined);
    }, delay);
  }
  async enqueue(operations: OfflineOperation[], options?: { reusePendingComments?: boolean }): Promise<OfflineOperation[]> {
    const { store, namespace } = this.dependencies;
    let registered: OfflineOperation[] = [];
    if (this.dependencies.canAccessLocal && !await this.dependencies.canAccessLocal()) throw new OfflineUnavailableError("OFFLINE_AUTH_REQUIRED");
    this.state = await updateState(store, namespace, (state) => {
      registered = [];
      if (state.authBlocked) throw new OfflineUnavailableError("OFFLINE_AUTH_REQUIRED");
      for (const input of operations) {
        const operation = input.kind === "timer" || input.kind === "checklist" || input.kind === "completion"
          ? prepareQueuedIntention(state, input, this.dependencies.user, this.dependencies.branchId)
          : input.kind === "activity" ? prepareQueuedActivity(state, input, this.dependencies.user, this.dependencies.branchId) : input;
        if (operation.kind === "create") creationInputSchema.parse(operation.input);
        const draft = operation.kind === "document" && operation.sourceDraftId
          ? findDraftDocument(state.operations, namespace, operation.scope, operation.sourceDraftId, operation.stepId) : undefined;
        if (draft && operation.kind === "document") {
          if (operation.file.namespace !== namespace || draft.file.sha256 !== operation.file.sha256 || draft.file.size !== operation.file.size
            || draft.file.name !== operation.file.name || draft.file.mimeType !== operation.file.mimeType) throw new OfflineUnavailableError("OFFLINE_SOURCE_DRAFT_COLLISION");
          registered.push(draft);
          continue;
        }
        const comment = options?.reusePendingComments && operation.kind === "comment" ? state.operations.find((entry) => entry.kind === "comment"
          && entry.status !== "applied" && entry.text.trim() === operation.text.trim() && sameSubmissionScope(entry.scope, operation.scope, state.operations)) : undefined;
        if (comment) { registered.push(comment); continue; }
        const previous = state.operations.find((entry) => entry.id === operation.id);
        if (previous) {
          const immutable = (entry: OfflineOperation) => entry.kind === "create" ? JSON.stringify(creationInputSchema.parse(entry.input)) : JSON.stringify({ ...entry, status: "pending", attempts: 0, nextAttemptAt: 0, receipt: undefined, lastError: undefined });
          if (immutable(previous) !== immutable(operation)) throw new OfflineUnavailableError("OFFLINE_OPERATION_ID_REUSED");
          registered.push(previous);
          continue;
        }
        state.operations.push(operation);
        registered.push(operation);
      }
    });
    this.publish();
    this.wakeRequested = true;
    this.schedule(0);
    return registered;
  }
  async retry(id: string): Promise<void> {
    this.state = await updateState(this.dependencies.store, this.dependencies.namespace, (state) => {
      if (state.authBlocked) throw new OfflineUnavailableError("OFFLINE_AUTH_REQUIRED");
      const operation = state.operations.find((entry) => entry.id === id);
      if (!operation) throw new OfflineUnavailableError("OFFLINE_OPERATION_NOT_FOUND");
      if (operation.status === "applied") return;
      if (["conflict", "needs_review", "auth_required"].includes(operation.status)
        || operation.receipt && operation.receipt.state !== "applied"
        || ["MOBILE_SYNC_OPERATION_REUSED", "MOBILE_CREATION_REQUEST_CONFLICT"].includes(operation.lastError ?? "")
        || operation.status === "blocked" && !["OFFLINE_NETWORK_UNAVAILABLE", "OFFLINE_TIMEOUT_UNCERTAIN", "OFFLINE_CYCLE_INTERRUPTED"].includes(operation.lastError ?? "")) throw new OfflineUnavailableError("OFFLINE_REVIEW_REQUIRED");
      if ((operation.lastError === "MOBILE_SYNC_IN_PROGRESS" || requiresDeployment(operation.lastError)) && operation.nextAttemptAt > this.dependencies.now()) return;
      if (operation.status !== "syncing") { operation.status = "pending"; operation.nextAttemptAt = 0; }
    });
    this.publish();
    await this.syncNow();
  }
  hasPendingChanges(): Promise<boolean> { return hasPendingChanges(this.dependencies.store); }
  async readLocalFile(id: string): Promise<LocalPhoto> {
    await this.refresh();
    if (this.state.authBlocked || (this.dependencies.canAccessLocal && !await this.dependencies.canAccessLocal())) throw new OfflineUnavailableError("OFFLINE_AUTH_REQUIRED");
    const cached = this.state.attachments.find((entry) => entry.file.id === id && entry.file.namespace === this.dependencies.namespace);
    const document = this.state.operations.find((entry) => entry.kind === "document" && entry.file.id === id);
    const binding = cached ?? (document?.kind === "document" ? document : undefined);
    if (binding) {
      const scope = resolveScope(binding.scope, this.state.operations) ?? binding.scope;
      if (this.state.revokedResources.some((entry) => entry.key === resourceCacheKey("files", scope, binding.stepId))) throw new OfflineUnavailableError("OFFLINE_RESOURCE_ACCESS_REVOKED");
    }
    if (cached) return { ...cached.file, uri: await this.dependencies.fileStore.resolveURI(cached.file) };
    const operation = this.state.operations.find((entry) => entry.kind === "document" && entry.file.id === id);
    if (!operation || operation.kind !== "document" || operation.file.namespace !== this.dependencies.namespace) throw new OfflineUnavailableError("OFFLINE_LOCAL_FILE_NOT_FOUND");
    return { ...operation.file, uri: await this.dependencies.fileStore.resolveURI(operation.file) };
  }
  blockAuth(): Promise<void> {
    if (this.authBlock) return this.authBlock;
    this.authRevision++;
    this.authBlock = this.invalidateAuth().then(() => {
      this.authBlockComplete = true;
    }, (error: unknown) => {
      this.authBlock = undefined;
      throw error;
    });
    return this.authBlock;
  }
  private async invalidateAuth(): Promise<void> {
    this.state = await updateState(this.dependencies.store, this.dependencies.namespace, (state) => {
      state.authBlocked = true;
      for (const op of state.operations) if (op.status === "pending" || op.status === "syncing") op.status = "auth_required";
    });
    this.connection = { ...this.connection, status: "auth_required", checkedAt: this.dependencies.now(), errorCode: "OFFLINE_AUTH_REQUIRED" };
    this.publish({ lastError: "OFFLINE_AUTH_REQUIRED" });
    await this.dependencies.onAuthBlocked?.();
  }
  async revalidate(): Promise<User> {
    const generation = this.generation;
    const authRevision = this.authRevision;
    const user = await this.dependencies.upstream.me(this.dependencies.branchId);
    if (!sameOfflineUser(this.dependencies.user, user, this.dependencies.branchId)) throw new ApiError(401, "OFFLINE_IDENTITY_CHANGED", "La identidad de la sesión cambió.");
    if (generation !== this.generation || authRevision !== this.authRevision || this.stopped) throw new OfflineUnavailableError("OFFLINE_CYCLE_INTERRUPTED");
    await this.dependencies.onVerified?.(user);
    return user;
  }
  requestSync(): Promise<void> {
    if (this.manualRequest) return this.manualRequest;
    if (this.stopped || !this.foreground || this.state.authBlocked) return Promise.resolve();
    const now = this.dependencies.now();
    if (this.lastManualRequestAt !== undefined && now - this.lastManualRequestAt < 30_000) return this.cycle ?? Promise.resolve();
    this.lastManualRequestAt = now;
    const generation = this.generation;
    const current = this.cycle;
    const request = async (): Promise<void> => {
      // A user request during a send gets one pass after its receipt and lease have settled.
      if (current) await current;
      if (generation !== this.generation || this.stopped || !this.foreground || this.state.authBlocked) return;
      this.manualRetryGeneration = generation;
      await this.syncNow();
    };
    this.manualRequest = request().finally(() => { this.manualRequest = undefined; });
    return this.manualRequest;
  }
  syncNow(): Promise<void> {
    if (this.cycle) return this.cycle;
    if (this.stopped || !this.foreground) return Promise.resolve();
    this.wakeRequested = false;
    const generation = this.generation;
    const cycle = this.flush(generation);
    this.cycle = cycle.finally(() => {
      this.cycle = undefined;
      this.publish({ syncing: false });
      const pending = runnableOperations(this.state.operations);
      const waits = deploymentWaits(this.state.operations);
      const soonest = this.probeFailures ? backoffMs(this.probeFailures) : pending.length ? Math.min(...pending.map((op) => Math.max(2_000, Math.max(op.nextAttemptAt, waits.get(op.kind) ?? 0) - this.dependencies.now()))) : 30_000;
      this.schedule(this.wakeRequested ? 0 : Math.min(OFFLINE_LIMITS.maxBackoffMs, Math.max(2_000, soonest)));
    });
    return this.cycle;
  }
  private async flush(generation: number): Promise<void> {
    const { store, namespace, now, uuid, connectivity } = this.dependencies;
    const manualRetry = this.manualRetryGeneration === generation;
    if (manualRetry) this.manualRetryGeneration = undefined;
    await this.refresh();
    if (this.state.authBlocked || generation !== this.generation) return;
    if (this.dependencies.canAccessLocal && !await this.dependencies.canAccessLocal()) { await this.blockAuth(); return; }
    let connected: boolean | null;
    try { connected = await connectivity.current(); }
    catch (error) { this.probeFailures++; this.noteConnectionFailure(error, generation); return; }
    if (generation !== this.generation) return;
    this.noteNetworkState(connected);
    if (connected === false) { this.probeFailures++; return; }
    if (generation !== this.generation) return;
    const owner = uuid();
    let acquired = false;
    const retryTransport = this.retryTransportOnWake;
    this.state = await updateState(store, namespace, (state) => {
      acquired = false;
      if (generation !== this.generation || state.authBlocked || (state.lease && state.lease.until > now())) return;
      state.lease = { owner, until: now() + OFFLINE_LIMITS.leaseMs };
      for (const op of state.operations) {
        if (manualRetry && canAdvanceManualRetry(op)) op.nextAttemptAt = 0;
        if (op.kind === "document" && op.status === "needs_review" && !op.receipt
          && (op.lastError === "OFFLINE_SYNC_UNEXPECTED_RESPONSE" || recoverableDirectDocument(op, state.operations))) {
          op.status = "pending";
          op.lastError = "OFFLINE_DOCUMENT_RECOVERY_PENDING";
          op.nextAttemptAt = 0;
        }
        if (retryTransport && op.status === "pending" && !op.receipt && ["OFFLINE_NETWORK_UNAVAILABLE", "OFFLINE_TIMEOUT_UNCERTAIN", "OFFLINE_CYCLE_INTERRUPTED"].includes(op.lastError ?? "")) op.nextAttemptAt = 0;
        if (op.kind === "create" && (op.status === "conflict" || op.status === "blocked") && !op.receipt && !op.result && op.lastError === "MOBILE_CREATION_SCHEMA_NOT_READY") {
          op.status = "pending";
          op.nextAttemptAt = 0;
        }
      }
      acquired = true;
    });
    if (!acquired) return;
    this.retryTransportOnWake = false;
    this.publish({ syncing: true, lastError: null });
    const connectionRevision = this.connectionRevision;
    try {
      if (generation !== this.generation) return;
      await this.revalidate();
      if (generation !== this.generation) return;
      if (this.state.operations.some(recoverableContractRejection) && this.dependencies.upstream.offlineCapabilities && (manualRetry || now() >= this.compatibilityNextAt)) {
        this.compatibilityNextAt = now() + 60_000;
        try {
          const capabilities = syncCapabilitiesSchema.parse(await this.dependencies.upstream.offlineCapabilities(this.dependencies.branchId));
          if (capabilities.userId !== this.dependencies.user.id || capabilities.workerId !== this.dependencies.user.workerId || capabilities.companyBranchId !== this.dependencies.branchId) throw new ApiError(401, "OFFLINE_IDENTITY_CHANGED", "La identidad de la sesión cambió.");
          this.state = await updateState(store, namespace, state => {
            if (generation !== this.generation || state.authBlocked || state.lease?.owner !== owner || state.lease.until <= now()) return;
            for (const operation of state.operations) if (recoverableContractRejection(operation)) {
              operation.status = "pending"; operation.nextAttemptAt = 0; operation.contractRecoveryVersion = 1;
            }
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw error;
          this.publish({ lastError: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" });
        }
      }
      this.probeFailures = 0;
      this.noteConnectionSuccess(generation);
      const skippedKinds = new Set<OfflineOperation["kind"]>();
      for (let count = 0; count < OFFLINE_LIMITS.cycleOperations; count++) {
        if (generation !== this.generation) break;
        let selected: OfflineOperation | undefined;
        this.state = await updateState(store, namespace, (state) => {
          selected = undefined;
          if (state.lease?.owner !== owner || state.authBlocked) return;
          state.lease.until = now() + OFFLINE_LIMITS.leaseMs;
          const waits = deploymentWaits(state.operations);
          selected = runnableOperations(state.operations).find((op) => !skippedKinds.has(op.kind)
            && Math.max(op.nextAttemptAt, waits.get(op.kind) ?? 0) <= now());
          if (selected) { selected.status = "syncing"; selected.attempts++; }
        });
        if (!selected) break;
        this.publish();
        try {
          const result = await this.send(selected, this.state.operations, async () => {
            const current = await store.read(namespace);
            if (generation !== this.generation || current.lease?.owner !== owner || current.lease.until <= now() || current.authBlocked) throw new OfflineUnavailableError("OFFLINE_CYCLE_INTERRUPTED");
            if (this.dependencies.canAccessLocal && !await this.dependencies.canAccessLocal()) throw new ApiError(401, "OFFLINE_AUTH_REQUIRED", "La identidad local fue deshabilitada.");
          });
          this.state = await updateState(store, namespace, (state) => {
            if (state.lease?.owner !== owner) return;
            const current = state.operations.find((entry) => entry.id === selected?.id);
            if (!current) return;
            if (current.kind === "create" && result.kind === "creation") {
              current.result = result.result;
              current.status = "applied";
            } else if (result.kind === "receipt") {
              current.receipt = result.receipt;
              current.status = result.receipt.state === "rejected" ? "blocked" : result.receipt.state;
              current.lastError = result.receipt.error;
            }
            if (current.status === "applied") {
              current.lastError = undefined; state.lastSyncedAt = now();
              if (current.kind === "document" && current.receipt?.fileId !== undefined) {
                const scope = resolveScope(current.scope, state.operations);
                if (scope && !state.attachments.some((entry) => sameResource(entry.scope, scope) && entry.stepId === current.stepId && entry.attachmentId === String(current.receipt?.fileId))) {
                  state.attachments.push({ scope, stepId: current.stepId, attachmentId: String(current.receipt.fileId), file: current.file });
                }
              }
            }
          });
          this.noteConnectionSuccess(generation);
          this.publish();
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) { await this.blockAuth(); break; }
          const unsupported = error instanceof ApiError && (error.status === 503 || error.status === 409 && selected.kind === "create" && error.code === "MOBILE_CREATION_SCHEMA_NOT_READY")
            ? deploymentKinds({ ...selected, lastError: error.code }) : undefined;
          this.state = await updateState(store, namespace, (state) => {
            if (state.lease?.owner !== owner) return;
            const current = state.operations.find((entry) => entry.id === selected?.id);
            if (!current) return;
            current.lastError = current.kind === "document" && errorCode(error) === "OFFLINE_SYNC_UNEXPECTED_RESPONSE"
              ? "OFFLINE_DOCUMENT_SUBMISSION_FAILED" : errorCode(error);
            const inProgress = error instanceof ApiError && error.code === "MOBILE_SYNC_IN_PROGRESS";
            const deployment = error instanceof ApiError && requiresDeployment(error.code);
            const invalidDocumentReceipt = (current.kind === "document" || current.kind === "activity") && error instanceof ApiError && error.code === "OFFLINE_INVALID_RECEIPT";
            current.status = invalidDocumentReceipt || error instanceof ApiError && error.code === "MOBILE_SYNC_OPERATION_REUSED" ? "needs_review"
              : deployment || inProgress || error instanceof NetworkError || (error instanceof OfflineUnavailableError && error.code === "OFFLINE_CYCLE_INTERRUPTED") || (error instanceof ApiError && (error.status >= 500 || error.status === 429)) ? "pending"
              : error instanceof ApiError && error.status === 409 ? "conflict"
                : error instanceof ApiError && [400, 403, 404, 422].includes(error.status) ? "blocked" : "needs_review";
            current.nextAttemptAt = now() + Math.max(deployment ? 60_000 : inProgress ? 5_000 : 0, backoffMs(current.attempts));
            if (unsupported) protectDeploymentCooldown(state.operations, current);
          });
          if (error instanceof NetworkError || isServiceFailure(error)) this.noteConnectionFailure(error, generation);
          this.publish({ lastError: errorCode(error) });
          if (unsupported) {
            for (const kind of unsupported) skippedKinds.add(kind);
            continue;
          }
          if (error instanceof NetworkError || isServiceFailure(error)) break;
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await this.blockAuth();
      else if (generation === this.generation && !(error instanceof NetworkError && connectionRevision !== this.connectionRevision && this.connection.status === "ready")) {
        this.probeFailures++;
        this.noteConnectionFailure(error, generation);
      }
    } finally {
      this.state = await updateState(store, namespace, (state) => { if (state.lease?.owner === owner) state.lease = null; });
      this.publish();
    }
  }
  private async send(operation: OfflineOperation, operations: OfflineOperation[], assertOwner: () => Promise<void>): Promise<{ kind: "creation"; result: import("../domain/creation").CreationResult } | { kind: "receipt"; receipt: OfflineReceipt }> {
    const { upstream, fileStore } = this.dependencies;
    await assertOwner();
    if (operation.kind === "create") {
      const result = creationResultSchema.parse(await upstream.createRecord(operation.input));
      if (result.kind !== operation.input.kind || result.companyBranchId !== operation.input.companyBranchId || result.schedule.date !== operation.input.schedule.date) throw new OfflineUnavailableError("OFFLINE_CREATION_RESULT_MISMATCH");
      return { kind: "creation", result };
    }
    const scope = operation.kind === "document" ? resolveDocumentScope(operation.scope, operations) : resolveScope(operation.scope, operations);
    if (!scope) throw new OfflineUnavailableError(operation.kind === "document" ? "OFFLINE_DOCUMENT_INVALID_SCOPE" : "OFFLINE_DEPENDENCY_UNRESOLVED");
    if (!upstream.offlineReceipt) throw new OfflineUnavailableError("OFFLINE_SYNC_CONTRACT_UNAVAILABLE");
    const previous = await upstream.offlineReceipt(operation.id, scope.companyBranchId);
    if (previous) {
      const receipt = this.checkedReceipt(operation.id, previous);
      if (receipt.state !== "applied") return { kind: "receipt", receipt };
    }
    let receipt: OfflineReceipt;
    if (operation.kind === "document") {
      if (!upstream.offlineDocument) throw new OfflineUnavailableError("OFFLINE_SYNC_CONTRACT_UNAVAILABLE");
      const file = operation.file;
      if (file.namespace !== this.dependencies.namespace) throw new OfflineUnavailableError("OFFLINE_FILE_NAMESPACE_MISMATCH");
      if (!fileStore.fingerprint) throw new OfflineUnavailableError("OFFLINE_FILE_VERIFICATION_UNAVAILABLE");
      let uri: string;
      try {
        uri = await fileStore.resolveURI(file);
        const fingerprint = await fileStore.fingerprint({ ...file, uri });
        if (!fingerprint) throw new OfflineUnavailableError("OFFLINE_LOCAL_FILE_MISSING");
        if (fingerprint.size !== file.size || fingerprint.sha256 !== file.sha256) throw new OfflineUnavailableError("OFFLINE_FILE_INTEGRITY_MISMATCH");
      } catch (error) {
        if (error instanceof OfflineUnavailableError) throw error;
        throw new OfflineUnavailableError("OFFLINE_LOCAL_FILE_UNREADABLE");
      }
      await assertOwner();
      receipt = await upstream.offlineDocument({ operationId: operation.id, scope, stepId: operation.stepId, sha256: file.sha256 }, { ...file, uri });
    } else {
      if (!scope.workId || !upstream.offlineCommand) throw new OfflineUnavailableError("OFFLINE_SYNC_CONTRACT_UNAVAILABLE");
      if (operation.kind === "answer" && !operation.wire) throw new OfflineUnavailableError("OFFLINE_ANSWER_TYPE_UNKNOWN");
      await assertOwner();
      const workScope: WorkScope = { ...scope, workId: scope.workId };
      const common = { operationId: operation.id, scope: workScope };
      let command: OfflineCommand;
      if (operation.kind === "comment") command = { ...common, kind: "comment", payload: { text: operation.text } };
      else if (operation.kind === "timer") command = { ...common, kind: "timer", payload: operation.payload };
      else if (operation.kind === "checklist") command = { ...common, kind: "checklist", payload: operation.payload };
      else if (operation.kind === "completion") command = { ...common, kind: "completion", payload: operation.payload };
      else if (operation.kind === "activity") command = { ...common, kind: "activity", payload: operation.payload };
      else {
        if (!operation.wire) throw new OfflineUnavailableError("OFFLINE_ANSWER_TYPE_UNKNOWN");
        command = { ...common, kind: "answer", payload: { stepId: operation.stepId, answer: operation.wire.answer, base: operation.wire.base } };
      }
      receipt = await upstream.offlineCommand(command);
    }
    const checked = this.checkedReceipt(operation.id, receipt);
    if (operation.kind === "activity" && checked.state === "applied" && checked.activityId === undefined) {
      throw new ApiError(409, "OFFLINE_INVALID_RECEIPT", "La actividad requiere verificar su confirmacion.");
    }
    if (operation.kind === "document" && checked.state === "applied"
      && !(typeof checked.fileId === "number" && Number.isSafeInteger(checked.fileId) && checked.fileId > 0
        || typeof checked.fileId === "string" && /^[1-9]\d*$/.test(checked.fileId) && Number.isSafeInteger(Number(checked.fileId)))) {
      throw new OfflineUnavailableError("OFFLINE_DOCUMENT_FILE_ID_INVALID");
    }
    return { kind: "receipt", receipt: checked };
  }
  private checkedReceipt(id: string, input: unknown): OfflineReceipt {
    if (input && typeof input === "object" && "operationId" in input && input.operationId === id && "error" in input && input.error === "MOBILE_SYNC_OPERATION_REUSED") {
      return { operationId: id, state: "needs_review", error: "MOBILE_SYNC_OPERATION_REUSED" };
    }
    if (input && typeof input === "object" && "operationId" in input && input.operationId === id && "state" in input && input.state === "in_progress") throw new ApiError(409, "MOBILE_SYNC_IN_PROGRESS", "Operación en curso.");
    const parsed = receiptSchema.safeParse(input);
    if (!parsed.success) throw new OfflineUnavailableError("OFFLINE_RECEIPT_INVALID_RESPONSE");
    const receipt = parsed.data;
    if (receipt.operationId !== id) throw new OfflineUnavailableError("OFFLINE_RECEIPT_ID_MISMATCH");
    if (receipt.error === "MOBILE_SYNC_OPERATION_REUSED") return { ...receipt, state: "needs_review" };
    if (receipt.state === "applied" && receipt.error !== undefined) throw new OfflineUnavailableError("OFFLINE_RECEIPT_INVALID_RESPONSE");
    return receipt;
  }
}
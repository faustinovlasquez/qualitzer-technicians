import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { checklistResumeTarget } from "../../../domain/checklistResume";
import type { Checklist } from "../../../domain/models";

const navigationSchema = z.object({
  checklistId: z.number().nullable(),
  stepIds: z.record(z.string(), z.string()),
});
type Selection = z.infer<typeof navigationSchema>;
interface Snapshot { selection: Selection; error: string | null; ready: boolean; needsResume: boolean; }
const stores = new Map<string, ChecklistNavigationStore>();

class ChecklistNavigationStore {
  private snapshot: Snapshot = { selection: { checklistId: null, stepIds: {} }, error: null, ready: false, needsResume: false };
  private listeners = new Set<() => void>();
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  private hydrated = false;

  constructor(private readonly key: string) { this.ready = this.hydrate(); }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): Snapshot => this.snapshot;

  private publish(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(this.key);
      const stored = raw === null ? null : navigationSchema.parse(JSON.parse(raw) as unknown);
      this.hydrated = true;
      this.publish({ ...this.snapshot, ready: true,
        ...(stored && this.revision === 0 ? { selection: stored, error: null, needsResume: stored.checklistId !== null } : {}),
      });
    } catch {
      this.publish({ ...this.snapshot, ready: true, error: "No se pudo recuperar la posición anterior. La navegación de esta sesión no altera los borradores." });
    }
  }

  private update(selection: Selection): void {
    const revision = ++this.revision;
    this.publish({ ...this.snapshot, selection, needsResume: false });
    this.tail = this.tail.then(async () => {
      await this.ready;
      if (!this.hydrated || revision !== this.revision) return;
      try {
        await AsyncStorage.setItem(this.key, JSON.stringify(selection));
        if (revision === this.revision) this.publish({ ...this.snapshot, error: null });
      } catch {
        if (revision === this.revision) this.publish({ ...this.snapshot, error: "La posición se conserva en esta sesión, pero no pudo guardarse en el dispositivo. Los borradores se gestionan por separado." });
      }
    });
  }

  resume = (checklists: readonly Checklist[]): void => {
    if (!this.snapshot.ready || !this.snapshot.needsResume) return;
    const checklist = checklists.find((item) => item.checklistId === this.snapshot.selection.checklistId);
    if (checklist) this.open(checklist);
  };
  open = (checklist: Checklist): void => {
    const { stepId } = checklistResumeTarget(checklist);
    const stepIds = { ...this.snapshot.selection.stepIds };
    const checklistId = checklist.checklistId;
    if (stepId === undefined) delete stepIds[String(checklistId)];
    else stepIds[String(checklistId)] = stepId;
    this.update({ checklistId, stepIds });
  };
  jump = (checklistId: number, stepId: string): void => {
    this.update({ checklistId, stepIds: { ...this.snapshot.selection.stepIds, [String(checklistId)]: stepId } });
  };
  catalog = (): void => { this.update({ ...this.snapshot.selection, checklistId: null }); };
}

export function useChecklistNavigation(scopeKey: string, checklists: readonly Checklist[]) {
  const store = useMemo(() => {
    const key = `@qualitzer/checklist-navigation/v1/${encodeURIComponent(scopeKey)}`;
    const existing = stores.get(key);
    if (existing) return existing;
    const created = new ChecklistNavigationStore(key);
    stores.set(key, created);
    return created;
  }, [scopeKey]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { store.resume(checklists); }, [store, checklists, snapshot.ready, snapshot.needsResume]);
  const restoring = !snapshot.ready || (snapshot.needsResume && checklists.some((item) => item.checklistId === snapshot.selection.checklistId));
  return { ...snapshot, restoring, open: store.open, jump: store.jump, catalog: store.catalog };
}
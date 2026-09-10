import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";

const navigationSchema = z.object({
  checklistId: z.number().nullable(),
  stepIds: z.record(z.string(), z.string()),
});
type Selection = z.infer<typeof navigationSchema>;
interface Snapshot { selection: Selection; error: string | null; }
const stores = new Map<string, ChecklistNavigationStore>();

class ChecklistNavigationStore {
  private snapshot: Snapshot = { selection: { checklistId: null, stepIds: {} }, error: null };
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
      if (stored && this.revision === 0) this.publish({ selection: stored, error: null });
    } catch {
      this.publish({ ...this.snapshot, error: "No se pudo recuperar la posición anterior. La navegación de esta sesión no altera los borradores." });
    }
  }

  private update(selection: Selection): void {
    const revision = ++this.revision;
    this.publish({ ...this.snapshot, selection });
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

  open = (checklistId: number, firstStepId?: string): void => {
    const { stepIds } = this.snapshot.selection;
    const stepId = stepIds[String(checklistId)] ?? firstStepId;
    this.update({ checklistId, stepIds: stepId === undefined ? stepIds : { ...stepIds, [String(checklistId)]: stepId } });
  };
  jump = (checklistId: number, stepId: string): void => {
    this.update({ checklistId, stepIds: { ...this.snapshot.selection.stepIds, [String(checklistId)]: stepId } });
  };
  catalog = (): void => { this.update({ ...this.snapshot.selection, checklistId: null }); };
}

export function useChecklistNavigation(scopeKey: string) {
  const store = useMemo(() => {
    const key = `@qualitzer/checklist-navigation/v1/${encodeURIComponent(scopeKey)}`;
    const existing = stores.get(key);
    if (existing) return existing;
    const created = new ChecklistNavigationStore(key);
    stores.set(key, created);
    return created;
  }, [scopeKey]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, open: store.open, jump: store.jump, catalog: store.catalog };
}
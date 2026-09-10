import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CreationKind } from "../../domain/creation";
import { creationDraftSchema, readCreationDraft, type CreationDraft } from "./creationForm";

const queues = new Map<string, Promise<void>>();
const generations = new Map<string, number>();
const confirmed = new Map<string, CreationDraft>();

export function creationDraftKey(storageKey: string, tenantId: string, userId: number, companyBranchId: number, kind: CreationKind, mode: "live" | "demo"): string {
  return `${storageKey}:creation:v1:${JSON.stringify([tenantId, userId, companyBranchId, kind, mode])}`;
}

function enqueue(key: string, task: () => Promise<void>): Promise<void> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

export function openCreationDraftStore(key: string, kind: CreationKind, companyBranchId: number) {
  const generation = generations.get(key) ?? 0;
  generations.set(key, generation);
  const active = (): boolean => generations.get(key) === generation;
  return {
    async read(): Promise<CreationDraft | null> {
      await queues.get(key)?.catch(() => {});
      if (!active()) throw new Error("CREATION_SESSION_CLOSED");
      const cached = confirmed.get(key);
      if (cached) return cached;
      const raw = await AsyncStorage.getItem(key);
      if (!active()) throw new Error("CREATION_SESSION_CLOSED");
      if (!raw) return null;
      const draft = readCreationDraft(raw, kind, companyBranchId);
      if (!draft) throw new Error("CREATION_DRAFT_INVALID");
      return draft;
    },
    write(draft: CreationDraft): Promise<void> {
      const safe = creationDraftSchema.parse(draft);
      if ((safe.phase === "confirmed" || safe.phase === "queued") && active()) confirmed.set(key, safe);
      return enqueue(key, async () => {
        if (!active()) throw new Error("CREATION_SESSION_CLOSED");
        await AsyncStorage.setItem(key, JSON.stringify(safe));
      });
    },
    reset(): Promise<void> {
      return enqueue(key, async () => {
        if (!active()) throw new Error("CREATION_SESSION_CLOSED");
        await AsyncStorage.removeItem(key);
        confirmed.delete(key);
      });
    },
  };
}

export async function clearCreationDrafts(storagePrefix: string): Promise<void> {
  if (!storagePrefix) return;
  const owned = (key: string): boolean => key.startsWith(storagePrefix) && key.includes(":creation:v1:");
  for (const key of generations.keys()) if (owned(key)) {
    generations.set(key, (generations.get(key) ?? 0) + 1);
    confirmed.delete(key);
  }
  await Promise.all([...queues].filter(([key]) => owned(key)).map(([, task]) => task.catch(() => {})));
  const keys = (await AsyncStorage.getAllKeys()).filter(owned);
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
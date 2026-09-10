import type { DeliveryDraft } from "./lifecycleRules";

interface DraftEntry { value: DeliveryDraft; expiresAt: number; }
const drafts = new Map<string, DraftEntry>();
const maxDrafts = 8;
const lifetimeMs = 30 * 60 * 1000;

function expireDrafts(): void {
  for (const [key, entry] of drafts) if (entry.expiresAt <= Date.now()) drafts.delete(key);
}

export function readLifecycleDraft(key: string): DeliveryDraft | null {
  expireDrafts();
  return drafts.get(key)?.value ?? null;
}

export function saveLifecycleDraft(key: string, value: DeliveryDraft): void {
  expireDrafts();
  drafts.delete(key);
  while (drafts.size >= maxDrafts) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
  drafts.set(key, { value, expiresAt: Date.now() + lifetimeMs });
}

export function deleteLifecycleDraft(key: string): void { drafts.delete(key); }

export function clearOrderLifecycleDrafts(storagePrefix: string): void {
  for (const key of drafts.keys()) if (key.startsWith(storagePrefix)) drafts.delete(key);
}
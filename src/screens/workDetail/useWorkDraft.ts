import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { z } from "zod";
import type { AssignmentGroup, ChecklistStep, LocalPhoto, StepAnswer } from "../../domain/models";
import { answerFromStep } from "../../domain/format";
import { answerSignature, errorMessage } from "./detailRules";
import { deleteLocalPhotoDirectory } from "./localPhotos";

const answerSchema = z.object({
  responseValue: z.union([z.string(), z.boolean(), z.array(z.object({ value: z.string(), label: z.string() }))]).nullable(),
  isCompleted: z.boolean(), executionStatus: z.enum(["completed", "partial", "not_completed"]).nullable(), comment: z.string().nullable(),
});
const draftSchema = z.object({
  version: z.literal(1), report: z.string(), savedReport: z.string().nullable(),
  answers: z.record(z.string(), z.object({ answer: answerSchema, saved: z.boolean(), baseline: z.string() })),
  photos: z.array(z.object({ photo: z.object({ id: z.string(), uri: z.string(), name: z.string(), mimeType: z.string(), size: z.number().optional() }), stepId: z.string().optional(), uploaded: z.boolean() })),
});
export type WorkDraft = z.infer<typeof draftSchema>;
export type AnswerDraft = WorkDraft["answers"][string];
export type PendingPhoto = WorkDraft["photos"][number];
interface DraftSnapshot { data: WorkDraft; hydrated: boolean; saving: boolean; error: string | null; }
const emptyDraft = (): WorkDraft => ({ version: 1, report: "", savedReport: null, answers: {}, photos: [] });
const stores = new Map<string, DraftStore>();

function namespace(storageKey: string): string {
  return `@qualitzer/work-detail/v1/${encodeURIComponent(storageKey)}/`;
}

export function workDetailDraftKey(storageKey: string, mode: "live" | "demo", group: Pick<AssignmentGroup, "type" | "id">, workId: string): string {
  return `${namespace(storageKey)}${mode}/${encodeURIComponent(JSON.stringify([group.type, group.id, workId]))}`;
}

export function displayedAnswer(step: ChecklistStep, draft: AnswerDraft | undefined): StepAnswer {
  if (!draft || (draft.saved && draft.baseline !== answerSignature(step))) return answerFromStep(step);
  return draft.answer;
}

class DraftStore {
  private snapshot: DraftSnapshot = { data: emptyDraft(), hydrated: false, saving: false, error: null };
  private listeners = new Set<() => void>();
  private revision = 0;
  private reportTouched = false;
  private photosTouched = false;
  private tail: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  private closed = false;

  constructor(readonly key: string) { this.ready = this.hydrate(); }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): DraftSnapshot => this.snapshot;

  private publish(update: Partial<DraftSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(this.key);
      const stored = raw === null ? emptyDraft() : draftSchema.parse(JSON.parse(raw) as unknown);
      if (this.closed) return;
      const current = this.snapshot.data;
      this.publish({ hydrated: true, error: null, data: {
        ...stored,
        report: this.reportTouched ? current.report : stored.report,
        savedReport: this.reportTouched ? current.savedReport : stored.savedReport,
        answers: { ...stored.answers, ...current.answers },
        photos: this.photosTouched ? current.photos : Platform.OS === "web" ? [] : stored.photos,
      } });
      if (this.revision > 0) this.persist();
    } catch (error) {
      if (!this.closed) this.publish({ error: `No se pudo recuperar el borrador. No se sobrescribirá: ${errorMessage(error)}`, saving: false });
    }
  }

  private persist(): void {
    if (this.closed || !this.snapshot.hydrated) return;
    const revision = this.revision;
    const data = this.snapshot.data;
    this.publish({ saving: true });
    this.tail = this.tail.then(async () => {
      if (this.closed || revision !== this.revision) return;
      try {
        await AsyncStorage.setItem(this.key, JSON.stringify(Platform.OS === "web" ? { ...data, photos: [] } : data));
        if (!this.closed && revision === this.revision) this.publish({ saving: false, error: null });
      } catch (error) {
        if (!this.closed && revision === this.revision) this.publish({ saving: false, error: `Borrador aún no protegido en el dispositivo: ${errorMessage(error)}` });
      }
    });
  }

  private update(data: WorkDraft): void {
    if (this.closed) return;
    this.revision += 1;
    this.publish({ data });
    this.persist();
  }

  setReport = (report: string): void => {
    this.reportTouched = true;
    this.update({ ...this.snapshot.data, report });
  };

  confirmReport = (submitted: string): void => {
    this.reportTouched = true;
    this.update({ ...this.snapshot.data, savedReport: submitted });
  };

  setAnswer = (step: ChecklistStep, answer: StepAnswer): void => {
    this.update({ ...this.snapshot.data, answers: { ...this.snapshot.data.answers, [String(step.stepId)]: { answer, saved: false, baseline: answerSignature(step) } } });
  };

  discardAnswer = (step: ChecklistStep): void => {
    const answers = { ...this.snapshot.data.answers };
    delete answers[String(step.stepId)];
    this.update({ ...this.snapshot.data, answers });
  };

  confirmAnswer = (step: ChecklistStep, submitted: StepAnswer): void => {
    const id = String(step.stepId);
    const current = this.snapshot.data.answers[id];
    if (current && JSON.stringify(current.answer) !== JSON.stringify(submitted)) return;
    this.update({ ...this.snapshot.data, answers: { ...this.snapshot.data.answers, [id]: { answer: submitted, saved: true, baseline: answerSignature(step) } } });
  };

  setPhotos = (photos: PendingPhoto[]): void => {
    this.photosTouched = true;
    this.update({ ...this.snapshot.data, photos });
  };

  addPhotos = (photos: LocalPhoto[], stepId?: string): void => {
    this.setPhotos([...this.snapshot.data.photos, ...photos.map((photo) => ({ photo, stepId, uploaded: false }))]);
  };

  flush = async (): Promise<void> => {
    await this.ready;
    let pending: Promise<void>;
    do { pending = this.tail; await pending; } while (pending !== this.tail);
    if (this.closed) throw new Error("La sesión de borradores está cerrada.");
    if (!this.snapshot.hydrated || this.snapshot.error) throw new Error(this.snapshot.error ?? "No se pudo recuperar el borrador.");
  };

  retry = async (): Promise<void> => {
    if (this.closed) return;
    if (!this.snapshot.hydrated) this.ready = this.hydrate();
    else this.persist();
    await this.flush();
  };

  close = async (): Promise<void> => {
    this.closed = true;
    await this.ready;
    await this.tail;
    this.publish({ data: emptyDraft(), hydrated: false, saving: false, error: "Sesión de borradores cerrada." });
  };
}

export function useWorkDraft(key: string) {
  const store = useMemo(() => {
    const existing = stores.get(key);
    if (existing) return existing;
    const created = new DraftStore(key);
    stores.set(key, created);
    return created;
  }, [key]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, store };
}

export async function clearWorkDetailDrafts(storageKey: string): Promise<void> {
  const prefix = namespace(storageKey);
  const entries = [...stores.entries()].filter(([key]) => key.startsWith(prefix));
  await Promise.all(entries.map(([, store]) => store.close()));
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  await deleteLocalPhotoDirectory(storageKey);
  for (const [key] of entries) stores.delete(key);
}
import type { LocalPhoto } from "../../../domain/models";
import { queueOwnsDocument } from "../../offline/offlineUi";
import { errorMessage } from "../detailRules";
import type { WorkspaceDraftStore } from "./WorkspaceDraftStore";

interface FileBatchOptions {
  store: Pick<WorkspaceDraftStore, "flush" | "getSnapshot" | "validateFile" | "confirmFile">;
  upload: (files: LocalPhoto[]) => Promise<void>;
  canContinue: () => boolean;
  requireSource: boolean;
  onProgress: (index: number, total: number, name: string) => void;
  fileIds?: readonly string[];
}

export async function saveFileBatch({ store, upload, canContinue, requireSource, onProgress, fileIds }: FileBatchOptions) {
  let saved = 0;
  let queued = 0;
  let failure: string | null = null;
  try {
    await store.flush();
    const selected = store.getSnapshot().files.filter((file) => !file.uploaded && (fileIds === undefined || fileIds.includes(file.id)));
    for (const [index, file] of selected.entries()) {
      if (!canContinue() || store.getSnapshot().closed) throw new Error("Envío detenido; los pendientes se conservan.");
      onProgress(index + 1, selected.length, file.name);
      store.validateFile(file, requireSource);
      const { id, uri, name, mimeType, size } = file;
      try {
        await upload([{ id, uri, name, mimeType, size }]);
        saved += 1;
      } catch (error) {
        if (!queueOwnsDocument(error)) throw error;
        queued += 1;
      }
      await store.confirmFile(id);
    }
  } catch (error) { failure = errorMessage(error); }
  return { saved, queued, failure };
}
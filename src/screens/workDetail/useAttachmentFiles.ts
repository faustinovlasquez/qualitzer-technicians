import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "../../domain/models";
import { errorMessage } from "./detailRules";

export function useAttachmentFiles(identity: string, onLoadFiles: () => Promise<Attachment[]>) {
  const callback = useRef(onLoadFiles);
  callback.current = onLoadFiles;
  const generation = useRef(0);
  const active = useRef(false);
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const request = ++generation.current;
    if (active.current) setLoading(true);
    try {
      const result = await callback.current();
      if (active.current && request === generation.current) { setFiles(result); setError(null); }
    } catch (failure) {
      if (active.current && request === generation.current) setError(`No se pudieron cargar las evidencias: ${errorMessage(failure)}`);
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [identity]);

  useEffect(() => {
    active.current = true;
    setFiles(null);
    void load();
    return () => { active.current = false; generation.current += 1; };
  }, [load]);

  return { files, loading, error, load };
}
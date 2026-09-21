import { AssignmentReadCancelledError, type AssignmentReadOptions } from "../domain/assignmentRead";
import { NetworkError } from "./errors";

export const ASSIGNMENT_READ_TIMEOUT_MS = 45_000;

export class AssignmentReadBatch {
  private readonly controller = new AbortController();
  private failure: { error: unknown } | undefined;
  private rejectFailure!: (error: unknown) => void;
  private readonly interrupted = new Promise<never>((_resolve, reject) => { this.rejectFailure = reject; });
  readonly signal = this.controller.signal;

  constructor() { void this.interrupted.catch(() => undefined); }

  fail(error: unknown): void {
    if (this.failure) return;
    this.failure = { error };
    this.rejectFailure(error);
    this.controller.abort();
  }

  check(): void {
    if (this.failure) throw this.failure.error;
  }

  async wait<T>(action: () => Promise<T>): Promise<T> {
    this.check();
    const value = await Promise.race([action(), this.interrupted]);
    this.check();
    return value;
  }

  async map<T, R>(items: readonly T[], read: (item: T) => Promise<R>, priority?: () => T | null | undefined): Promise<R[]> {
    const pending = items.map((item, index) => ({ item, index }));
    const results: R[] = [];
    await this.wait(() => Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
      while (pending.length > 0) {
        this.check();
        const preferred = priority?.();
        const position = Math.max(0, pending.findIndex(entry => Object.is(entry.item, preferred)));
        const next = pending.splice(position, 1)[0];
        try { results[next.index] = await this.wait(() => read(next.item)); }
        catch (error) { this.fail(error); throw error; }
      }
    })));
    return results;
  }
}

export async function withAssignmentReadBatch<T>(options: AssignmentReadOptions | undefined, read: (batch: AssignmentReadBatch) => Promise<T>): Promise<T> {
  const batch = new AssignmentReadBatch();
  const cancel = () => batch.fail(new AssignmentReadCancelledError());
  const timeout = setTimeout(() => batch.fail(new NetworkError("timeout", "La consulta de asignaciones superó los 45 segundos. Vuelve a intentar.")), ASSIGNMENT_READ_TIMEOUT_MS);
  options?.signal?.addEventListener("abort", cancel, { once: true });
  if (options?.signal?.aborted) cancel();
  try { return await batch.wait(() => read(batch)); }
  catch (error) { batch.fail(error); throw error; }
  finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", cancel);
  }
}
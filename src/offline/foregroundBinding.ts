import type { OfflineController } from "../domain/offline";

export interface ForegroundSource {
  current(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}

export function bindForegroundSource(controller: Pick<OfflineController, "setForeground">, source: ForegroundSource): () => void {
  const unsubscribe = source.subscribe((active) => controller.setForeground(active));
  controller.setForeground(source.current());
  return unsubscribe;
}

export function appStateIsForeground(state: string | null): boolean { return state === "active"; }
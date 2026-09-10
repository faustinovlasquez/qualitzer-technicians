import type { OfflineController } from "../domain/offline";
import { bindForegroundSource, type ForegroundSource } from "./foregroundBinding";

export function createWebForegroundSource(documentTarget: EventTarget & { readonly visibilityState: string }, windowTarget: EventTarget): ForegroundSource {
  let active = documentTarget.visibilityState !== "hidden";
  return {
    current: () => active,
    subscribe: (listener) => {
      const update = (value: boolean) => { active = value; listener(value); };
      const visibility = () => update(documentTarget.visibilityState !== "hidden");
      const returnToPage = () => update(true);
      const pageHide = () => update(false);
      documentTarget.addEventListener("visibilitychange", visibility);
      windowTarget.addEventListener("focus", returnToPage);
      windowTarget.addEventListener("pageshow", returnToPage);
      windowTarget.addEventListener("pagehide", pageHide);
      return () => {
        documentTarget.removeEventListener("visibilitychange", visibility);
        windowTarget.removeEventListener("focus", returnToPage);
        windowTarget.removeEventListener("pageshow", returnToPage);
        windowTarget.removeEventListener("pagehide", pageHide);
      };
    },
  };
}

export function readForeground(): boolean { return typeof document === "undefined" || document.visibilityState !== "hidden"; }
export function subscribeForeground(listener: (active: boolean) => void): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => undefined;
  return createWebForegroundSource(document, window).subscribe(listener);
}
export function bindForeground(controller: Pick<OfflineController, "setForeground">): () => void {
  return bindForegroundSource(controller, { current: readForeground, subscribe: subscribeForeground });
}
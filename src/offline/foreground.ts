import { AppState } from "react-native";
import type { OfflineController } from "../domain/offline";
import { appStateIsForeground, bindForegroundSource } from "./foregroundBinding";

export function readForeground(): boolean { return appStateIsForeground(AppState.currentState); }
export function subscribeForeground(listener: (active: boolean) => void): () => void {
  const subscription = AppState.addEventListener("change", (state) => listener(appStateIsForeground(state)));
  return () => subscription.remove();
}
export function bindForeground(controller: Pick<OfflineController, "setForeground">): () => void {
  return bindForegroundSource(controller, { current: readForeground, subscribe: subscribeForeground });
}
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import { AppState, Platform } from "react-native";
import { usableLocationFix, type LocationFix } from "../domain/locationTracking";

const taskName = "qualitzer-labor-location-v1";
const scheduleTask = "qualitzer-labor-location-schedule-v1";
let operations: Promise<void> = Promise.resolve();
async function stop(): Promise<void> { if (await Location.hasStartedLocationUpdatesAsync(taskName)) await Location.stopLocationUpdatesAsync(taskName); }
export async function reconcileLocationTracking(): Promise<void> {
  const run = async () => {
    await stop();
    if (await TaskManager.isTaskRegisteredAsync(scheduleTask)) await BackgroundTask.unregisterTaskAsync(scheduleTask);
  };
  const next = operations.then(run, run); operations = next.catch(() => {}); return next;
}
export async function requestLocationPermissions(): Promise<boolean> {
  if (AppState.currentState !== "active") return false;
  const permission = await Location.getForegroundPermissionsAsync();
  const granted = permission.granted || permission.canAskAgain && (await Location.requestForegroundPermissionsAsync()).granted;
  if (!granted) return false;
  if (!await Location.hasServicesEnabledAsync()) {
    if (Platform.OS === "android") await Location.enableNetworkProviderAsync();
    if (!await Location.hasServicesEnabledAsync()) throw new Error("Activa la ubicación del teléfono para registrar las acciones con coordenadas.");
  }
  return true;
}
export async function locationPermissionReady(): Promise<boolean> { return (await Location.getForegroundPermissionsAsync()).granted && await Location.hasServicesEnabledAsync(); }
export async function scheduleLocationChecks(_enabled: boolean): Promise<void> {
  await reconcileLocationTracking();
}
export async function currentLocationFix(minCapturedAt = 0): Promise<LocationFix | null> {
  if (AppState.currentState !== "active" || !(await Location.getForegroundPermissionsAsync()).granted || !await Location.hasServicesEnabledAsync()) return null;
  const previous = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 100 });
  if (previous && previous.timestamp >= minCapturedAt && usableLocationFix(previous, Date.now())) return previous;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false }), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 10000); })]);
  } finally { if (timer) clearTimeout(timer); }
}
TaskManager.defineTask(taskName, async () => { await reconcileLocationTracking(); });
TaskManager.defineTask(scheduleTask, async () => {
  try { await reconcileLocationTracking(); return BackgroundTask.BackgroundTaskResult.Success; }
  catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});
export const locationTrackingAvailable = true;
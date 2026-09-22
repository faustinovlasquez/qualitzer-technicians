import type { LocationFix } from "../domain/locationTracking";
export const locationTrackingAvailable = false;
export async function locationPermissionReady(): Promise<boolean> { return false; }
export async function reconcileLocationTracking(): Promise<void> {}
export async function requestLocationPermissions(): Promise<boolean> { return false; }
export async function scheduleLocationChecks(_enabled: boolean): Promise<void> {}
export async function currentLocationFix(_minCapturedAt = 0): Promise<LocationFix | null> { return null; }
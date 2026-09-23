import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking } from "react-native";
import * as Crypto from "expo-crypto";
import type { Session } from "../domain/models";
import type { OfflineSnapshot } from "../domain/offline";
import type { TechnicianRepository } from "../domain/TechnicianRepository";
import { tenantStorageNamespace } from "../domain/tenantSession";
import { locationAckSchema, locationHistorySchema, locationDate, locationWorkingDay, type LocationActionRecorder, type LocationSchedule } from "../domain/locationTracking";
import { useTrustedNativePicker } from "../security/useTrustedNativePicker";
import { createDurableStore } from "../offline/DurableStore";
import { currentLocationFix, locationPermissionReady, locationTrackingAvailable, reconcileLocationTracking, requestLocationPermissions, scheduleLocationChecks } from "./locationRuntime";
import { LocationJournal, type LocationJournalState } from "./LocationJournal";
import { useDeviceSecurity } from "../security/DeviceSecurityContext";

export interface LocationTrackingUi {
  state: LocationJournalState | null; available: boolean; busy: boolean; error: string | null; timezone: string;
  save(schedule: LocationSchedule, enabled: boolean): Promise<void>;
  capture: LocationActionRecorder;
  synchronize?(): Promise<void>;
  history(date: string, page: number, resource?: import("../domain/locationTracking").LocationHistoryResource): Promise<import("zod").infer<typeof locationHistorySchema>>;
}
export function useLocationTracking(session: Session | null, gatewayUrl: string, offline: OfflineSnapshot | null, verifiedAt: number | null, port: Pick<TechnicianRepository, "uploadLocations" | "locationHistory"> | null, allowPrompt = true): LocationTrackingUi {
  const nativePicker = useTrustedNativePicker();
  const security = useDeviceSecurity();
  const [state, setState] = useState<LocationJournalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<{ journal: LocationJournal; generation: string } | null>(null);
  const latest = useRef({ offline, port, verifiedAt, state, security }); latest.current = { offline, port, verifiedAt, state, security };
  const sending = useRef(false);
  const synchronize = useRef<(() => Promise<void>) | null>(null);
  const retry = useRef({ after: 0, failures: 0 });
  const prompted = useRef<string | null>(null);
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const key = session ? JSON.stringify([tenantStorageNamespace(session, gatewayUrl, session.branchId), session.user.workerId]) : null;
  useEffect(() => {
    let cancelled = false;
    let bound: { journal: LocationJournal; generation: string } | null = null;
    setState(null); setError(null);
    const initialize = async () => {
      if (!locationTrackingAvailable) return;
      const store = await createDurableStore();
      if (cancelled) return;
      if (!locationTrackingAvailable || !session || session.mode !== "live" || !session.branchId || !session.user.workerId || !key) {
        const previous = await LocationJournal.active(store); await previous?.deactivate(); await scheduleLocationChecks(false); setState(null); return;
      }
      const journal = new LocationJournal(store, { namespace: `location:${key}`, userId: session.user.id, workerId: session.user.workerId, companyBranchId: session.branchId, timezone: session.user.system.timezone });
      const generation = Crypto.randomUUID();
      await journal.activate(generation, (latest.current.verifiedAt ?? 0) + 24 * 3600000);
      bound = { journal, generation };
      if (cancelled) { await journal.deactivate(); return; }
      current.current = bound; prompted.current = null; retry.current = { after: 0, failures: 0 }; setState(await journal.read());
      await scheduleLocationChecks((await journal.read()).settings.enabled);
      if (!cancelled && current.current === bound) setState(await journal.read());
    };
    lifecycle.current = lifecycle.current.then(initialize, initialize).catch(() => { if (!cancelled) setError("No se pudo preparar el almacenamiento de ubicación."); });
    const tick = async () => {
      const active = current.current;
      if (cancelled || !active) return;
      if (latest.current.offline?.authBlocked) { await active.journal.deactivate(); await scheduleLocationChecks(false); return; }
      const verified = latest.current.verifiedAt;
      if (verified && (await active.journal.read()).validUntil !== verified + 24 * 3600000) await active.journal.change(value => { value.validUntil = verified + 24 * 3600000; });
      await reconcileLocationTracking();
      if (cancelled) return;
      let value = await active.journal.read();
      if (cancelled || current.current !== active) return;
      setState(value);
      const uploadPort = latest.current.port;
      if (AppState.currentState !== "active" || !latest.current.security.isUnlocked() || !latest.current.offline?.online || latest.current.offline.authBlocked || !uploadPort?.uploadLocations || sending.current || value.points.length === 0 || Date.now() < retry.current.after) return;
      sending.current = true;
      try {
        const points = value.points.slice(0, 50);
        const response = locationAckSchema.parse(await uploadPort.uploadLocations(active.journal.owner.companyBranchId, points, { userId: active.journal.owner.userId, workerId: active.journal.owner.workerId }));
        await active.journal.acknowledge(points, response.acceptedIds);
        value = await active.journal.read(); if (!cancelled) { retry.current = { after: 0, failures: 0 }; setState(value); setError(null); }
      } catch { if (!cancelled) { const failures = Math.min(retry.current.failures + 1, 5); retry.current = { failures, after: Date.now() + Math.min(300000, 30000 * 2 ** failures) }; setError("Ubicaciones conservadas en el teléfono. No se pudo confirmar la sincronización."); } }
      finally { sending.current = false; }
    };
    const run = () => { if (AppState.currentState === "active") void tick().catch(() => { if (!cancelled) setError("Revisa permisos y almacenamiento de ubicación."); }); };
    synchronize.current = tick;
    void lifecycle.current.then(run);
    const timer = setInterval(run, 30000);
    const subscription = AppState.addEventListener("change", run);
    return () => {
      cancelled = true; clearInterval(timer); subscription.remove();
      if (synchronize.current === tick) synchronize.current = null;
      if (current.current === bound) current.current = null;
      lifecycle.current = lifecycle.current.then(async () => {
        if (bound) await bound.journal.change(value => { if (value.generation === bound?.generation) { value.active = false; value.generation = ""; } });
        if (locationTrackingAvailable) await reconcileLocationTracking();
      }).catch(() => {});
    };
  }, [key, session?.token]);

  useEffect(() => {
    if (!offline?.authBlocked || !locationTrackingAvailable) return;
    void (async () => { await current.current?.journal.deactivate(); await scheduleLocationChecks(false); })().catch(() => setError("No se pudo detener el servicio. Revoca el permiso de ubicación en Ajustes."));
  }, [offline?.authBlocked]);

  const save = async (schedule: LocationSchedule, enabled: boolean) => {
    const active = current.current; if (!active || busy) return;
    setBusy(true); setError(null);
    try {
      if (enabled && !await nativePicker(requestLocationPermissions)) throw new Error("Permiso de ubicación denegado. Puedes permitirlo durante el uso desde Ajustes del teléfono.");
      if (current.current !== active || !latest.current.security.isUnlocked()) return;
      const prior = await active.journal.read();
      await active.journal.configure({ enabled, schedule, consentVersion: 2, consentedAt: enabled ? prior.settings.enabled && prior.settings.consentVersion === 2 ? prior.settings.consentedAt : new Date().toISOString() : prior.settings.consentedAt });
      await active.journal.change(value => { value.actionConsentPrompted = true; });
      setState(await active.journal.read()); await scheduleLocationChecks(enabled);
      if (current.current === active) setState(await active.journal.read());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo cambiar el seguimiento."); }
    finally { setBusy(false); }
  };
  const capture: LocationActionRecorder = useCallback((action, scope, targetId) => {
    const active = current.current;
    const snapshot = latest.current.state;
    const capturedAt = Date.now();
    if (!active || !snapshot?.active || snapshot.generation !== active.generation || !snapshot.settings.enabled || snapshot.settings.consentVersion !== 2 || !snapshot.settings.consentedAt
      || capturedAt >= snapshot.validUntil || latest.current.offline?.authBlocked || !latest.current.security.isUnlocked() || AppState.currentState !== "active" || scope.companyBranchId !== active.journal.owner.companyBranchId) return async () => {};
    const id = Crypto.randomUUID();
    const fix = currentLocationFix(capturedAt).catch(() => null);
    let completed = false;
    return async (actionState, operationId, resource) => {
      if (completed) return; completed = true;
      try {
        const position = await fix;
        if (current.current !== active || latest.current.offline?.authBlocked) return;
        const permission = await locationPermissionReady();
        const target = resource ?? scope;
        const recorded = await active.journal.recordAction(active.generation, id, permission ? position : null, { action, actionState, capturedAt, operationId, groupId: target.groupId,
          ...(target.workId?.startsWith("local-") ? { localWorkId: target.workId.slice(6) } : target.workId ? { workId: Number(target.workId) } : {}), ...(targetId ? { targetId } : {}) });
        if (current.current === active) {
          setState(await active.journal.read());
          if (!recorded) setError("No se conservó la ubicación de esta acción. Revisa el estado del registro y verifica tu sesión.");
          else void synchronize.current?.().catch(() => { if (current.current === active) setError("Ubicación guardada en el teléfono. Pendiente de sincronizar."); });
        }
      } catch { if (current.current === active) setError("La acción se guardó, pero no se pudo conservar su registro de ubicación."); }
    };
  }, [key]);
  useEffect(() => {
    const active = current.current;
    if (!active || !state || !key || !allowPrompt || security.blocked || busy || AppState.currentState !== "active" || offline?.authBlocked || prompted.current === key) return;
    prompted.current = key;
    const isCurrent = () => current.current === active && latest.current.security.isUnlocked();
    const skip = () => { if (isCurrent()) void active.journal.change(value => { value.actionConsentPrompted = true; }).then(value => { if (isCurrent()) setState(value); }).catch(() => setError("No se pudo guardar la preferencia de ubicación.")); };
    if (!state.actionConsentPrompted) {
      Alert.alert("Ubicación de tus acciones", "Qualitzer registrará la ubicación al iniciar, pausar o entregar trabajos, modificar actividades o checklists, cambiar el equipo e iniciar o entregar órdenes. Solo mientras usas la app, sin seguimiento continuo. Los registros se enviarán a tu empresa.", [
        { text: "Ahora no", style: "cancel", onPress: skip }, { text: "Continuar", onPress: () => { if (isCurrent()) void save(state.settings.schedule, true); } },
      ], { cancelable: false });
    } else if (state.settings.enabled && state.settings.consentVersion === 2) {
      void locationPermissionReady().then(ready => {
        if (ready || !isCurrent()) return;
        Alert.alert("Activa la ubicación", "Permite la ubicación durante el uso y activa el GPS para asociar coordenadas a tus acciones.", [
          { text: "Ahora no", style: "cancel" }, { text: "Permitir", onPress: () => { if (isCurrent()) void save(state.settings.schedule, true); } },
          { text: "Ajustes", onPress: () => { if (isCurrent()) void Linking.openSettings(); } },
        ]);
      }).catch(() => { if (isCurrent()) setError("No se pudo comprobar el permiso de ubicación."); });
    }
  }, [key, state?.generation, allowPrompt, security.blocked, busy, offline?.authBlocked]);
  const history = async (date: string, page: number, resource?: import("../domain/locationTracking").LocationHistoryResource) => {
    const active = current.current; const reader = latest.current.port;
    if (!active || !reader?.locationHistory || !latest.current.offline?.online || latest.current.offline.authBlocked) throw new Error("Conecta la app para consultar el historial sincronizado.");
    const result = locationHistorySchema.parse(await reader.locationHistory(active.journal.owner.companyBranchId, date, page, resource));
    if (current.current !== active || latest.current.port !== reader) throw new Error("La sesión cambió durante la consulta.");
    if (result.page !== page || result.items.some(({ point }) => point.companyBranchId !== active.journal.owner.companyBranchId
      || (point.kind === "action" ? locationDate(point.schedule, Date.parse(point.capturedAt)) : locationWorkingDay(point.schedule, Date.parse(point.capturedAt))) !== date || resource && (point.groupId !== resource.groupId || resource.workId !== undefined && point.workId !== resource.workId))) throw new Error("El historial recibido no corresponde a la consulta.");
    return result;
  };
  const syncNow = async () => {
    retry.current.after = 0;
    try { await synchronize.current?.(); } catch { setError("No se pudo sincronizar el historial. Los puntos pendientes se conservan."); }
  };
  return { state: current.current?.journal.owner.namespace === `location:${key}` ? state : null, available: locationTrackingAvailable, busy, error, timezone: session?.user.system.timezone ?? "UTC", save, capture, history, synchronize: syncNow };
}
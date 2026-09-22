import { z } from "zod";
import type { DurableStore } from "../offline/contracts";
import { updateState } from "../offline/state";
import { defaultLocationSchedule, locationPointSchema, locationSettingsSchema, locationWorkingDay, shouldRecordPeriodic, usableLocationFix, type LocationActionEvent, type LocationFix, type LocationPoint, type LocationSettings } from "../domain/locationTracking";

const controlNamespace = "location-control-v1";
const journalSchema = z.object({ settings: locationSettingsSchema, generation: z.string(), active: z.boolean(), activatedAt: z.number(), validUntil: z.number(),
  actionConsentPrompted: z.boolean().optional(),
  points: z.array(locationPointSchema).max(5000), lastPeriodicAt: z.string().optional(), lastSyncedAt: z.string().optional(), issue: z.string().nullable() });
export type LocationJournalState = z.infer<typeof journalSchema>;
export function locationTrackingStatus(state: LocationJournalState | null, now = Date.now()): string {
  if (!state) return "Preparando el registro de ubicación.";
  if (!state.settings.enabled) return "Registro de ubicación desactivado en este teléfono.";
  if (!state.active || now >= state.validUntil) return "Registro detenido: conecta y verifica tu sesión.";
  if (state.settings.consentVersion !== 2) return "Autoriza el registro de ubicación por acciones. El seguimiento periódico está detenido.";
  return state.issue ?? "Ubicación vinculada a las acciones. Sin seguimiento continuo.";
}
export interface LocationOwner { namespace: string; userId: number; workerId: number; companyBranchId: number; timezone: string; }
export class LocationJournal {
  constructor(readonly store: DurableStore, readonly owner: LocationOwner, private readonly now = Date.now) {}
  async read(): Promise<LocationJournalState> {
    const cache = (await this.store.read(this.owner.namespace)).cache.find(entry => entry.key === "location-journal");
    return cache ? journalSchema.parse(JSON.parse(cache.json)) : { settings: { enabled: false, consentVersion: 1, consentedAt: null, schedule: defaultLocationSchedule(this.owner.timezone) },
      generation: "", active: false, activatedAt: 0, validUntil: 0, points: [], issue: null };
  }
  async change(action: (state: LocationJournalState) => void): Promise<LocationJournalState> {
    let value = await this.read();
    await updateState(this.store, this.owner.namespace, state => {
      const entry = state.cache.find(entry => entry.key === "location-journal");
      const next = entry ? journalSchema.parse(JSON.parse(entry.json)) : structuredClone(value);
      action(next); value = journalSchema.parse(next);
      state.cache = [{ key: "location-journal", json: JSON.stringify(value), fetchedAt: this.now() }];
    });
    return value;
  }
  async activate(generation: string, validUntil = this.now() + 24 * 3600000): Promise<void> {
    const before = await LocationJournal.active(this.store);
    if (before && before.owner.namespace !== this.owner.namespace) await before.change(state => { state.active = false; });
    await this.change(state => { state.active = true; state.generation = generation; state.activatedAt = this.now(); state.validUntil = validUntil; });
    await updateState(this.store, controlNamespace, state => { state.cache = [{ key: "active", json: JSON.stringify(this.owner), fetchedAt: this.now() }]; });
  }
  async deactivate(): Promise<void> { await this.change(state => { state.active = false; state.generation = ""; }); }
  static async active(store: DurableStore): Promise<LocationJournal | null> {
    const entry = (await store.read(controlNamespace)).cache.find(item => item.key === "active");
    if (!entry) return null;
    const owner = z.object({ namespace: z.string(), userId: z.number().int().positive(), workerId: z.number().int().positive(), companyBranchId: z.number().int().positive(), timezone: z.string() }).strict().parse(JSON.parse(entry.json));
    return new LocationJournal(store, owner);
  }
  async record(generation: string, id: string, fix: LocationFix | null, event?: { kind: "work_started" | "order_started"; groupId: string; workId?: number; operationId?: string; capturedAt: number }): Promise<boolean> {
    let saved = false;
    await this.change(state => {
      saved = false;
      const now = this.now(); const captured = event?.capturedAt ?? fix?.timestamp ?? now;
      if (!state.active || state.generation !== generation || now >= state.validUntil || !state.settings.enabled || !state.settings.consentedAt
        || captured < state.activatedAt || captured > now || captured < Date.parse(state.settings.consentedAt) || !locationWorkingDay(state.settings.schedule, captured)) return;
      if (state.points.some(point => point.id === id || event?.operationId && point.operationId === event.operationId && point.kind === event.kind)) return;
      if (!event && (!fix || !shouldRecordPeriodic(state.settings.schedule, fix, captured, state.lastPeriodicAt) || now - captured > 600000)) return;
      if (state.points.length >= 5000) { state.issue = "El historial local está lleno. Conecta la app para sincronizar; no se han borrado pendientes."; return; }
      const located = fix !== null && usableLocationFix(fix, captured) && fix.timestamp >= Date.parse(state.settings.consentedAt)
        && locationWorkingDay(state.settings.schedule, fix.timestamp) === locationWorkingDay(state.settings.schedule, captured);
      const point = locationPointSchema.parse({ id, companyBranchId: this.owner.companyBranchId, capturedAt: new Date(captured).toISOString(),
        locationAt: located ? new Date(fix.timestamp).toISOString() : null, latitude: located ? fix.coords.latitude : null,
        longitude: located ? fix.coords.longitude : null, accuracy: located ? fix.coords.accuracy : null, mocked: fix?.mocked === true,
        kind: event?.kind ?? "periodic", outcome: located ? "located" : "unavailable", schedule: state.settings.schedule,
        consentedAt: state.settings.consentedAt, consentVersion: 1,
        ...(event ? { groupId: event.groupId, ...(event.workId ? { workId: event.workId } : {}), ...(event.operationId ? { operationId: event.operationId } : {}) } : {}) });
      state.points.push(point); if (!event) state.lastPeriodicAt = point.capturedAt; state.issue = null; saved = true;
    });
    return saved;
  }
  async acknowledge(sent: readonly LocationPoint[], acceptedIds: readonly string[]): Promise<void> {
    const expected = new Set(sent.map(point => point.id));
    if (acceptedIds.length !== new Set(acceptedIds).size || acceptedIds.some(id => !expected.has(id))) throw new Error("LOCATION_INVALID_ACK");
    await this.change(state => { const accepted = new Set(acceptedIds); state.points = state.points.filter(point => !accepted.has(point.id)); state.lastSyncedAt = new Date(this.now()).toISOString(); });
  }
  async recordAction(generation: string, id: string, fix: LocationFix | null, event: LocationActionEvent): Promise<boolean> {
    let saved = false;
    await this.change(state => {
      saved = false;
      if (!state.active || state.generation !== generation || this.now() >= state.validUntil || !state.settings.enabled || state.settings.consentVersion !== 2 || !state.settings.consentedAt
        || event.capturedAt < state.activatedAt || event.capturedAt < Date.parse(state.settings.consentedAt) || event.capturedAt > this.now()) return;
      if (state.points.some(point => point.id === id || event.operationId && point.operationId === event.operationId && point.action === event.action)) return;
      if (state.points.length >= 5000) { state.issue = "El historial local está lleno. Conecta para sincronizar; se conservan los pendientes."; return; }
      const located = fix !== null && fix.timestamp >= Date.parse(state.settings.consentedAt) && usableLocationFix(fix, event.capturedAt);
      const point = locationPointSchema.parse({ ...event, id, kind: "action", companyBranchId: this.owner.companyBranchId, capturedAt: new Date(event.capturedAt).toISOString(),
        locationAt: located ? new Date(fix.timestamp).toISOString() : null, latitude: located ? fix.coords.latitude : null, longitude: located ? fix.coords.longitude : null,
        accuracy: located ? fix.coords.accuracy : null, outcome: located ? "located" : "unavailable", mocked: fix?.mocked === true,
        schedule: state.settings.schedule, consentVersion: 2, consentedAt: state.settings.consentedAt });
      state.points.push(point); saved = true;
      state.issue = located ? null : "Acción registrada sin coordenadas: revisa permisos, ubicación precisa y GPS.";
    });
    return saved;
  }
  async configure(settings: LocationSettings): Promise<void> {
    const parsed = locationSettingsSchema.parse(settings);
    if (parsed.schedule.timezone !== this.owner.timezone || parsed.enabled && !parsed.consentedAt) throw new Error("LOCATION_CONSENT_REQUIRED");
    await this.change(state => { state.settings = parsed; });
  }
}
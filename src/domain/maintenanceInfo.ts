import { z } from "zod";
import type { WorkScope } from "./models";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const option = z.object({ id, label: z.string().max(500) });
export const maintenanceLevelSchema = z.enum(["very_high", "high", "medium", "low", "very_low"]);
export type MaintenanceLevel = z.infer<typeof maintenanceLevelSchema>;

export const LEVEL_LABELS: Record<MaintenanceLevel, string> = { very_high: "Muy alta", high: "Alta", medium: "Media", low: "Baja", very_low: "Muy baja" };
export const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  correctivo: "Correctivo", detencion: "Detención", preventivo: "Preventivo", rutinario: "Rutinario", checklist: "Checklist",
};
export const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
  por_planificar: "Por planificar", planificada: "Planificada", en_progreso: "En progreso", entrega_tecnico: "Entregado por el técnico", finalizada: "Finalizada",
};

/** Información general del mantenimiento (sin costos), con análisis de falla y activos afectados. */
export const maintenanceInfoSchema = z.object({
  maintenanceId: id, revision: z.string().regex(/^[a-f0-9]{64}$/), canEdit: z.boolean(),
  type: z.string().max(40), status: z.string().max(40),
  title: z.string().max(500).nullable(), motive: z.string().max(5000), priority: maintenanceLevelSchema,
  instructions: z.string().max(5000).nullable(), reportedAt: z.string().nullable(), downtimeStartedAt: z.string().nullable(),
  requestedBy: z.string().max(255).nullable(), equipment: option.nullable(),
  system: option.nullable(), failureCause: option.nullable(), detectionMethod: option.nullable(),
  failureSeverity: maintenanceLevelSchema.nullable(), causedDamageType: option.nullable(),
  affectsOtherAssets: z.boolean(), interruptionMinutes: z.number().int().min(0).nullable(), affectedAssets: z.array(option).max(50),
});
export type MaintenanceInfo = z.infer<typeof maintenanceInfoSchema>;

const text = (max: number) => z.string().max(max).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/);
/** Cambios que el técnico puede guardar (el tipo y el equipo se cambian en la web). Lo que no viene no se toca. */
export const maintenanceInfoChangesSchema = z.object({
  title: text(500).nullable(), motive: text(5000), priority: maintenanceLevelSchema,
  instructions: text(5000).nullable(), reportedAt: z.string().datetime(), requestedBy: text(255).nullable(),
  downtimeStartedAt: z.string().datetime().nullable(), systemId: id.nullable(), failureCauseId: id.nullable(),
  detectionMethodId: id.nullable(), failureSeverity: maintenanceLevelSchema.nullable(), causedDamageTypeId: id.nullable(),
  affectsOtherAssets: z.boolean(), interruptionMinutes: z.number().int().min(0).max(1_000_000).nullable(),
  affectedAssetIds: z.array(id).max(50).refine((ids) => new Set(ids).size === ids.length, "DUPLICATED_ASSET"),
}).partial().strict();
export type MaintenanceInfoChanges = z.infer<typeof maintenanceInfoChangesSchema>;
export const maintenanceInfoUpdateSchema = z.object({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), changes: maintenanceInfoChangesSchema }).strict();

export interface MaintenanceInfoPort {
  maintenanceInfo(scope: WorkScope): Promise<MaintenanceInfo>;
  updateMaintenanceInfo(scope: WorkScope, expectedRevision: string, changes: MaintenanceInfoChanges): Promise<MaintenanceInfo>;
}

/** Análisis de falla y "Solicitado por" solo en detención y correctivo; activos afectados y "Detenido desde" solo en detención. */
export const hasFailureAnalysis = (type: string): boolean => type === "detencion" || type === "correctivo";
export const hasDowntime = (type: string): boolean => type === "detencion";

/** Datos de "Información general" que se envían al crear (sin título, motivo ni prioridad, que van aparte). */
export const maintenanceCreationDetailsSchema = maintenanceInfoChangesSchema.omit({ title: true, motive: true, priority: true });
export type MaintenanceCreationDetails = z.infer<typeof maintenanceCreationDetailsSchema>;

const draftOption = z.object({ id, label: z.string().max(500) }).strict();
/** Lo que el técnico escribe en pantalla (fechas y horas separadas, minutos como texto); se guarda en el borrador. */
export const maintenanceDetailsDraftSchema = z.object({
  instructions: z.string().max(5000), requestedBy: z.string().max(255),
  reportedDate: z.string().max(10).regex(/^[0-9-]*$/), reportedTime: z.string().max(5).regex(/^[0-9:]*$/),
  downtimeDate: z.string().max(10).regex(/^[0-9-]*$/), downtimeTime: z.string().max(5).regex(/^[0-9:]*$/),
  system: draftOption.nullable(), failureCause: draftOption.nullable(), detectionMethod: draftOption.nullable(), causedDamageType: draftOption.nullable(),
  failureSeverity: maintenanceLevelSchema.nullable(), affectsOtherAssets: z.boolean(),
  interruptionMinutes: z.string().max(7).regex(/^[0-9]*$/), affectedAssets: z.array(draftOption).max(50),
}).strict();
export type MaintenanceDetailsDraft = z.infer<typeof maintenanceDetailsDraftSchema>;

export const emptyMaintenanceDetails = (): MaintenanceDetailsDraft => ({
  instructions: "", requestedBy: "", reportedDate: "", reportedTime: "", downtimeDate: "", downtimeTime: "",
  system: null, failureCause: null, detectionMethod: null, causedDamageType: null, failureSeverity: null,
  affectsOtherAssets: false, interruptionMinutes: "", affectedAssets: [],
});

const pad = (value: number): string => String(value).padStart(2, "0");
/** Fecha y hora locales del teléfono a partir de un instante (y al revés). */
export function localDateTimeParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return { date: "", time: "" };
  return { date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`, time: `${pad(value.getHours())}:${pad(value.getMinutes())}` };
}
export function instantFromParts(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00`);
  return Number.isFinite(value.getTime()) && localDateTimeParts(value.toISOString()).date === date ? value.toISOString() : null;
}

/**
 * Datos de creación según el tipo (reglas de la web). Fecha y "detenido desde" vacíos = hora de creación (lo pone el servidor).
 * Devuelve el primer error para mostrarlo; sin error, `details` es lo que se envía (o nada si no hay datos).
 */
export function maintenanceCreationDetails(type: string, draft: MaintenanceDetailsDraft, now = Date.now()): { details?: MaintenanceCreationDetails; error: string | null } {
  const details: MaintenanceCreationDetails = {};
  const textOrUndefined = (value: string): string | undefined => value.trim() === "" ? undefined : value.trim();
  const instructions = textOrUndefined(draft.instructions);
  if (instructions !== undefined) details.instructions = instructions;
  const instant = (date: string, time: string, label: string): { value?: string; error: string | null } => {
    if (date === "" && time === "") return { error: null };
    const value = instantFromParts(date, time);
    if (!value) return { error: `Indica fecha y hora de "${label}", o deja ambas vacías para usar la hora de creación.` };
    if (Date.parse(value) > now + 60_000) return { error: `"${label}" no puede estar en el futuro.` };
    return { value, error: null };
  };
  if (hasFailureAnalysis(type)) {
    const reported = instant(draft.reportedDate, draft.reportedTime, "Fecha de reporte");
    if (reported.error) return { error: reported.error };
    if (reported.value) details.reportedAt = reported.value;
    const requestedBy = textOrUndefined(draft.requestedBy);
    if (requestedBy !== undefined) details.requestedBy = requestedBy;
    if (draft.system) details.systemId = draft.system.id;
    if (draft.failureCause) details.failureCauseId = draft.failureCause.id;
    if (draft.detectionMethod) details.detectionMethodId = draft.detectionMethod.id;
    if (draft.failureSeverity) details.failureSeverity = draft.failureSeverity;
    if (draft.causedDamageType) details.causedDamageTypeId = draft.causedDamageType.id;
  }
  if (hasDowntime(type)) {
    const downtime = instant(draft.downtimeDate, draft.downtimeTime, "Detenido desde");
    if (downtime.error) return { error: downtime.error };
    if (downtime.value) details.downtimeStartedAt = downtime.value;
    if (draft.affectsOtherAssets) {
      details.affectsOtherAssets = true;
      if (draft.interruptionMinutes !== "") {
        const minutes = Number(draft.interruptionMinutes);
        if (!Number.isSafeInteger(minutes) || minutes > 1_000_000) return { error: "El tiempo de interrupción debe ser un número entero de minutos." };
        details.interruptionMinutes = minutes;
      }
      if (draft.affectedAssets.length > 0) details.affectedAssetIds = [...new Set(draft.affectedAssets.map((asset) => asset.id))];
    }
  }
  return Object.keys(details).length === 0 ? { error: null } : { details, error: null };
}

export function maintenanceInfoErrorMessage(code: string): string {
  if (code === "PANEL_MAINTENANCE_INFO_CONFLICT") return "Alguien cambió el mantenimiento mientras lo editabas. Se cargó la versión actual; revisa y vuelve a guardar.";
  if (code === "PANEL_MAINTENANCE_INFO_READ_ONLY") return "El mantenimiento o tu trabajo ya está cerrado: la información se cambia desde la web.";
  if (code === "PANEL_MAINTENANCE_INFO_INVALID_INPUT") return "Revisa los datos ingresados: hay un valor no válido.";
  if (code === "PANEL_MAINTENANCE_INFO_WORK_NOT_FOUND") return "No encontramos este mantenimiento en tu agenda. Actualiza e intenta de nuevo.";
  if (code === "PANEL_MAINTENANCE_INFO_NOT_AVAILABLE") return "Actualiza el servidor para ver la información del mantenimiento desde la app.";
  if (code === "INVALID_MAINTENANCE_DOWNTIME_STARTED_AT") return "\"Detenido desde\" no es válido: debe ser una fecha y hora que no esté en el futuro.";
  if (code === "INVALID_MAINTENANCE_INTERRUPTION_MINUTES") return "El tiempo de interrupción debe ser un número entero de minutos.";
  if (code.startsWith("INVALID_MAINTENANCE_")) return "El servidor rechazó un dato del mantenimiento. Revisa los valores elegidos.";
  return "No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.";
}

import type { ScheduleBlock, ScheduleDay, ScheduleSource } from "../../domain/weeklySchedule";
import { duration } from "../../domain/format";
import { palette } from "../../ui/theme";

export const scheduleSources: { [K in ScheduleSource]: { label: string; color: string; background: string } } = {
  external_ot: { label: "OT externa", color: palette.info, background: palette.infoSoft },
  internal_maintenance: { label: "Mantenimiento", color: palette.primary, background: palette.primarySoft },
  direct_assignment: { label: "Asignación directa", color: "#7446A6", background: "#F2EAFB" },
  non_productive: { label: "No productivo", color: palette.amber, background: palette.amberSoft },
};

export function scheduleDayLabel(day: string, compact = false): string {
  return new Intl.DateTimeFormat("es-CL", compact
    ? { timeZone: "UTC", weekday: "short", day: "numeric" }
    : { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
}

export function scheduleMinuteLabel(minute: number): string {
  const seconds = Math.round(minute * 60);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}`;
}

export function scheduleBlockTime(block: ScheduleBlock): string {
  return `${block.continuesBefore ? "↳ " : ""}${scheduleMinuteLabel(block.startMinute)} – ${scheduleMinuteLabel(block.endMinute)}${block.continuesAfter ? " ↪" : ""}`;
}

export function agendaDaySummary(day: ScheduleDay, missing: boolean): string {
  if (missing && day.blocks.length === 0) return "Carga no disponible · sin copia completa";
  return `${day.blocks.length} ${day.blocks.length === 1 ? "trabajo" : "trabajos"} con horario · ${duration(day.plannedMinutes)} planificadas${missing ? " · parcial" : ""}`;
}

export function agendaEmptyMessage(missing: boolean, withoutTime: number, otherEntries: number): string {
  if (missing) return "Actualiza cuando tengas conexión para consultar este día. No equivale a un día sin tareas.";
  if (withoutTime > 0) return "Hay trabajos de este día sin horas válidas. Ábrelos en «sin horario», arriba.";
  if (otherEntries > 0) return "No hay bloques para este día. Revisa los atrasados y trabajos sin horario, o selecciona otro día.";
  return "No hay trabajos con horario en la información recibida para este día. Selecciona otro día o consulta Semana.";
}
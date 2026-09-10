import type { AssignmentWork, Equipment, GroupType, WorkStatus } from "../../domain/models";
import type { BadgeTone, IconName } from "../../ui/components";

export const statusTones: { [K in WorkStatus]: BadgeTone } = {
  pending: "warning", in_progress: "teal", paused: "warning", completed: "success", delivered: "info",
};

export const groupTypes: { [K in GroupType]: { label: string; icon: IconName } } = {
  external_ot: { label: "Orden de trabajo", icon: "document-text-outline" },
  internal_maintenance: { label: "Mantenimiento interno", icon: "construct-outline" },
  direct_assignment: { label: "Asignación directa", icon: "person-outline" },
};

export function fullDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "Sin fecha programada" : date.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function scheduleTime(work: AssignmentWork): string {
  const start = work.scheduledStartTime.slice(0, 5);
  const end = work.scheduledEndTime.slice(0, 5);
  if (!start && !end) return "Sin horario definido";
  const offset = work.endDateOffset ?? 0;
  const label = start && end ? `${start} – ${end}` : start ? `Desde ${start}` : `Hasta ${end}`;
  return offset > 0 ? `${label} (+${offset} ${offset === 1 ? "día" : "días"})` : label;
}

export function equipmentLabel(equipment: Equipment | null): string {
  if (!equipment) return "Sin equipo asociado";
  return [equipment.identifier.trim() ? equipment.identifier : equipment.internalNumber, equipment.label].filter(Boolean).join(" · ") || "Sin identificación de equipo";
}

export function safeCount(value: number): number {
  return Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0);
}
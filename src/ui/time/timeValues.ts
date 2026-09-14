export interface ClockParts { hours: number; minutes: number; }

export function parseClock(value: string): ClockParts | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return { hours: Number(value.slice(0, 2)), minutes: Number(value.slice(3)) };
}

export function formatClock(hours: number, minutes: number): string | null {
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function clockPickerDate(value: string): Date {
  const parts = parseClock(value) ?? { hours: 12, minutes: 0 };
  const date = new Date(2000, 0, 15, 12, 0, 0, 0);
  date.setHours(parts.hours, parts.minutes, 0, 0);
  return date;
}

export function clockFromPickerDate(date: Date): string | null {
  return formatClock(date.getHours(), date.getMinutes());
}

export function parseSelectionNumber(value: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;
  const number = Number(value);
  return number <= max ? number : null;
}

export function dayOffsetLabel(value: number): string {
  return value === 0 ? "Mismo día" : value === 1 ? "Día siguiente" : `${value} días después`;
}
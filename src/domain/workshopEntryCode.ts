/**
 * Código del ingreso a taller, igual que en la web y el servidor (tablero, listados, correos, informes): «ING-00047».
 * Lo usan la app y la pasarela. Sin número válido devuelve "".
 */
export function formatWorkshopEntryCode(id: string | number | null | undefined): string {
  const digits = String(id ?? "").trim().replace(/^ING-?/i, "");
  if (!/^\d+$/.test(digits) || Number(digits) <= 0) return "";
  return `ING-${String(Number(digits)).padStart(5, "0")}`;
}

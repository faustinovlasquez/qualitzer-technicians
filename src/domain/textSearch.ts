/** Texto para comparar: sin mayúsculas, tildes ni espacios repetidos. */
export function searchable(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
    : "";
}

/** Coincide si cada palabra buscada aparece en alguno de los valores (en cualquier orden). */
export function matchesSearch(query: string, ...values: unknown[]): boolean {
  const words = searchable(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = values.flat().map(searchable).join(" ");
  return words.every((word) => haystack.includes(word));
}

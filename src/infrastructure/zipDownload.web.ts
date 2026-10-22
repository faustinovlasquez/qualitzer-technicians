/** En el navegador, el .zip se descarga como cualquier archivo. */
export async function saveAndShareZip(url: string, headers: Record<string, string>, name: string): Promise<void> {
  const response = await fetch(url, { headers, credentials: "include" }).catch(() => null);
  if (!response?.ok) {
    let message = "No se pudo descargar el comprimido. Revisa tu conexión e inténtalo de nuevo.";
    try { const body = await response?.json() as { message?: unknown } | undefined; if (typeof body?.message === "string") message = body.message; } catch { /* sin detalle */ }
    throw new Error(message);
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

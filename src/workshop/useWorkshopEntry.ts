import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { WorkshopEntryDetail } from "../domain/workshopEntry";
import { ApiError } from "../infrastructure/errors";

function entryError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "Este ingreso ya no existe o ya fue entregado. Vuelve al tablero y actualízalo.";
  if (error instanceof ApiError && error.status === 403) return "No tienes acceso a este ingreso en la sucursal elegida.";
  return "No se pudo cargar la ficha. Revisa tu conexión e inténtalo de nuevo.";
}

/** Ficha de un ingreso: se carga al abrirla, al deslizar hacia abajo y al volver a la app. Solo con conexión. */
export function useWorkshopEntry(load: (entryId: number) => Promise<WorkshopEntryDetail>, entryId: number) {
  const [detail, setDetail] = useState<WorkshopEntryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loader = useRef(load);
  loader.current = load;
  const revision = useRef(0);

  async function refresh(): Promise<void> {
    const read = ++revision.current;
    setLoading(true);
    try {
      const result = await loader.current(entryId);
      if (read === revision.current) { setDetail(result); setError(""); }
    } catch (failure) {
      if (read === revision.current) setError(entryError(failure));
    } finally {
      if (read === revision.current) setLoading(false);
    }
  }

  useEffect(() => {
    setDetail(null); setError("");
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    return () => { revision.current++; subscription.remove(); };
  }, [entryId]);

  return { detail, loading, error, refresh };
}

import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { WorkshopEntryDetail } from "../domain/workshopEntry";
import { ApiError } from "../infrastructure/errors";

function entryError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "Este ingreso ya no existe o ya fue entregado. Vuelve al tablero y actualízalo.";
  if (error instanceof ApiError && error.status === 403) return "No tienes acceso a este ingreso en la sucursal elegida.";
  return "No se pudo cargar la ficha. Revisa tu conexión e inténtalo de nuevo.";
}

/** Fallas que no se arreglan reintentando: sin acceso, ya no existe o sesión vencida. */
const definitive = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status);
// Un corte breve, el servidor ocupado o la app recién vuelta al frente (taller aún no disponible): se reintenta solo.
const RETRY_DELAYS_MS = [800, 2_000, 4_000];
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Ficha de un ingreso: se carga al abrirla, al deslizar hacia abajo y al volver a la app. Solo con conexión. */
export function useWorkshopEntry(load: (entryId: number) => Promise<WorkshopEntryDetail>, entryId: number) {
  const [detail, setDetail] = useState<WorkshopEntryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loader = useRef(load);
  loader.current = load;
  const revision = useRef(0);
  const loaded = useRef(false);

  async function refresh(): Promise<void> {
    const read = ++revision.current;
    setLoading(true);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await loader.current(entryId);
          if (read === revision.current) { loaded.current = true; setDetail(result); setError(""); }
          return;
        } catch (failure) {
          if (read !== revision.current) return;
          if (definitive(failure) || attempt >= RETRY_DELAYS_MS.length) {
            // Con la ficha ya a la vista, una actualización fallida no la tapa con el error (se puede deslizar para reintentar).
            if (definitive(failure) || !loaded.current) setError(entryError(failure));
            return;
          }
          await pause(RETRY_DELAYS_MS[attempt]!);
          if (read !== revision.current) return;
        }
      }
    } finally {
      if (read === revision.current) setLoading(false);
    }
  }

  useEffect(() => {
    setDetail(null); setError(""); loaded.current = false;
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    return () => { revision.current++; subscription.remove(); };
  }, [entryId]);

  return { detail, loading, error, refresh };
}

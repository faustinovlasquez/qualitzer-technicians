import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { WorkshopBoard, WorkshopBoardPort, WorkshopOption } from "../domain/workshopBoard";

/**
 * Tablero del taller (naves e ingresos), solo lectura. Recuerda el último taller elegido por usuario y sucursal,
 * y se actualiza cada minuto y al volver a la app.
 */
export function useWorkshopBoard(port: Partial<WorkshopBoardPort> | null, userId: number, branchId: number, storageKey: string, sessionIdentity: string, enabled: boolean) {
  const key = `workshop-board:${storageKey}:${userId}:${branchId}`;
  const [workshops, setWorkshops] = useState<WorkshopOption[] | null>(null);
  const [workshopId, setWorkshopId] = useState<number | null>(null);
  const [board, setBoard] = useState<WorkshopBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const current = useRef({ key, sessionIdentity, port, workshopId });
  current.current = { key, sessionIdentity, port, workshopId };
  const revision = useRef(0);
  const sameScope = () => current.current.key === key && current.current.sessionIdentity === sessionIdentity && current.current.port === port;

  async function loadBoard(target: number | null = current.current.workshopId) {
    if (!enabled || !port?.workshopBoard || target === null || branchId <= 0) return;
    const read = ++revision.current;
    setLoading(true);
    try {
      const result = await port.workshopBoard(branchId, target);
      if (sameScope() && read === revision.current) { setBoard(result); setError(""); }
    } catch {
      if (sameScope() && read === revision.current) setError("No se pudo cargar el taller. Revisa tu conexión.");
    } finally {
      if (sameScope() && read === revision.current) setLoading(false);
    }
  }

  // Al cambiar de sesión o sucursal: lista de talleres y el último elegido (o el primero).
  useEffect(() => {
    let active = true;
    setWorkshops(null); setWorkshopId(null); setBoard(null); setError(""); revision.current++;
    if (!enabled || !port?.workshops || branchId <= 0) return;
    void (async () => {
      try {
        const [list, saved] = await Promise.all([port.workshops!(branchId), AsyncStorage.getItem(key).catch(() => null)]);
        if (!active) return;
        setWorkshops(list.items);
        const remembered = list.items.find((item) => String(item.id) === saved);
        setWorkshopId((remembered ?? list.items[0])?.id ?? null);
      } catch {
        if (active) setError("No se pudieron cargar los talleres. Revisa tu conexión.");
      }
    })();
    return () => { active = false; };
  }, [key, sessionIdentity, enabled, port]);

  useEffect(() => {
    if (workshopId === null || !enabled) return;
    void loadBoard(workshopId);
    const interval = setInterval(() => { void loadBoard(); }, 60000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void loadBoard(); });
    return () => { clearInterval(interval); subscription.remove(); };
  }, [workshopId, enabled, key, sessionIdentity, port]);

  function selectWorkshop(id: number) {
    if (id === workshopId) return;
    setBoard(null);
    setWorkshopId(id);
    void AsyncStorage.setItem(key, String(id)).catch(() => undefined);
  }

  return { workshops, workshopId, board, loading, error, refresh: () => loadBoard(), selectWorkshop };
}

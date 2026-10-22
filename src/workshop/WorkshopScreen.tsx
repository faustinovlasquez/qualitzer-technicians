import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { WorkshopArea, WorkshopEntry } from "../domain/workshopBoard";
import type { useWorkshopBoard } from "./useWorkshopBoard";
import { WorkshopBoardScreen } from "./WorkshopBoardScreen";
import { WorkshopEntryScreen } from "./WorkshopEntryScreen";

type WorkshopModel = ReturnType<typeof useWorkshopBoard>;

/**
 * Pestaña Taller: tablero y, encima, la ficha del ingreso elegido. El tablero queda montado (oculto) para conservar
 * el desplazamiento, la búsqueda y el filtro al volver. Avisa a la app cuándo hay una ficha abierta para que el botón
 * atrás del teléfono cierre la ficha y no cambie de pestaña.
 */
export function WorkshopScreen({ workshop, onSectionChange }: { workshop: WorkshopModel; onSectionChange?: (open: boolean) => void }) {
  const [opened, setOpened] = useState<{ entry: WorkshopEntry; area: WorkshopArea } | null>(null);
  useEffect(() => { onSectionChange?.(opened !== null); }, [opened !== null]);
  useEffect(() => () => { onSectionChange?.(false); }, []);
  // Otro taller o sesión: la ficha abierta ya no corresponde.
  useEffect(() => { setOpened(null); }, [workshop.workshopId]);

  return <View style={styles.screen}>
    <View style={[styles.screen, opened !== null && styles.hidden]}>
      <WorkshopBoardScreen workshop={workshop} onOpenEntry={(entry, area) => setOpened({ entry, area })} />
    </View>
    {opened ? <WorkshopEntryScreen entry={opened.entry} area={opened.area} onBack={() => setOpened(null)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hidden: { display: "none" }
});

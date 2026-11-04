import { Ionicons } from "@expo/vector-icons";
import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { palette, radius } from "../ui/theme";

export type DriveView = "large" | "small" | "list";

const DRIVE_VIEWS: Array<{ id: DriveView; icon: ComponentProps<typeof Ionicons>["name"]; label: string }> = [
  { id: "large", icon: "square-outline", label: "Ver fotos grandes" },
  { id: "small", icon: "grid-outline", label: "Ver fotos pequeñas" },
  { id: "list", icon: "list-outline", label: "Ver como lista" },
];
export const GRID_GAP = 10;
const TILE_PADDING = 4;
const SMALL_SIZE = 96;
/** La vista elegida se mantiene al cambiar de carpeta, de paso o de trabajo mientras la app siga abierta. */
let rememberedView: DriveView = "small";

/** Vista de los archivos y tamaño de cada foto: en grande, dos columnas en teléfono y más en pantallas anchas. */
export function useDriveView() {
  const [view, changeView] = useState<DriveView>(rememberedView);
  const [gridWidth, setGridWidth] = useState(0);
  const columns = Math.max(2, Math.floor(gridWidth / 220));
  const largeSize = gridWidth > 0 ? Math.floor((gridWidth - GRID_GAP * (columns - 1)) / columns) - TILE_PADDING * 2 : 150;
  const tileSize = view === "large" ? largeSize : SMALL_SIZE;
  return {
    view,
    setView: (next: DriveView) => { rememberedView = next; changeView(next); },
    tileSize,
    tileStyle: { width: tileSize + TILE_PADDING * 2, padding: TILE_PADDING },
    onGridLayout: (event: LayoutChangeEvent) => setGridWidth(event.nativeEvent.layout.width),
  };
}

export function DriveViewSwitch({ view, onChange }: { view: DriveView; onChange: (view: DriveView) => void }) {
  return <View style={switchStyles.row} accessibilityRole="radiogroup" accessibilityLabel="Cómo ver los archivos">
    {DRIVE_VIEWS.map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: view === option.id }} aria-checked={view === option.id} hitSlop={4} onPress={() => onChange(option.id)}
      style={({ pressed }) => [switchStyles.option, view === option.id && switchStyles.active, pressed && switchStyles.pressed]}>
      <Ionicons name={option.icon} size={18} color={view === option.id ? palette.primary : palette.textSecondary} accessible={false} />
    </Pressable>)}
  </View>;
}

const switchStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 2, padding: 2, borderRadius: radius.sm, backgroundColor: palette.track },
  option: { width: 38, height: 34, borderRadius: radius.sm - 2, alignItems: "center", justifyContent: "center" },
  active: { backgroundColor: palette.surface },
  pressed: { opacity: 0.7 },
});

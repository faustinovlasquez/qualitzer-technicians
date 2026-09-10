import { useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { OfflineSnapshot } from "../../domain/offline";
import { palette } from "../../ui/theme";
import { errorMessage } from "../workDetail/detailRules";
import { compactConnectionPresentation, connectionPresentation } from "../../offline/connectionPresentation";

export interface OfflineStatusBarProps {
  snapshot: OfflineSnapshot | null;
  onOpen: () => void;
  onSync: () => Promise<void>;
  embedded?: boolean;
}

export function OfflineStatusBar({ snapshot, onOpen, onSync, embedded = false }: OfflineStatusBarProps) {
  const lock = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncing = working || snapshot?.syncing === true;
  const presentation = connectionPresentation(snapshot);
  const compact = compactConnectionPresentation(snapshot);
  const disabled = !presentation.canSync || syncing;
  const color = presentation.tone === "success" ? palette.success : presentation.tone === "error" ? palette.danger : presentation.tone === "warning" ? palette.amber : palette.info;
  const backgroundColor = presentation.tone === "success" ? palette.successSoft : presentation.tone === "error" ? palette.dangerSoft : presentation.tone === "warning" ? palette.amberSoft : palette.infoSoft;
  const label = error ? "No se pudo sincronizar · ver centro" : presentation.label;
  async function sync(): Promise<void> {
    if (lock.current || disabled) return;
    lock.current = true;
    setWorking(true);
    setError(null);
    try { await onSync(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { lock.current = false; setWorking(false); }
  }
  return <View testID="connection-status-bar" style={[styles.bar, embedded && styles.embedded, { backgroundColor }]}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityHint={`${error ? `${error}. ` : ""}${presentation.secondary} Abre el centro offline: cobertura, pendientes y detalles de sincronización.`} onPress={() => { setError(null); onOpen(); }} style={styles.summary}>
      <Ionicons name={presentation.ready ? "cloud-done-outline" : presentation.tone === "error" ? "cloud-offline-outline" : "cloud-outline"} size={18} color={color} accessible={false} />
      <View style={styles.text}>
        <Text testID="connection-status-title" numberOfLines={1} ellipsizeMode="tail" style={[styles.label, { color }]}>{error ? "No se pudo sincronizar" : compact.title}</Text>
        <Text testID="connection-status-detail" numberOfLines={1} ellipsizeMode="tail" style={styles.secondary}>{compact.detail}</Text>
      </View>
    </TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sincronizar ahora" accessibilityState={{ disabled, busy: syncing }} disabled={disabled} onPress={() => void sync()} style={[styles.sync, disabled && styles.disabled]}>
      {syncing ? <ActivityIndicator size="small" color={palette.primary} /> : <Ionicons name="sync-outline" size={21} color={palette.primary} accessible={false} />}
    </TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, backgroundColor: palette.primarySoft, borderTopWidth: 1, borderColor: palette.border },
  embedded: { borderTopWidth: 0, borderRadius: 10, paddingHorizontal: 0 },
  text: { flex: 1, minWidth: 0 },
  secondary: { fontSize: 12, lineHeight: 17, color: palette.textSecondary },
  summary: { flex: 1, minWidth: 0, minHeight: 44, paddingVertical: 4, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 12, lineHeight: 17, fontWeight: "600", color: palette.text, flexShrink: 1 },
  sync: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.45 },
});
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { BodyText, Card, type IconName } from "../../ui/components";
import { palette, radius } from "../../ui/theme";
import { permissionAction, permissionLabels, permissionState, type PermissionKind, type PermissionSnapshot, type PermissionState } from "./permissionStatus";

const items: Array<{ kind: PermissionKind; icon: IconName; color: string; title: string; purpose: string }> = [
  { kind: "notifications", icon: "notifications", color: palette.orange, title: "Notificaciones", purpose: "Avisos de asignaciones, cronómetros y materiales por confirmar." },
  { kind: "camera", icon: "camera", color: palette.primary, title: "Cámara", purpose: "Fotos de evidencia en trabajos, checklists y tu foto de perfil." },
  { kind: "location", icon: "location", color: palette.info, title: "Ubicación", purpose: "Registrar dónde inicias, pausas o entregas y al confirmar materiales. Solo con la app abierta." },
];

async function read(kind: PermissionKind): Promise<PermissionSnapshot> {
  if (kind === "camera") return await ImagePicker.getCameraPermissionsAsync();
  if (kind === "location") return await Location.getForegroundPermissionsAsync();
  return await Notifications.getPermissionsAsync();
}

async function request(kind: PermissionKind): Promise<void> {
  if (kind === "camera") await ImagePicker.requestCameraPermissionsAsync();
  else if (kind === "location") await Location.requestForegroundPermissionsAsync();
  else await Notifications.requestPermissionsAsync();
}

/** Permisos de la app con su estado y acción, como en Ajustes > Aplicaciones > Permisos de Android. */
export function PermissionsPanel({ disabled, onEnableNotifications }: { disabled: boolean; onEnableNotifications?: () => Promise<unknown> }) {
  const [states, setStates] = useState<{ [K in PermissionKind]: PermissionState }>({ notifications: "unknown", camera: "unknown", location: "unknown" });
  const [busy, setBusy] = useState<PermissionKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const next = { ...states };
    for (const item of items) {
      try { next[item.kind] = permissionState(await read(item.kind)); } catch { next[item.kind] = "unknown"; }
    }
    if (mounted.current) setStates(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Al volver desde Ajustes del teléfono se relee el estado.
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => { mounted.current = false; subscription.remove(); };
  }, [refresh]);

  async function act(kind: PermissionKind, state: PermissionState) {
    const action = permissionAction(state);
    if (!action || busy || disabled) return;
    setBusy(kind); setMessage(null);
    try {
      if (action === "request") {
        // Las notificaciones se activan con el registro del teléfono, que también pide el permiso.
        if (kind === "notifications" && onEnableNotifications) await onEnableNotifications(); else await request(kind);
      } else {
        if (action === "revoke") setMessage("Android no deja que una app se quite permisos. Se abrió la ficha de Qualitzer: entra a Permisos y elige \"No permitir\".");
        await Linking.openSettings();
      }
    } catch { if (mounted.current) setMessage("No se pudo completar. Abre Ajustes del teléfono > Aplicaciones > Qualitzer técnicos > Permisos."); }
    finally { if (mounted.current) setBusy(null); await refresh(); }
  }

  if (Platform.OS === "web") return <Card><BodyText>Los permisos de notificaciones, cámara y ubicación se gestionan desde la app instalada en el teléfono.</BodyText></Card>;
  return <View style={styles.wrap}>
    <View style={styles.group}>
      {items.map((item, index) => {
        const state = states[item.kind];
        const action = permissionAction(state);
        const tone = state === "granted" ? palette.success : state === "undetermined" ? palette.amber : state === "unknown" ? palette.textMuted : palette.danger;
        return <View key={item.kind} style={[styles.row, index > 0 && styles.divider]}>
          <View style={[styles.icon, { backgroundColor: item.color }]}><Ionicons name={item.icon} size={20} color={palette.white} accessible={false} /></View>
          <View style={styles.text}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.purpose}>{item.purpose}</Text>
            <View style={styles.status}><View style={[styles.dot, { backgroundColor: tone }]} /><Text style={[styles.statusText, { color: tone }]}>{permissionLabels[state]}</Text></View>
          </View>
          {action ? <Pressable accessibilityRole="button" accessibilityLabel={`${action === "request" ? "Permitir" : action === "settings" ? "Abrir ajustes para" : "Quitar"} ${item.title}`}
            disabled={disabled || busy !== null} onPress={() => void act(item.kind, state)}
            style={({ pressed }) => [styles.action, action === "request" ? styles.actionPrimary : styles.actionSecondary, (disabled || busy !== null) && styles.disabled, pressed && styles.pressed]}>
            <Text style={[styles.actionText, action === "request" ? styles.actionTextPrimary : null]}>{busy === item.kind ? "…" : action === "request" ? "Permitir" : action === "settings" ? "Ajustes" : "Quitar"}</Text>
          </Pressable> : null}
        </View>;
      })}
    </View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    <Text style={styles.hint}>Si un permiso aparece como Bloqueado, Android ya no vuelve a preguntar: usa "Ajustes" y actívalo en Permisos. Al volver, el estado se actualiza solo.</Text>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  group: { borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  divider: { borderTopWidth: 1, borderColor: palette.border },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: "700", color: palette.text },
  purpose: { fontSize: 13, lineHeight: 18, color: palette.textSecondary },
  status: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 }, statusText: { fontSize: 13, fontWeight: "800" },
  action: { minWidth: 84, alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  actionPrimary: { backgroundColor: palette.primary, borderColor: palette.primary }, actionSecondary: { backgroundColor: palette.surface, borderColor: palette.border },
  actionText: { fontSize: 14, fontWeight: "800", color: palette.heading }, actionTextPrimary: { color: palette.white },
  disabled: { opacity: 0.5 }, pressed: { opacity: 0.8 },
  message: { fontSize: 13, lineHeight: 19, color: palette.text, paddingHorizontal: 4 },
  hint: { fontSize: 12, lineHeight: 17, color: palette.textMuted, paddingHorizontal: 4 },
});

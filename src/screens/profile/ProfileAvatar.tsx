import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { palette } from "../../ui/theme";

/** Foto de perfil circular; si no hay foto (o falla la descarga) muestra iniciales sobre el color del colaborador. */
export function ProfileAvatar({ uri, initials, color, size = 96, busy = false, editable = false, disabled = false, onPress }: {
  uri: string | null; initials: string; color?: string | null; size?: number; busy?: boolean; editable?: boolean; disabled?: boolean; onPress?(): void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = uri !== null && failed !== uri;
  const background = color ?? palette.primary;
  const content = <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: showImage ? palette.track : background }]}>
    {showImage
      ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" onError={() => setFailed(uri)} accessible={false} />
      : <Text style={[styles.initials, { fontSize: Math.round(size * 0.36) }]} accessible={false}>{initials}</Text>}
    {busy ? <View style={[styles.overlay, { borderRadius: size / 2 }]}><ActivityIndicator color={palette.white} /></View> : null}
  </View>;
  if (!editable || !onPress) return content;
  return <Pressable accessibilityRole="button" accessibilityLabel={uri ? "Cambiar foto de perfil" : "Agregar foto de perfil"} accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
    {content}
    <View style={[styles.badge, disabled && styles.disabled]}><Ionicons name="camera" size={18} color={palette.white} accessible={false} /></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  pressable: { alignSelf: "center" }, pressed: { opacity: 0.85 },
  circle: { alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 4, borderColor: palette.surface, boxShadow: "0px 6px 18px rgba(18, 44, 58, 0.16)" },
  initials: { color: palette.white, fontWeight: "800", letterSpacing: 0.5 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(18,44,58,0.45)", alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", right: 2, bottom: 2, width: 36, height: 36, borderRadius: 18, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: palette.surface },
  disabled: { opacity: 0.55 },
});

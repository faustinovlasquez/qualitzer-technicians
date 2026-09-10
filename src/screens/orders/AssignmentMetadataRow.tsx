import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { plainText } from "../../domain/format";
import type { IconName } from "../../ui/components";
import { palette } from "../../ui/theme";

export function AssignmentMetadataRow({ icon, text, strong = false }: { icon: IconName; text: string; strong?: boolean }) {
  return <View style={styles.row}>
    <Ionicons name={icon} size={16} color={palette.textMuted} style={styles.icon} accessible={false} />
    <Text style={[styles.text, strong && styles.strong]}>{plainText(text)}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  icon: { marginTop: 2 },
  text: { fontSize: 13, lineHeight: 20, color: palette.textSecondary, flex: 1 },
  strong: { color: palette.text, fontWeight: "500" },
});
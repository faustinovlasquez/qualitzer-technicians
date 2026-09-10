import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconButton } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";

export function CreationModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <Modal transparent visible animationType="fade" onRequestClose={onClose}>
    <SafeAreaView style={styles.overlay}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Cerrar ${title}`} onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={styles.panel} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <IconButton name="close-outline" label={`Cerrar ${title}`} onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{children}</ScrollView>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(18,44,58,0.6)" },
  panel: { width: "100%", maxWidth: 560, maxHeight: "92%", backgroundColor: palette.surface, borderRadius: radius.lg, overflow: "hidden", flexShrink: 1 },
  header: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderColor: palette.border, gap: 8 },
  title: { ...typography.heading, color: palette.text, flex: 1 },
  content: { padding: 16, gap: 12 },
});
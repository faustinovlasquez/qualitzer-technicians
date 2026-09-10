import { StyleSheet } from "react-native";
import { palette, radius, typography } from "../../../ui/theme";

export const styles = StyleSheet.create({
  stack: { gap: 16 },
  tight: { gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  grow: { flex: 1, minWidth: 110 },
  label: { ...typography.label, color: palette.text },
  caption: { ...typography.caption, color: palette.textSecondary },
  error: { ...typography.caption, color: palette.danger },
  overlay: { flex: 1, justifyContent: "center", backgroundColor: "rgba(18,44,58,0.65)", padding: 12 },
  modal: { maxHeight: "100%", width: "100%", maxWidth: 700, alignSelf: "center", backgroundColor: palette.background, borderRadius: radius.lg, overflow: "hidden", flexShrink: 1 },
  content: { padding: 18, gap: 18 },
  header: { padding: 18, gap: 8, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  footer: { padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface },
  notes: { minHeight: 100, textAlignVertical: "top" },
  signature: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, overflow: "hidden" },
  signatureError: { borderColor: palette.danger },
  signaturePreview: { height: 150, width: "100%", backgroundColor: palette.surface, borderRadius: radius.sm },
  signatureHint: { ...typography.caption, color: palette.textMuted, padding: 10, textAlign: "center" },
  number: { minWidth: 90, flex: 1 },
  review: { gap: 10, padding: 16, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border },
});
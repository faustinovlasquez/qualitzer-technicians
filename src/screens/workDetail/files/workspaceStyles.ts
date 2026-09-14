import { StyleSheet } from "react-native";
import { palette, radius, typography } from "../../../ui/theme";

export const workspaceStyles = StyleSheet.create({
  bounded: { flex: 1, minHeight: 0, width: "100%", maxWidth: 900, alignSelf: "center" },
  toolbar: { paddingHorizontal: 12, paddingVertical: 8, gap: 6, backgroundColor: palette.surface, flexShrink: 0, borderBottomWidth: 1, borderBottomColor: palette.border },
  title: { ...typography.label, color: palette.text, flex: 1, minWidth: 0 },
  controls: { flexDirection: "row", gap: 6, alignItems: "center" },
  compactPicker: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 4, paddingVertical: 8, gap: 4 },
  list: { flex: 1, minHeight: 0 },
  listContent: { padding: 12, gap: 12 },
  dock: { paddingHorizontal: 12, paddingVertical: 8, gap: 4, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border, flexShrink: 0 },
  draftRow: { flexDirection: "row", alignItems: "center", padding: 8, gap: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface },
  thumbnail: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { flexBasis: 240, flexGrow: 1, minWidth: 0, maxWidth: 440, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12, gap: 10, backgroundColor: palette.surface },
  document: { height: 110, alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.sm, backgroundColor: palette.primarySoft },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: 44, height: 44 },
  initials: { ...typography.label, color: palette.primary },
  comment: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 18, gap: 12 },
  commentText: { ...typography.body, color: palette.text },
  counter: { ...typography.caption, color: palette.textSecondary, textAlign: "right", fontVariant: ["tabular-nums"] },
  pickerButton: { flexGrow: 1, flexBasis: 140 },
});
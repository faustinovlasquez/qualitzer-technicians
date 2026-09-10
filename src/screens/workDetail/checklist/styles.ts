import { StyleSheet } from "react-native";
import { palette, radius, typography } from "../../../ui/theme";

export const checklistStyles = StyleSheet.create({
  catalog: { gap: 12 },
  catalogCard: { padding: 16, gap: 12 },
  cardHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.primarySoft, justifyContent: "center", alignItems: "center" },
  name: { ...typography.label, color: palette.text, fontSize: 16, lineHeight: 23 },
  code: { ...typography.caption, color: palette.textSecondary },
  pressed: { opacity: 0.75 },
  panel: { padding: 16, gap: 16 },
  navigation: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  navigationButton: { flexGrow: 1, flexBasis: 120 },
  stepRow: { minHeight: 64, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: 10 },
  selectedRow: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  snapshot: { backgroundColor: palette.background, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 12, gap: 6 },
  comment: { minHeight: 96, textAlignVertical: "top" },
});
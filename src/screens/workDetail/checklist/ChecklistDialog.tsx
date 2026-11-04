import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrivateModal as Modal } from "../../../security/DeviceSecurityContext";
import { palette, radius } from "../../../ui/theme";

const WIDE_SCREEN = 720;

/** Ventana del checklist: ocupa todo el teléfono y, en pantallas anchas, queda centrada sobre un fondo oscuro. */
export function ChecklistDialog({ visible, onRequestClose, children }: { visible: boolean; onRequestClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_SCREEN;
  return <Modal visible={visible} transparent={wide} animationType={wide ? "fade" : "slide"} statusBarTranslucent navigationBarTranslucent onRequestClose={onRequestClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
      style={[dialogStyles.host, wide ? dialogStyles.backdrop : { paddingTop: insets.top }]}>
      <View accessibilityViewIsModal testID="checklist-dialog" style={[dialogStyles.sheet, wide ? dialogStyles.wideSheet : { paddingBottom: insets.bottom }]}>{children}</View>
    </KeyboardAvoidingView>
  </Modal>;
}

const dialogStyles = StyleSheet.create({
  host: { flex: 1, backgroundColor: palette.navy },
  backdrop: { backgroundColor: "rgba(10, 26, 34, 0.6)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { flex: 1, minHeight: 0, width: "100%", backgroundColor: palette.background },
  wideSheet: { maxWidth: 680, maxHeight: 860, borderRadius: radius.lg, overflow: "hidden" },
});

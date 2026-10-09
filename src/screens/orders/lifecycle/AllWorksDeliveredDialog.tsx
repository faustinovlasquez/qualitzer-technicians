import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal as Modal } from "../../../security/DeviceSecurityContext";
import { Button } from "../../../ui/components";
import { palette, radius } from "../../../ui/theme";

export interface AllWorksDeliveredDialogProps {
  orderLabel: string;
  works: string[];
  pendingChecklists: string[];
  busy: boolean;
  canDeliver: boolean;
  error?: string | null;
  onDeliver: () => void;
  onClose: () => void;
}

// En web el driver nativo no existe; las animaciones corren igual con JavaScript.
const nativeDriver = Platform.OS !== "web";
const sparkles: { icon: keyof typeof Ionicons.glyphMap; top: number; left: number; color: string; size: number }[] = [
  { icon: "sparkles", top: 4, left: 18, color: palette.amber, size: 20 },
  { icon: "star", top: 14, left: 150, color: palette.primary, size: 14 },
  { icon: "sparkles", top: 92, left: 4, color: palette.primary, size: 16 },
  { icon: "star", top: 100, left: 160, color: palette.amber, size: 18 },
];

/**
 * Celebración al entregar el último trabajo de un mantenimiento: confirma que el técnico terminó todo y ofrece
 * pasar a la entrega de la OT o salir. Las animaciones son decorativas y no bloquean los botones.
 */
export function AllWorksDeliveredDialog(props: AllWorksDeliveredDialogProps) {
  const card = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  const items = useRef(props.works.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(card, { toValue: 1, friction: 7, tension: 60, useNativeDriver: nativeDriver }),
      Animated.spring(check, { toValue: 1, friction: 4, tension: 90, useNativeDriver: nativeDriver }),
      Animated.stagger(90, items.map(value => Animated.timing(value, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }))),
    ]).start();
    const pulse = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }));
    const shine = Animated.loop(Animated.sequence([
      Animated.timing(twinkle, { toValue: 1, duration: 700, useNativeDriver: nativeDriver }),
      Animated.timing(twinkle, { toValue: 0, duration: 700, useNativeDriver: nativeDriver }),
    ]));
    pulse.start(); shine.start();
    return () => { pulse.stop(); shine.stop(); };
  }, []);

  const cardStyle = { opacity: card, transform: [{ translateY: card.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }, { scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] };
  const checkStyle = { transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }, { rotate: check.interpolate({ inputRange: [0, 1], outputRange: ["-35deg", "0deg"] }) }] };
  const ringStyle = { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }] };

  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!props.busy) props.onClose(); }}>
    <SafeAreaView style={styles.overlay}>
      <Animated.View style={[styles.card, cardStyle]} accessibilityViewIsModal testID="all-works-delivered-dialog">
        <View style={styles.hero}>
          <View style={styles.badgeArea}>
            {sparkles.map((item, index) => <Animated.View key={index} style={[styles.sparkle, { top: item.top, left: item.left, opacity: index % 2 === 0 ? twinkle : twinkle.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }) }]}>
              <Ionicons name={item.icon} size={item.size} color={item.color} accessible={false} />
            </Animated.View>)}
            <Animated.View style={[styles.ring, ringStyle]} />
            <Animated.View style={[styles.badge, checkStyle]}>
              <Ionicons name="checkmark-done" size={46} color={palette.white} accessible={false} />
            </Animated.View>
          </View>
          <Text accessibilityRole="header" style={styles.title}>¡Terminaste todos los trabajos!</Text>
          <Text style={styles.code}>{props.orderLabel}</Text>
          <Text style={styles.text}>Todos los trabajos del mantenimiento quedaron entregados. Solo falta entregar la OT para cerrarla.</Text>
        </View>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {props.works.map((work, index) => <Animated.View key={`${index}:${work}`} style={[styles.work, { opacity: items[index] ?? 1, transform: [{ translateX: (items[index] ?? new Animated.Value(1)).interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }]}>
            <View style={styles.workCheck}><Ionicons name="checkmark" size={14} color={palette.white} accessible={false} /></View>
            <Text style={styles.workText} numberOfLines={2}>{work}</Text>
          </Animated.View>)}
          {props.pendingChecklists.length > 0 ? <View style={styles.warning}>
            <Ionicons name="alert-circle-outline" size={18} color={palette.amber} accessible={false} />
            <Text style={styles.warningText}>{props.pendingChecklists.length === 1 ? "Hay 1 checklist incompleto" : `Hay ${props.pendingChecklists.length} checklists incompletos`}. Se entregarán tal como están.</Text>
          </View> : null}
        </ScrollView>
        <View style={styles.actions}>
          {props.error ? <View accessibilityRole="alert" style={styles.error}><Ionicons name="time-outline" size={18} color={palette.danger} accessible={false} /><Text style={styles.errorText}>{props.error}</Text></View> : null}
          <Button title={props.busy ? "Confirmando entrega…" : "Entregar OT"} icon="paper-plane-outline" loading={props.busy} disabled={props.busy || !props.canDeliver} onPress={props.onDeliver} style={styles.deliver} />
          <Button title="Salir" icon="close-outline" variant="ghost" disabled={props.busy} onPress={props.onClose} />
        </View>
      </Animated.View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(18,44,58,0.65)" },
  card: { width: "100%", maxWidth: 440, maxHeight: "92%", alignSelf: "center", borderRadius: radius.xl, backgroundColor: palette.surface, overflow: "hidden" },
  hero: { alignItems: "center", gap: 6, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 14, backgroundColor: palette.successSoft },
  badgeArea: { width: 180, height: 120, alignItems: "center", justifyContent: "center" },
  sparkle: { position: "absolute" },
  ring: { position: "absolute", width: 92, height: 92, borderRadius: 46, backgroundColor: palette.success },
  badge: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center", backgroundColor: palette.success, borderWidth: 4, borderColor: palette.white },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "800", color: palette.heading, textAlign: "center" },
  code: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: palette.primary, backgroundColor: palette.primarySoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  text: { fontSize: 14, lineHeight: 20, color: palette.textSecondary, textAlign: "center" },
  list: { flexGrow: 0 },
  listContent: { padding: 16, gap: 8 },
  work: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  workCheck: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.success },
  workText: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: "700", color: palette.text },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: palette.amberSoft },
  warningText: { flex: 1, fontSize: 12, lineHeight: 17, color: palette.amber },
  actions: { padding: 16, paddingTop: 4, gap: 4, borderTopWidth: 1, borderTopColor: palette.border },
  deliver: { backgroundColor: palette.orange, borderColor: palette.orange },
  error: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: palette.dangerSoft },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, color: palette.danger },
});

import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { DELETION_NOUN, deletionConsequences, deletionReasonText, type DeletionCheck, type DeletionKind, type DeletionPort, type DeletionScope } from "../domain/deletion";
import { PrivateModal } from "../security/DeviceSecurityContext";
import { Button } from "../ui/components";
import { palette, radius } from "../ui/theme";

type Phase =
  | { step: "checking" }
  | { step: "blocked"; check: DeletionCheck }
  | { step: "confirm"; check: DeletionCheck }
  | { step: "deleting"; check: DeletionCheck }
  | { step: "done"; check: DeletionCheck }
  | { step: "error"; message: string; check: DeletionCheck | null };

const native = Platform.OS !== "web";
const failureText = (failure: unknown) => failure instanceof Error && failure.message ? failure.message : "No se pudo completar. Revisa tu conexión e inténtalo de nuevo.";

/**
 * Confirmación para eliminar un trabajo, mantenimiento u OT que el técnico creó: primero pregunta al servidor si se
 * puede (y explica por qué no), luego muestra lo que se pierde y, al eliminar, una confirmación animada.
 */
export function DeleteRecordDialog({ port, scope, kind, name, onClose, onDeleted }: {
  port: DeletionPort; scope: DeletionScope; kind: DeletionKind; name?: string | null;
  onClose: () => void; onDeleted: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ step: "checking" });
  const appear = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const mounted = useRef(true);
  const noun = DELETION_NOUN[kind];

  useEffect(() => {
    mounted.current = true;
    Animated.spring(appear, { toValue: 1, friction: 8, tension: 70, useNativeDriver: native }).start();
    void port.deletionCheck(scope).then((check) => {
      if (mounted.current) setPhase(check.allowed ? { step: "confirm", check } : { step: "blocked", check });
    }, (failure: unknown) => { if (mounted.current) setPhase({ step: "error", message: failureText(failure), check: null }); });
    return () => { mounted.current = false; };
  }, []);

  // Pulso suave del ícono mientras se espera la decisión.
  useEffect(() => {
    if (phase.step !== "confirm") { pulse.stopAnimation(); pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: native }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: native })
    ]));
    loop.start();
    return () => loop.stop();
  }, [phase.step]);

  useEffect(() => {
    if (phase.step !== "done") return;
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 80, useNativeDriver: native }).start();
    const timer = setTimeout(() => { if (mounted.current) onDeleted(); }, 1400);
    return () => clearTimeout(timer);
  }, [phase.step]);

  function close() {
    if (phase.step === "deleting" || phase.step === "done") return;
    Animated.timing(appear, { toValue: 0, duration: 160, useNativeDriver: native }).start(() => onClose());
  }

  async function confirm(check: DeletionCheck) {
    setPhase({ step: "deleting", check });
    try {
      const result = await port.deleteRecord(scope);
      if (!mounted.current) return;
      setPhase(result.deleted ? { step: "done", check: result } : { step: "blocked", check: result });
    } catch (failure) {
      if (mounted.current) setPhase({ step: "error", message: failureText(failure), check });
    }
  }

  const check = "check" in phase ? phase.check : null;
  const label = (name ?? check?.title ?? "").trim();
  const reason = phase.step === "blocked" ? deletionReasonText(phase.check) : null;
  const tone = phase.step === "done" ? { color: palette.success, soft: palette.successSoft, icon: "checkmark" as const }
    : phase.step === "blocked" ? { color: palette.amber, soft: palette.amberSoft, icon: "lock-closed" as const }
      : phase.step === "error" ? { color: palette.danger, soft: palette.dangerSoft, icon: "cloud-offline-outline" as const }
        : { color: palette.danger, soft: palette.dangerSoft, icon: "trash" as const };
  const ring = { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] };
  const card = { opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }, { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] };

  return <PrivateModal visible transparent animationType="none" onRequestClose={close}>
    <Animated.View style={[styles.overlay, { opacity: appear }]}>
      <Animated.View style={[styles.card, card]} accessibilityViewIsModal accessibilityRole="alert">
        <View style={styles.iconWrap}>
          {phase.step === "confirm" ? <Animated.View style={[styles.ring, { backgroundColor: tone.color }, ring]} /> : null}
          <Animated.View style={[styles.icon, { backgroundColor: tone.soft }, phase.step === "done" ? { transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] } : null]}>
            {phase.step === "checking" || phase.step === "deleting" ? <ActivityIndicator color={tone.color} />
              : <Ionicons name={tone.icon} size={34} color={tone.color} accessible={false} />}
          </Animated.View>
        </View>

        <Text style={styles.title} accessibilityRole="header">
          {phase.step === "checking" ? "Revisando…" : phase.step === "deleting" ? `Eliminando ${noun.one}…` : phase.step === "done" ? `${noun.the.charAt(0).toUpperCase()}${noun.the.slice(1)} se eliminó`
            : phase.step === "blocked" ? reason!.title : phase.step === "error" ? "No se pudo completar" : `¿Eliminar ${noun.this}?`}
        </Text>
        {label && phase.step !== "error" ? <View style={styles.namePill}><Text style={styles.nameText} numberOfLines={2}>{label}</Text></View> : null}

        {phase.step === "checking" ? <Text style={styles.text}>Confirmando que se pueda eliminar.</Text> : null}
        {phase.step === "blocked" ? <View style={[styles.note, { backgroundColor: palette.amberSoft }]}>
          <Ionicons name="information-circle" size={18} color={palette.amber} accessible={false} />
          <Text style={[styles.noteText, { color: palette.heading }]}>{reason!.detail}</Text>
        </View> : null}
        {phase.step === "error" ? <Text style={styles.text}>{phase.message}</Text> : null}
        {phase.step === "done" ? <Text style={styles.text}>Ya no aparece en tu jornada.</Text> : null}
        {phase.step === "confirm" || phase.step === "deleting" ? <View style={styles.list}>
          {deletionConsequences(phase.check).map((item) => <View key={item.text} style={styles.item}>
            <View style={styles.itemIcon}><Ionicons name={item.icon} size={16} color={palette.danger} accessible={false} /></View>
            <Text style={styles.itemText}>{item.text}</Text>
          </View>)}
        </View> : null}

        {phase.step === "confirm" || phase.step === "deleting" ? <View style={styles.actions}>
          <View style={styles.grow}><Button title="Cancelar" variant="secondary" disabled={phase.step === "deleting"} onPress={close} /></View>
          <View style={styles.grow}><Button title="Eliminar" icon="trash-outline" variant="danger" loading={phase.step === "deleting"} disabled={phase.step === "deleting"} onPress={() => void confirm(phase.check)} /></View>
        </View> : phase.step === "error" && phase.check?.allowed ? <View style={styles.actions}>
          <View style={styles.grow}><Button title="Cerrar" variant="secondary" onPress={close} /></View>
          <View style={styles.grow}><Button title="Reintentar" icon="refresh" variant="danger" onPress={() => void confirm(phase.check!)} /></View>
        </View> : phase.step !== "done" && phase.step !== "checking" ? <Button title="Entendido" onPress={close} /> : null}
      </Animated.View>
    </Animated.View>
  </PrivateModal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(15,23,42,0.55)" },
  card: { width: "100%", maxWidth: 420, alignItems: "center", gap: 12, padding: 22, borderRadius: radius.xl, backgroundColor: palette.surface, boxShadow: "0px 18px 40px rgba(15, 23, 42, 0.25)" },
  iconWrap: { width: 84, height: 84, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  ring: { position: "absolute", width: 72, height: 72, borderRadius: 36 },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 19, lineHeight: 25, fontWeight: "800", color: palette.heading, textAlign: "center" },
  namePill: { maxWidth: "100%", paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  nameText: { fontSize: 13, fontWeight: "700", color: palette.textSecondary, textAlign: "center" },
  text: { fontSize: 14, lineHeight: 20, color: palette.textSecondary, textAlign: "center" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, alignSelf: "stretch", padding: 12, borderRadius: radius.md },
  noteText: { flex: 1, fontSize: 14, lineHeight: 20 },
  list: { alignSelf: "stretch", gap: 8 },
  item: { flexDirection: "row", alignItems: "center", gap: 10 },
  itemIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: palette.dangerSoft },
  itemText: { flex: 1, fontSize: 14, lineHeight: 19, color: palette.text },
  actions: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 4 },
  grow: { flex: 1 }
});

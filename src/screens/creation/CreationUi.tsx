import { useEffect, useRef, type ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Pasos de la creación (como la inspección): barra de avance animada y cada paso con su ícono; se puede volver a uno anterior. */
export function CreationStepper({ steps, current, onPick }: { steps: Array<{ label: string; icon: IconName }>; current: number; onPick?: (index: number) => void }) {
  const progress = useRef(new Animated.Value(current)).current;
  useEffect(() => { Animated.timing(progress, { toValue: current, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); }, [current]);
  return <View style={styles.stepper} accessibilityLabel={`Paso ${current + 1} de ${steps.length}: ${steps[current]?.label ?? ""}`}>
    <View style={styles.bars}>
      {steps.map((step, index) => <View key={step.label} style={styles.bar}>
        <Animated.View style={[styles.barFill, { width: progress.interpolate({ inputRange: [index - 1, index], outputRange: ["0%", "100%"], extrapolate: "clamp" }) }]} />
      </View>)}
    </View>
    <View style={styles.stepRow}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return <Pressable key={step.label} accessibilityRole="button" accessibilityState={{ selected: active, disabled: !done || !onPick }} disabled={!done || !onPick}
          onPress={() => onPick?.(index)} style={styles.stepItem}>
          <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
            <Ionicons name={done ? "checkmark" : step.icon} size={14} color={done || active ? palette.white : palette.textMuted} accessible={false} />
          </View>
          <Text style={[styles.stepLabel, (active || done) && styles.stepLabelOn]} numberOfLines={1}>{step.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

export interface ReviewSection { title: string; icon: IconName; step: number; rows: Array<{ icon: IconName; label: string; value: string; strong?: boolean }> }

/** Resumen antes de crear, por secciones con ícono y un acceso para corregir cada una. */
export function CreationReview({ sections, note, disabled, onEdit }: { sections: ReviewSection[]; note: string; disabled: boolean; onEdit: (step: number) => void }) {
  return <View style={styles.review}>
    {sections.map((section) => <View key={section.title} style={styles.reviewCard}>
      <View style={styles.reviewHead}>
        <View style={styles.reviewIcon}><Ionicons name={section.icon} size={16} color={palette.primary} accessible={false} /></View>
        <Text style={styles.reviewTitle} accessibilityRole="header">{section.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Editar ${section.title.toLowerCase()}`} disabled={disabled} hitSlop={8} onPress={() => onEdit(section.step)}
          style={({ pressed }) => [styles.editLink, pressed && styles.pressed]}>
          <Ionicons name="create-outline" size={14} color={palette.primary} accessible={false} />
          <Text style={styles.editText}>Editar</Text>
        </Pressable>
      </View>
      {section.rows.map((row) => <View key={row.label} style={styles.reviewRow}>
        <Ionicons name={row.icon} size={16} color={palette.textMuted} accessible={false} />
        <Text style={styles.reviewLabel}>{row.label}</Text>
        <Text style={[styles.reviewValue, row.strong && styles.reviewValueStrong]} numberOfLines={3}>{row.value}</Text>
      </View>)}
    </View>)}
    <View style={styles.reviewNote}>
      <Ionicons name="person-circle-outline" size={18} color={palette.info} accessible={false} />
      <Text style={styles.reviewNoteText}>{note}</Text>
    </View>
  </View>;
}

const SPARKS = Array.from({ length: 10 }, (_, index) => ({ angle: (index / 10) * Math.PI * 2, color: [palette.primary, palette.success, palette.orange, palette.info, palette.violet][index % 5] }));

/** Ventana de éxito al crear: ícono animado, resumen y qué hacer después (ver los trabajos, crear otro o abrir el creado). */
export function CreationDone({ title, subtitle, code, details, primary, secondary, tertiary, busy, icon = "checkmark", question = "¿Qué quieres hacer ahora?" }: {
  title: string; subtitle: string; code: string | null; details: Array<{ icon: IconName; label: string }>;
  primary: { label: string; icon: IconName; onPress: () => void }; secondary?: { label: string; icon: IconName; onPress: () => void };
  tertiary?: { label: string; onPress: () => void }; busy: boolean; icon?: IconName; question?: string | null;
}) {
  const backdrop = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;
  const badge = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const sparks = useRef(new Animated.Value(0)).current;
  const content = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduced) => {
      if (!active) return;
      if (reduced) { [backdrop, card, badge, sparks, ...content].forEach((value) => value.setValue(1)); return; }
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(card, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }),
        Animated.sequence([Animated.delay(140), Animated.spring(badge, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true })]),
        Animated.sequence([Animated.delay(260), Animated.timing(sparks, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true })]),
        Animated.sequence([Animated.delay(320), Animated.stagger(110, content.map((value) => Animated.timing(value, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true })))])
      ]).start();
      loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
      loop.start();
    });
    return () => { active = false; loop?.stop(); };
  }, []);
  const rise = (value: Animated.Value) => ({ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] });
  return <Animated.View style={[styles.doneOverlay, { opacity: backdrop }]} accessibilityViewIsModal testID="creation-done">
    <Animated.View style={[styles.doneCard, { opacity: card, transform: [{ translateY: card.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }, { scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
      <View style={styles.badgeArea}>
        <Animated.View style={[styles.ring, { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }] }]} />
        {SPARKS.map((spark, index) => <Animated.View key={index} style={[styles.spark, { backgroundColor: spark.color,
          opacity: sparks.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
          transform: [{ translateX: sparks.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(spark.angle) * 64] }) },
            { translateY: sparks.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(spark.angle) * 64] }) }] }]} />)}
        <Animated.View style={[styles.badge, { transform: [{ scale: badge }, { rotate: badge.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }] }]}>
          <Ionicons name={icon} size={icon === "checkmark" ? 44 : 36} color={palette.white} accessible={false} />
        </Animated.View>
      </View>
      <Animated.View style={[styles.doneText, rise(content[0])]}>
        <Text style={styles.doneTitle} accessibilityRole="header">{title}</Text>
        {code ? <View style={styles.codePill}><Text style={styles.codeText}>{code}</Text></View> : null}
        <Text style={styles.doneSubtitle}>{subtitle}</Text>
      </Animated.View>
      {details.length > 0 ? <Animated.View style={[styles.doneDetails, rise(content[1])]}>
        {details.map((detail) => <View key={detail.label} style={styles.doneDetail}>
          <Ionicons name={detail.icon} size={16} color={palette.primary} accessible={false} />
          <Text style={styles.doneDetailText} numberOfLines={2}>{detail.label}</Text>
        </View>)}
      </Animated.View> : null}
      <Animated.View style={[styles.doneActions, rise(content[2])]}>
        {question ? <Text style={styles.doneQuestion}>{question}</Text> : null}
        <Button title={primary.label} icon={primary.icon} disabled={busy} onPress={primary.onPress} />
        {secondary ? <Button title={secondary.label} icon={secondary.icon} variant="secondary" disabled={busy} onPress={secondary.onPress} /> : null}
        {tertiary ? <Button title={tertiary.label} variant="ghost" disabled={busy} onPress={tertiary.onPress} /> : null}
      </Animated.View>
    </Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  stepper: { gap: 10 },
  bars: { flexDirection: "row", gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: palette.track },
  barFill: { height: 4, borderRadius: 2, backgroundColor: palette.primary },
  stepRow: { flexDirection: "row", gap: 6 },
  stepItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  stepDotActive: { backgroundColor: palette.primary },
  stepDotDone: { backgroundColor: palette.success },
  stepLabel: { flex: 1, fontSize: 13, fontWeight: "600", color: palette.textMuted },
  stepLabelOn: { color: palette.heading, fontWeight: "800" },
  review: { gap: 12 },
  reviewCard: { gap: 10, padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  reviewIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  reviewTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: palette.heading },
  editLink: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: palette.primarySoft },
  editText: { fontSize: 12, fontWeight: "800", color: palette.primary },
  pressed: { opacity: 0.7 },
  reviewRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: palette.track },
  reviewLabel: { width: 96, fontSize: 13, color: palette.textSecondary },
  reviewValue: { flex: 1, fontSize: 14, fontWeight: "600", color: palette.text },
  reviewValueStrong: { fontSize: 15, fontWeight: "800", color: palette.heading },
  reviewNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: palette.infoSoft },
  reviewNoteText: { flex: 1, ...typography.caption, color: palette.info },
  doneOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "rgba(15,23,42,0.55)" },
  doneCard: { width: "100%", maxWidth: 440, alignItems: "stretch", gap: 16, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 20, borderRadius: radius.xl, backgroundColor: palette.surface },
  badgeArea: { height: 110, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: 96, height: 96, borderRadius: 48, backgroundColor: palette.success },
  spark: { position: "absolute", width: 8, height: 8, borderRadius: 4 },
  badge: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center", backgroundColor: palette.success, borderWidth: 6, borderColor: palette.successSoft },
  doneText: { alignItems: "center", gap: 8 },
  doneTitle: { fontSize: 22, lineHeight: 28, fontWeight: "800", color: palette.heading, textAlign: "center" },
  codePill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.primarySoft },
  codeText: { fontSize: 13, fontWeight: "800", color: palette.primary, letterSpacing: 0.4 },
  doneSubtitle: { ...typography.body, color: palette.textSecondary, textAlign: "center" },
  doneDetails: { gap: 8, padding: 14, borderRadius: radius.md, backgroundColor: palette.background },
  doneDetail: { flexDirection: "row", alignItems: "center", gap: 8 },
  doneDetailText: { flex: 1, fontSize: 14, fontWeight: "600", color: palette.text },
  doneActions: { gap: 10 },
  doneQuestion: { fontSize: 13, fontWeight: "700", color: palette.textSecondary, textAlign: "center" }
});

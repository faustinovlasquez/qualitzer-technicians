import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, type IconName } from "../ui/components";
import { palette, radius, typography } from "../ui/theme";
import type { MaterialReceipt } from "../domain/materialReceipts";
import { parseReturnQuantity, receiptQuantity, stepReturnQuantity } from "./receiptTimeline";

type Product = MaterialReceipt["products"][number];
const nativeDriver = Platform.OS !== "web";
const quantityText = (value: number) => String(Math.round(value * 10000) / 10000).replace(".", ",");

/** Paso que entra con un deslizamiento suave desde el lado en que avanza el técnico. */
function Step({ direction, children }: { direction: 1 | -1; children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(progress, { toValue: 1, duration: 240, useNativeDriver: nativeDriver }).start(); }, [progress]);
  return <Animated.View style={{ opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [24 * direction, 0] }) }] }}>{children}</Animated.View>;
}

function Consequence({ icon, color, soft, text }: { icon: IconName; color: string; soft: string; text: string }) {
  return <View style={styles.consequence}>
    <View style={[styles.consequenceIcon, { backgroundColor: soft }]}><Ionicons name={icon} size={18} color={color} accessible={false} /></View>
    <Text style={styles.consequenceText}>{text}</Text>
  </View>;
}

/**
 * Solicitud de devolución en dos pasos: primero cuánto se devuelve (y una nota opcional), luego un resumen de lo que
 * implica antes de enviarla a bodega.
 */
export function ReturnRequestDialog({ product, initial, busy, onCancel, onSubmit }: { product: Product | null; initial?: { quantity: number; note: string | null } | null;
  busy: boolean; onCancel: () => void; onSubmit: (value: { quantity: number; note: string }) => void }) {
  // Ventana centrada que respeta la barra de estado y los botones del teléfono.
  const insets = useSafeAreaInsets();
  const max = product?.quantity ?? 0;
  const [step, setStep] = useState<"quantity" | "confirm">("quantity");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!product) return;
    setStep("quantity");
    setText(quantityText(initial?.quantity ?? product.quantity));
    setNote(initial?.note ?? "");
  }, [product?.id, initial?.quantity, initial?.note]);
  const quantity = parseReturnQuantity(text, max);
  const invalid = text.trim() !== "" && quantity === null;
  const unit = product?.unit ?? "";
  const step1 = (delta: 1 | -1) => setText(quantityText(stepReturnQuantity(quantity ?? (delta === 1 ? 0 : max), delta, max)));
  const partial = quantity !== null && quantity < max;
  return <Modal visible={product !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) onCancel(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.backdrop, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.sheet} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <View style={styles.headIcon}><Ionicons name="return-down-back" size={22} color={palette.orange} accessible={false} /></View>
            <View style={styles.headText}>
              <Text accessibilityRole="header" style={styles.title}>{step === "quantity" ? "¿Cuánto vas a devolver?" : "Confirma la devolución"}</Text>
              <Text style={styles.subtitle} numberOfLines={2}>{product ? `${product.code ? `${product.code} · ` : ""}${product.name}` : ""}</Text>
            </View>
          </View>
          <View style={styles.steps} accessible={false}>
            <View style={[styles.stepDot, styles.stepDotOn]} /><View style={[styles.stepLine, step === "confirm" && styles.stepLineOn]} /><View style={[styles.stepDot, step === "confirm" && styles.stepDotOn]} />
          </View>

          {step === "quantity" ? <Step key="quantity" direction={-1}>
            <View style={styles.body}>
              <Text style={styles.label}>{`Recibiste ${receiptQuantity(max, unit)}`}</Text>
              <View style={styles.stepper}>
                <Pressable accessibilityRole="button" accessibilityLabel="Restar uno" disabled={busy || (quantity !== null && quantity <= Math.min(1, max))} onPress={() => step1(-1)}
                  style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}>
                  <Ionicons name="remove" size={22} color={palette.primary} accessible={false} />
                </Pressable>
                <View style={[styles.quantityBox, invalid && styles.quantityBoxError]}>
                  <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" accessibilityLabel="Cantidad a devolver" selectTextOnFocus
                    editable={!busy} style={styles.quantityInput} maxLength={12} />
                  <Text style={styles.quantityUnit}>{unit}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Sumar uno" disabled={busy || (quantity !== null && quantity >= max)} onPress={() => step1(1)}
                  style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}>
                  <Ionicons name="add" size={22} color={palette.primary} accessible={false} />
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setText(quantityText(max))} style={[styles.chip, quantity === max && styles.chipOn]}>
                <Text style={[styles.chipText, quantity === max && styles.chipTextOn]}>{`Devolver todo (${receiptQuantity(max, unit)})`}</Text>
              </Pressable>
              {invalid ? <Text accessibilityRole="alert" style={styles.error}>{`Escribe una cantidad mayor que 0 y hasta ${receiptQuantity(max, unit)}.`}</Text> : null}
              <Text style={styles.label}>Nota para bodega (opcional)</Text>
              <TextInput value={note} onChangeText={setNote} placeholder="Ej.: sobró material, venía dañado, no correspondía" placeholderTextColor={palette.textMuted}
                multiline maxLength={1000} editable={!busy} style={styles.note} accessibilityLabel="Nota para bodega" />
            </View>
            <View style={styles.actions}>
              <Button title="Cancelar" variant="secondary" disabled={busy} onPress={onCancel} style={styles.flex} />
              <Button title="Continuar" icon="arrow-forward" disabled={busy || quantity === null} onPress={() => setStep("confirm")} style={styles.flex} />
            </View>
          </Step> : <Step key="confirm" direction={1}>
            <View style={styles.body}>
              <View style={styles.summary}>
                <Text style={styles.summaryQuantity}>{receiptQuantity(quantity ?? 0, unit)}</Text>
                <Text style={styles.summaryText}>{partial ? `de ${receiptQuantity(max, unit)} recibidos` : "todo lo recibido"}</Text>
              </View>
              {note.trim() ? <View style={styles.notePreview}><Ionicons name="chatbubble-ellipses-outline" size={15} color={palette.textSecondary} accessible={false} />
                <Text style={styles.notePreviewText}>{note.trim()}</Text></View> : null}
              <Consequence icon="notifications-outline" color={palette.info} soft={palette.infoSoft} text="Bodega recibirá un aviso y un correo con tu solicitud." />
              <Consequence icon="cube-outline" color={palette.orange} soft={palette.orangeSoft} text="El material sigue a tu cargo hasta que bodega confirme que lo recibió." />
              {partial ? <Consequence icon="checkmark-circle-outline" color={palette.success} soft={palette.successSoft}
                text={`Lo que no devuelvas (${receiptQuantity(max - (quantity ?? 0), unit)}) se considera utilizado.`} /> : null}
              <Consequence icon="create-outline" color={palette.textSecondary} soft={palette.track} text="Mientras esté pendiente puedes cambiar la cantidad o cancelarla marcando Utilizado." />
            </View>
            <View style={styles.actions}>
              <Button title="Volver" variant="secondary" icon="arrow-back" disabled={busy} onPress={() => setStep("quantity")} style={styles.flex} />
              <Button title="Solicitar devolución" icon="return-down-back" loading={busy} disabled={busy || quantity === null}
                onPress={() => { if (quantity !== null) onSubmit({ quantity, note: note.trim() }); }} style={styles.flex} />
            </View>
          </Step>}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, pressed: { opacity: 0.7 },
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { width: "100%", maxWidth: 480, maxHeight: "100%", borderRadius: radius.lg, backgroundColor: palette.surface, overflow: "hidden" },
  content: { padding: 18, gap: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: palette.orangeSoft },
  headText: { flex: 1, minWidth: 0 }, title: { ...typography.label, fontSize: 17, color: palette.heading }, subtitle: { ...typography.caption, color: palette.textSecondary },
  steps: { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: 6 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.track }, stepDotOn: { backgroundColor: palette.orange },
  stepLine: { width: 36, height: 3, borderRadius: 2, backgroundColor: palette.track }, stepLineOn: { backgroundColor: palette.orange },
  body: { gap: 12 },
  label: { ...typography.label, color: palette.text },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepButton: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: palette.primaryBorder, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  quantityBox: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: palette.border },
  quantityBoxError: { borderColor: palette.danger },
  quantityInput: { minWidth: 60, textAlign: "center", fontSize: 24, fontWeight: "800", color: palette.heading, paddingVertical: 0 },
  quantityUnit: { fontSize: 14, fontWeight: "700", color: palette.textSecondary },
  chip: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border },
  chipOn: { borderColor: palette.orange, backgroundColor: palette.orangeSoft }, chipText: { fontSize: 13, fontWeight: "700", color: palette.textSecondary }, chipTextOn: { color: palette.orange },
  error: { ...typography.caption, color: palette.danger, fontWeight: "700" },
  note: { minHeight: 72, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, fontSize: 15, color: palette.text, textAlignVertical: "top" },
  summary: { alignItems: "center", gap: 2, paddingVertical: 14, borderRadius: radius.md, backgroundColor: palette.orangeSoft },
  summaryQuantity: { fontSize: 28, fontWeight: "800", color: palette.orange }, summaryText: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
  notePreview: { flexDirection: "row", gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: palette.background },
  notePreviewText: { flex: 1, ...typography.caption, color: palette.text },
  consequence: { flexDirection: "row", alignItems: "center", gap: 10 },
  consequenceIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  consequenceText: { flex: 1, ...typography.caption, color: palette.text, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
});

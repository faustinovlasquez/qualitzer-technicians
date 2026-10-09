import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DeviceSecurityContext, PrivateModal as Modal } from "../../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput, MaintenanceFaultType } from "../../../domain/orderLifecycle";
import { defaultUserSignature, ownSignatureOptions, type UserSignatureAccess, type UserSignatureOptions } from "../../../domain/userSignatures";
import { signatureImagePng } from "../../../infrastructure/signatureImage";
import { UserSignaturesPanel } from "../../signatures/UserSignaturesPanel";
import { Button, Field, SectionTitle } from "../../../ui/components";
import { palette, radius } from "../../../ui/theme";
import { Notice } from "../../workDetail/DetailUi";
import { DELIVERY_NOTE_LIMIT, deliveryDraftErrors, technicianDeliveryInput, lifecycleError, type DeliveryDraft, type DeliveryErrors } from "./lifecycleRules";
import { styles } from "./lifecycleStyles";
import { SignatureField } from "./SignatureField";
import { hasSignature, requireSignaturePng, type SignaturePadHandle } from "./signatureGeometry";

export interface MaintenanceDeliveryDialogProps {
  orderLabel: string;
  tenantName?: string;
  technicianName: string;
  signatureAccess?: UserSignatureAccess;
  mode: "live" | "demo";
  context: MaintenanceDeliveryContext;
  draft: DeliveryDraft;
  busy: boolean;
  unavailable: boolean;
  reasons: string[];
  error: string | null;
  onChange: (draft: DeliveryDraft) => void;
  onClose: () => void;
  onSubmit: (input: MaintenanceDeliveryInput) => Promise<void>;
  onReload: () => void;
  /** Aviso de éxito cuando la ventana se abre sola tras entregar el último trabajo. */
  readyMessage?: string | null;
}

// Mismos textos que la entrega de mantenimiento del panel web.
const faultOptions: { value: Exclude<MaintenanceFaultType, "undetermined">; title: string; detail: string }[] = [
  { value: "operative", title: "Falla operativa", detail: "Mal uso o manejo inadecuado del arrendatario. Costo cobrable al arrendatario." },
  { value: "wear", title: "Falla por desgaste", detail: "Desgaste natural o uso normal del equipo. Costo absorbido por la empresa." },
];

function DeliveryCard({ icon, title, required = false, warning = false, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; required?: boolean; warning?: boolean; children: ReactNode }) {
  return <View style={cards.card}>
    <View style={cards.cardHeader}>
      <Ionicons name={icon} size={18} color={warning ? palette.orange : palette.info} accessible={false} />
      <Text accessibilityRole="header" style={cards.cardTitle}>{title.toUpperCase()}{required ? <Text style={cards.required}> *</Text> : null}</Text>
    </View>
    <View style={cards.cardBody}>{children}</View>
  </View>;
}

export function MaintenanceDeliveryDialog(props: MaintenanceDeliveryDialogProps) {
  const { draft, context, busy, unavailable, onChange } = props;
  const technicianPad = useRef<SignaturePadHandle>(null);
  const scroll = useRef<ScrollView>(null);
  const lease = useRef(false);
  const [drawing, setDrawing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [managingSignatures, setManagingSignatures] = useState(false);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const latest = useRef(props); latest.current = props;
  const active = useRef(true);
  const selectionVersion = useRef(0);
  const security = useContext(DeviceSecurityContext);
  const securityRef = useRef(security); securityRef.current = security;
  useEffect(() => { active.current = true; return () => { active.current = false; selectionVersion.current += 1; }; }, []);
  const faultTypeSupported = context.technicianFaultTypeSupported === true;
  const errors: DeliveryErrors = attempted ? deliveryDraftErrors(draft, false, faultTypeSupported) : {};
  const locked = busy || preparing || signatureLoading;
  const blocked = locked || unavailable;

  async function useCatalog(catalog: UserSignatureOptions): Promise<void> {
    const access = latest.current.signatureAccess;
    if (!access) return;
    const version = ++selectionVersion.current;
    const parsed = ownSignatureOptions(catalog, access.userId, access.branchId);
    const existing = latest.current.draft.technicianProfileSignature;
    const selected = existing ? parsed.options.find(signature => signature.id === existing.id) ?? null
      : existing === undefined && !hasSignature(latest.current.draft.technicianStrokes) ? defaultUserSignature(parsed) : null;
    if (!selected?.signatureImage) {
      if (existing && active.current) latest.current.onChange({ ...latest.current.draft, technicianProfileSignature: null });
      return;
    }
    setSignatureLoading(true);
    try {
      const png = await signatureImagePng(selected.signatureImage);
      if (!active.current || selectionVersion.current !== version || latest.current.signatureAccess?.scopeKey !== access.scopeKey
        || !(securityRef.current?.isUnlocked() ?? true) || hasSignature(latest.current.draft.technicianStrokes)) return;
      latest.current.onChange({ ...latest.current.draft, technicianProfileSignature: { id: selected.id, name: selected.signatureName, png } });
      setSignatureError(null);
    } catch (failure) { if (active.current && selectionVersion.current === version) setSignatureError(failure instanceof Error ? failure.message : "No se pudo cargar la firma del perfil."); }
    finally { if (active.current && selectionVersion.current === version) setSignatureLoading(false); }
  }

  useEffect(() => {
    let current = true;
    const access = latest.current.signatureAccess;
    if (access?.available) void access.actions.load().then(catalog => { if (current) return useCatalog(catalog); }).catch((failure: unknown) => {
      if (current) setSignatureError(failure instanceof Error ? failure.message : "No se pudieron consultar las firmas del perfil.");
    });
    return () => { current = false; selectionVersion.current += 1; };
  }, [props.signatureAccess?.scopeKey, props.signatureAccess?.available]);

  function update(patch: Partial<DeliveryDraft>): void {
    if (blocked || lease.current) return;
    setCaptureError(null);
    onChange({ ...draft, ...patch });
  }

  async function prepare(): Promise<void> {
    if (blocked || drawing || lease.current) return;
    setAttempted(true);
    if (Object.keys(deliveryDraftErrors(draft, false, faultTypeSupported)).length > 0) {
      scroll.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    lease.current = true;
    setPreparing(true);
    setCaptureError(null);
    try {
      if (!draft.technicianProfileSignature && !technicianPad.current) throw new Error("El área de firma no está disponible. Vuelve a abrir la entrega.");
      const technicianSignature = draft.technicianProfileSignature ? requireSignaturePng(draft.technicianProfileSignature.png) : await technicianPad.current!.capture();
      if (!active.current || !(securityRef.current?.isUnlocked() ?? true)) return;
      await props.onSubmit(technicianDeliveryInput(draft, technicianSignature, faultTypeSupported));
    } catch (error) { setCaptureError(lifecycleError(error)); }
    finally { lease.current = false; setPreparing(false); }
  }

  if (managingSignatures && props.signatureAccess) return <Modal visible animationType="slide" onRequestClose={() => { if (!busy) setManagingSignatures(false); }}>
    <SafeAreaView style={{ flex: 1 }}><UserSignaturesPanel access={props.signatureAccess} onBack={() => setManagingSignatures(false)}
      onCatalog={catalog => { void useCatalog(catalog); }}
      onSelect={signature => { selectionVersion.current += 1; setSignatureLoading(false); setSignatureError(null); onChange({ ...latest.current.draft, technicianStrokes: [], technicianProfileSignature: signature }); setManagingSignatures(false); }} /></SafeAreaView>
  </Modal>;

  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!locked && !drawing) props.onClose(); }}>
    <SafeAreaView style={styles.overlay}>
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <SectionTitle title="Entrega de mantenimiento" subtitle={`${props.orderLabel} · Completa el resumen para registrar la entrega.`} />
        </View>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" scrollEnabled={!drawing} contentContainerStyle={styles.content}>
          {props.mode === "demo" ? <Notice message="Demostración: esta entrega no modifica datos reales." /> : null}
          {unavailable ? <Notice tone="warning" message="La OT no está disponible para entrega." /> : null}
          {props.error ? <Notice tone="error" message={props.error} /> : null}
          {captureError ? <Notice tone="error" message={captureError} /> : null}
          {props.readyMessage ? <Notice tone="success" message={props.readyMessage} /> : null}
          {props.reasons.length > 0 ? <Notice tone="warning" message={`Checklists incompletos: ${props.reasons.slice(0, 3).join(", ")}${props.reasons.length > 3 ? ` y ${props.reasons.length - 3} más` : ""}. Se entregarán tal como están.`} /> : null}
          <View style={styles.stack}>
            <DeliveryCard icon="checkmark-circle-outline" title="Nota técnica">
              <Field label="Observaciones del técnico" value={draft.note} onChangeText={(note) => update({ note })} multiline maxLength={DELIVERY_NOTE_LIMIT} editable={!blocked} style={styles.notes} error={errors.note} placeholder="Observaciones adicionales del técnico..." />
            </DeliveryCard>
            {faultTypeSupported ? <DeliveryCard icon="warning-outline" title="Tipo de falla" required warning>
              <View accessibilityRole="radiogroup" style={styles.tight}>
                {faultOptions.map(option => {
                  const selected = draft.faultType === option.value;
                  return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: blocked }} accessibilityLabel={`${option.title}. ${option.detail}`} disabled={blocked}
                    onPress={() => update({ faultType: option.value })} style={({ pressed }) => [cards.option, selected && cards.optionSelected, pressed && cards.pressed]}>
                    <View style={[cards.radio, selected && cards.radioSelected]}>{selected ? <View style={cards.radioDot} /> : null}</View>
                    <View style={cards.optionText}><Text style={cards.optionTitle}>{option.title}</Text><Text style={cards.optionDetail}>{option.detail}</Text></View>
                  </Pressable>;
                })}
              </View>
              {errors.faultType ? <Text accessibilityRole="alert" style={styles.error}>{errors.faultType}</Text> : null}
            </DeliveryCard> : null}
            <DeliveryCard icon="create-outline" title="Firma del técnico">
              {signatureError ? <Notice message={signatureError} tone="warning" /> : null}
              {signatureLoading ? <Text accessibilityLiveRegion="polite" style={styles.caption}>Preparando firma del perfil...</Text> : null}
              {draft.technicianProfileSignature ? <View style={styles.tight}>
                <Text style={styles.label}>Firma del perfil · {draft.technicianProfileSignature.name}</Text>
                <Image source={{ uri: draft.technicianProfileSignature.png }} style={styles.signaturePreview} resizeMode="contain" accessibilityLabel="Firma del tecnico desde el perfil" />
                <Button title="Dibujar firma" icon="create-outline" variant="ghost" disabled={blocked} onPress={() => { selectionVersion.current += 1; update({ technicianProfileSignature: null, technicianStrokes: [] }); }} />
              </View> : <SignatureField label="Firma del técnico" name={props.technicianName} strokes={draft.technicianStrokes} signatureRef={technicianPad} disabled={blocked} error={errors.technicianSignature} onChange={(technicianStrokes) => { selectionVersion.current += 1; update({ technicianStrokes, technicianProfileSignature: null }); }} onDrawingChange={setDrawing} />}
              {props.signatureAccess ? <Button title="Mis firmas: elegir, agregar o editar" icon="create-outline" variant="secondary" disabled={blocked || drawing || !props.signatureAccess.available} onPress={() => setManagingSignatures(true)} /> : null}
            </DeliveryCard>
            {errors.duration ? <Text accessibilityRole="alert" style={styles.error}>{errors.duration}</Text> : null}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <Button title={props.mode === "demo" ? "Finalizar entrega en demo" : "Finalizar entrega"} icon="paper-plane-outline" loading={locked} disabled={unavailable || drawing} onPress={() => { void prepare(); }} style={{ backgroundColor: palette.orange, borderColor: palette.orange }} />
          <Button title="Volver" variant="ghost" disabled={locked || drawing} onPress={props.onClose} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
const cards = StyleSheet.create({
  card: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, overflow: "hidden", backgroundColor: palette.surface },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: palette.background, borderBottomWidth: 1, borderBottomColor: palette.border },
  cardTitle: { fontSize: 13, lineHeight: 18, fontWeight: "800", letterSpacing: 0.6, color: palette.textSecondary },
  required: { color: palette.danger },
  cardBody: { padding: 12, gap: 8 },
  option: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  optionSelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  pressed: { opacity: 0.8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: palette.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  radioSelected: { borderColor: palette.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.primary },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionTitle: { fontSize: 14, lineHeight: 19, fontWeight: "800", color: palette.heading },
  optionDetail: { fontSize: 12, lineHeight: 17, color: palette.textSecondary },
});

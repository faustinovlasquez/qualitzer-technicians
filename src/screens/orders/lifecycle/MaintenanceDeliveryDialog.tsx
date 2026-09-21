import { useContext, useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { DeviceSecurityContext, PrivateModal as Modal } from "../../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../../../domain/orderLifecycle";
import { defaultUserSignature, ownSignatureOptions, type UserSignatureAccess, type UserSignatureOptions } from "../../../domain/userSignatures";
import { signatureImagePng } from "../../../infrastructure/signatureImage";
import { UserSignaturesPanel } from "../../signatures/UserSignaturesPanel";
import { Button, Field, SectionTitle } from "../../../ui/components";
import { NumericSelectField } from "../../../ui/time/NumericSelectField";
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
  const errors: DeliveryErrors = attempted ? deliveryDraftErrors(draft, false) : {};
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
    if (Object.keys(deliveryDraftErrors(draft, false)).length > 0) {
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
      await props.onSubmit(technicianDeliveryInput(draft, technicianSignature));
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
          <SectionTitle title="Entregar OT" subtitle={props.orderLabel} />
        </View>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" scrollEnabled={!drawing} contentContainerStyle={styles.content}>
          {props.mode === "demo" ? <Notice message="Demostración: esta entrega no modifica datos reales." /> : null}
          {unavailable ? <Notice tone="warning" message="La OT no está disponible para entrega." /> : null}
          {props.error ? <Notice tone="error" message={props.error} /> : null}
          {captureError ? <Notice tone="error" message={captureError} /> : null}
          <View style={styles.stack}>
            <Field label="Nota técnica" value={draft.note} onChangeText={(note) => update({ note })} multiline maxLength={DELIVERY_NOTE_LIMIT} editable={!blocked} style={styles.notes} error={errors.note} placeholder="Trabajos realizados y observaciones" />
            <View style={styles.tight}>
              <Text style={styles.label}>Duración total de la OT</Text>
              <View style={styles.row}>
                <NumericSelectField label="Horas (0–99)" value={draft.hours} max={99} onChange={(hours) => update({ hours })} disabled={blocked} scopeKey={context.groupId} containerStyle={styles.number} />
                <NumericSelectField label="Minutos (0–59)" value={draft.minutes} max={59} onChange={(minutes) => update({ minutes })} disabled={blocked} scopeKey={context.groupId} containerStyle={styles.number} />
              </View>
              {errors.duration ? <Text accessibilityRole="alert" style={styles.error}>{errors.duration}</Text> : null}
            </View>
            {signatureError ? <Notice message={signatureError} tone="warning" /> : null}
            {signatureLoading ? <Text accessibilityLiveRegion="polite" style={styles.caption}>Preparando firma del perfil...</Text> : null}
            {draft.technicianProfileSignature ? <View style={styles.tight}>
              <Text style={styles.label}>Firma del tecnico · {draft.technicianProfileSignature.name}</Text>
              <Image source={{ uri: draft.technicianProfileSignature.png }} style={styles.signaturePreview} resizeMode="contain" accessibilityLabel="Firma del tecnico desde el perfil" />
              <Button title="Dibujar firma" icon="create-outline" variant="ghost" disabled={blocked} onPress={() => { selectionVersion.current += 1; update({ technicianProfileSignature: null, technicianStrokes: [] }); }} />
            </View> : <SignatureField label="Firma del técnico" name={props.technicianName} strokes={draft.technicianStrokes} signatureRef={technicianPad} disabled={blocked} error={errors.technicianSignature} onChange={(technicianStrokes) => { selectionVersion.current += 1; update({ technicianStrokes, technicianProfileSignature: null }); }} onDrawingChange={setDrawing} />}
            {props.signatureAccess ? <Button title="Mis firmas: elegir, agregar o editar" icon="create-outline" variant="secondary" disabled={blocked || drawing || !props.signatureAccess.available} onPress={() => setManagingSignatures(true)} /> : null}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <Button title={props.mode === "demo" ? "Entregar OT en demo" : "Entregar OT"} icon="checkmark-circle-outline" loading={locked} disabled={unavailable || drawing} onPress={() => { void prepare(); }} style={{ backgroundColor: "#C4510A", borderColor: "#C4510A" }} />
          <Button title="Volver" variant="ghost" disabled={locked || drawing} onPress={props.onClose} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
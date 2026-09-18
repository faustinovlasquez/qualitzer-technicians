import { useContext, useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { DeviceSecurityContext, PrivateModal as Modal } from "../../../security/DeviceSecurityContext";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../../../domain/orderLifecycle";
import { defaultUserSignature, ownSignatureOptions, type UserSignatureAccess, type UserSignatureOptions } from "../../../domain/userSignatures";
import { signatureImagePng } from "../../../infrastructure/signatureImage";
import { UserSignaturesPanel } from "../../signatures/UserSignaturesPanel";
import { BodyText, Button, Field, SectionTitle } from "../../../ui/components";
import { NumericSelectField } from "../../../ui/time/NumericSelectField";
import { ChoiceButton, Notice } from "../../workDetail/DetailUi";
import { DELIVERY_NOTE_LIMIT, DELIVERY_RECEIVER_LIMIT, deliveryDraftErrors, deliveryInput, lifecycleError, requiresClientSignature, type DeliveryDraft, type DeliveryErrors } from "./lifecycleRules";
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
  const { draft, context, busy, unavailable, reasons, onChange } = props;
  const technicianPad = useRef<SignaturePadHandle>(null);
  const clientPad = useRef<SignaturePadHandle>(null);
  const scroll = useRef<ScrollView>(null);
  const lease = useRef(false);
  const [drawing, setDrawing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [review, setReview] = useState<MaintenanceDeliveryInput | null>(null);
  const [managingSignatures, setManagingSignatures] = useState(false);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const latest = useRef(props); latest.current = props;
  const active = useRef(true);
  const selectionVersion = useRef(0);
  const security = useContext(DeviceSecurityContext);
  const securityRef = useRef(security); securityRef.current = security;
  useEffect(() => { active.current = true; return () => { active.current = false; selectionVersion.current += 1; }; }, []);
  const clientRequired = requiresClientSignature(context.maintenanceType);
  const errors: DeliveryErrors = attempted ? deliveryDraftErrors(draft, clientRequired) : {};
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
    if (Object.keys(deliveryDraftErrors(draft, clientRequired)).length > 0 || reasons.length > 0) {
      scroll.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    lease.current = true;
    setPreparing(true);
    setCaptureError(null);
    try {
      if ((!draft.technicianProfileSignature && !technicianPad.current) || (clientRequired && !clientPad.current)) throw new Error("El área de firma no está disponible. Vuelve a abrir la entrega.");
      const technicianSignature = draft.technicianProfileSignature ? requireSignaturePng(draft.technicianProfileSignature.png) : await technicianPad.current!.capture();
      const clientSignature = clientRequired && clientPad.current ? await clientPad.current.capture() : null;
      setReview(deliveryInput(draft, clientRequired, technicianSignature, clientSignature));
      scroll.current?.scrollTo({ y: 0, animated: false });
    } catch (error) { setCaptureError(lifecycleError(error)); }
    finally { lease.current = false; setPreparing(false); }
  }

  async function confirm(): Promise<void> {
    if (blocked || lease.current || !review || reasons.length > 0) return;
    lease.current = true;
    setPreparing(true);
    try { await props.onSubmit(review); }
    catch (error) { setCaptureError(lifecycleError(error)); }
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
          <SectionTitle title={review ? "Confirmar entrega de OT" : "Preparar entrega de OT"} subtitle={`${props.orderLabel}${props.tenantName ? ` · ${props.tenantName}` : ""}`} />
          <Text style={styles.caption}>{review ? "Paso 2 de 2 · Revisión y confirmación" : "Paso 1 de 2 · Datos y firmas"}</Text>
        </View>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" scrollEnabled={!drawing} contentContainerStyle={styles.content}>
          {props.mode === "demo" ? <Notice message="Demostración: esta entrega no modifica datos reales." /> : null}
          {unavailable ? <Notice tone="warning" message="La OT ya no permite entrega. Actualiza su estado antes de continuar; no se modificarán sus datos desde este panel." /> : null}
          {reasons.length > 0 ? <View style={styles.tight}><Notice tone="warning" message="Hay checklists obligatorios pendientes. Guarda sus respuestas y evidencias, y actualiza esta entrega." />{reasons.map((reason) => <Text key={reason} style={styles.label}>• {reason}</Text>)}</View> : null}
          {props.error ? <Notice tone="error" message={props.error} /> : null}
          {captureError ? <Notice tone="error" message={captureError} /> : null}
          {!review && attempted && Object.keys(errors).length > 0 ? <Notice tone="error" message={Object.values(errors).join("\n")} /> : null}
          {review ? <View style={styles.stack}>
            <Notice tone="warning" message="La confirmación registrará la entrega de esta OT y sus firmas. El servidor aplicará el cierre correspondiente. Revisa todos los datos antes de continuar." />
            <View style={styles.review}>
              <Text style={styles.label}>Observaciones</Text>
              <BodyText>{review.note ?? "Sin observaciones"}</BodyText>
              <Text style={styles.label}>Duración total</Text>
              <BodyText>{review.durationMinutes ? `${Math.floor(review.durationMinutes / 60)} h ${review.durationMinutes % 60} min` : "Sin duración informada (se envía null)"}</BodyText>
              {review.faultType ? <><Text style={styles.label}>Tipo de falla</Text><BodyText>{review.faultType === "operative" ? "Operacional" : "Desgaste"}</BodyText></> : null}
            </View>
            <View style={styles.tight}>
              <Text style={styles.label}>Firma del técnico · {draft.technicianProfileSignature?.name ?? props.technicianName}</Text>
              {review.technicianSignature ? <Image source={{ uri: review.technicianSignature }} style={styles.signaturePreview} resizeMode="contain" accessibilityLabel="Vista previa PNG de la firma del técnico" /> : null}
            </View>
            {review.clientSignature ? <View style={styles.tight}><Text style={styles.label}>Recibe · {review.receivedByName}</Text><Image source={{ uri: review.clientSignature }} style={styles.signaturePreview} resizeMode="contain" accessibilityLabel="Vista previa PNG de la firma de quien recibe" /></View> : null}
          </View> : <View style={styles.stack}>
            <Field label="Observaciones del técnico" value={draft.note} onChangeText={(note) => update({ note })} multiline maxLength={DELIVERY_NOTE_LIMIT} editable={!blocked} style={styles.notes} error={errors.note} placeholder="Trabajos realizados, hallazgos y recomendaciones…" hint="Opcional. Se conservarán mientras revisas otras secciones de esta sesión." />
            <View style={styles.tight}>
              <Text style={styles.label}>Duración total de la OT</Text>
              <View style={styles.row}>
                <NumericSelectField label="Horas (0–99)" value={draft.hours} max={99} onChange={(hours) => update({ hours })} disabled={blocked} scopeKey={context.groupId} containerStyle={styles.number} />
                <NumericSelectField label="Minutos (0–59)" value={draft.minutes} max={59} onChange={(minutes) => update({ minutes })} disabled={blocked} scopeKey={context.groupId} containerStyle={styles.number} />
              </View>
              {errors.duration ? <Text accessibilityRole="alert" style={styles.error}>{errors.duration}</Text> : null}
              <BodyText>Sugerida según el tiempo registrado, sin duplicar cronómetros. Puedes corregirla; cero se envía como duración no informada.</BodyText>
            </View>
            {clientRequired ? <View style={styles.tight}>
              <Text style={styles.label}>Tipo de falla *</Text>
              <BodyText>Los correctivos y las detenciones requieren clasificar la falla e identificar a quien recibe.</BodyText>
              <ChoiceButton label="Operacional · uso u operación del equipo" selected={draft.faultType === "operative"} disabled={blocked} onPress={() => update({ faultType: "operative" })} />
              <ChoiceButton label="Desgaste · deterioro por uso o vida útil" selected={draft.faultType === "wear"} disabled={blocked} onPress={() => update({ faultType: "wear" })} />
              {errors.faultType ? <Text accessibilityRole="alert" style={styles.error}>{errors.faultType}</Text> : null}
            </View> : null}
            {signatureError ? <Notice message={signatureError} tone="warning" /> : null}
            {signatureLoading ? <Text accessibilityLiveRegion="polite" style={styles.caption}>Preparando firma del perfil...</Text> : null}
            {draft.technicianProfileSignature ? <View style={styles.tight}>
              <Text style={styles.label}>Firma del tecnico · {draft.technicianProfileSignature.name}</Text>
              <Image source={{ uri: draft.technicianProfileSignature.png }} style={styles.signaturePreview} resizeMode="contain" accessibilityLabel="Firma del tecnico desde el perfil" />
              <Button title="Dibujar otra firma para esta entrega" icon="create-outline" variant="ghost" disabled={blocked} onPress={() => { selectionVersion.current += 1; update({ technicianProfileSignature: null, technicianStrokes: [] }); }} />
            </View> : <SignatureField label="Firma del técnico" name={props.technicianName} strokes={draft.technicianStrokes} signatureRef={technicianPad} disabled={blocked} error={errors.technicianSignature} onChange={(technicianStrokes) => { selectionVersion.current += 1; update({ technicianStrokes, technicianProfileSignature: null }); }} onDrawingChange={setDrawing} />}
            {props.signatureAccess ? <Button title="Mis firmas: elegir, agregar o editar" icon="create-outline" variant="secondary" disabled={blocked || drawing || !props.signatureAccess.available} onPress={() => setManagingSignatures(true)} /> : null}
            {clientRequired ? <View style={styles.stack}>
              <Field label="Nombre de quien recibe *" value={draft.receivedByName} onChangeText={(receivedByName) => update({ receivedByName })} autoCapitalize="words" autoCorrect={false} maxLength={DELIVERY_RECEIVER_LIMIT} editable={!blocked} error={errors.receivedByName} placeholder="Nombre y apellidos del receptor" />
              <SignatureField label="Firma de quien recibe" name={draft.receivedByName} strokes={draft.clientStrokes} signatureRef={clientPad} disabled={blocked} error={errors.clientSignature} onChange={(clientStrokes) => update({ clientStrokes })} onDrawingChange={setDrawing} />
            </View> : null}
            <BodyText>Las firmas del perfil se guardan en tu cuenta. La firma de quien recibe pertenece solo a esta entrega.</BodyText>
          </View>}
          <Button title="Actualizar estado y requisitos" icon="refresh-outline" variant="ghost" disabled={locked || drawing} onPress={() => { setReview(null); setCaptureError(null); props.onReload(); }} />
          <Text style={styles.caption}>El borrador se conserva en memoria hasta 30 minutos de inactividad. Se pierde al reiniciar la app o cerrar sesión.</Text>
        </ScrollView>
        <View style={styles.footer}>
          <Button title={review ? props.mode === "demo" ? "Confirmar entrega en demo" : "Confirmar y entregar OT" : "Revisar entrega y firmas"} icon={review ? "checkmark-circle-outline" : "arrow-forward-outline"} loading={locked} disabled={unavailable || reasons.length > 0 || drawing} onPress={() => { void (review ? confirm() : prepare()); }} />
          {review ? <Button title="Volver a editar" variant="secondary" disabled={locked} onPress={() => { setReview(null); setCaptureError(null); }} /> : null}
          <Button title="Guardar borrador y volver" variant="ghost" disabled={locked || drawing} onPress={props.onClose} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
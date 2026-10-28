import { useContext, useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { type UserSignature, type UserSignatureAccess, userSignatureInputSchema, type UserSignatureInput } from "../../domain/userSignatures";
import { signatureImagePng } from "../../infrastructure/signatureImage";
import { DeviceSecurityContext, useTrustedNativePicker } from "../../security/DeviceSecurityContext";
import { Button, Field, IconButton, SectionTitle } from "../../ui/components";
import { palette } from "../../ui/theme";
import { Notice } from "../workDetail/DetailUi";
import { SignatureField } from "../orders/lifecycle/SignatureField";
import { hasSignature, type SignaturePadHandle, type SignatureStrokes } from "../orders/lifecycle/signatureGeometry";

// Prefijo de Chile por defecto en el teléfono (como en la web).
const PHONE_PREFIX = "+56 ";

function StepTitle({ step, title }: { step: number; title: string }) {
  return <View style={styles.stepTitle}>
    <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{step}</Text></View>
    <Text style={styles.stepText}>{title}</Text>
  </View>;
}

/**
 * Crear o editar una firma en tres pasos, igual que en la web: 1) la firma, 2) datos bajo la
 * firma, 3) en qué sucursales se usa (por defecto, todas las que aún no tienen otra firma).
 */
export function SignatureEditor({ access, existing, signatures, busy, onSave, onCancel, title }: {
  access: UserSignatureAccess; existing: UserSignature | null; signatures: UserSignature[]; busy: boolean;
  /** scope: «Todas las sucursales» o «Solo algunas» (la recepción del taller lo usa al guardar la firma de otro técnico). */
  onSave(input: UserSignatureInput, scope: "all" | "some"): Promise<void>; onCancel(): void;
  /** Título opcional (p. ej. «Configura tu firma» en el aviso de bienvenida). */
  title?: string;
}) {
  const [name, setName] = useState(existing?.signatureName ?? access.name);
  const [email, setEmail] = useState(existing?.signatureEmail ?? access.email);
  const [phone, setPhone] = useState(existing?.signaturePhone ?? PHONE_PREFIX);
  const usedBranches = new Set(signatures.filter(signature => signature.id !== existing?.id).flatMap(signature => signature.branches.map(branch => Number(branch.value))));
  const freeBranchIds = access.branches.map(branch => branch.id).filter(id => !usedBranches.has(id));
  const [branchIds, setBranchIds] = useState(() => existing?.branches.map(branch => Number(branch.value)) ?? freeBranchIds);
  const [scope, setScope] = useState<"all" | "some">(() => {
    if (!existing) return "all";
    const own = new Set(existing.branches.map(branch => Number(branch.value)));
    return freeBranchIds.length > 0 && freeBranchIds.every(id => own.has(id)) ? "all" : "some";
  });
  const [image, setImage] = useState<string | null>(existing?.signatureImage ?? null);
  const [imageChanged, setImageChanged] = useState(false);
  const [mode, setMode] = useState<"image" | "draw">(existing?.signatureImage ? "image" : "draw");
  const [strokes, setStrokes] = useState<SignatureStrokes>([]);
  const [drawing, setDrawing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const latest = useRef({ access, busy }); latest.current = { access, busy };
  const security = useContext(DeviceSecurityContext);
  const securityRef = useRef(security); securityRef.current = security;
  const picker = useTrustedNativePicker();
  const pad = useRef<SignaturePadHandle>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = busy || preparing || !access.available;
  const current = () => mounted.current && latest.current.access.scopeKey === access.scopeKey && latest.current.access.available && (securityRef.current?.isUnlocked() ?? true);

  function chooseScope(next: "all" | "some"): void {
    setScope(next);
    if (next === "all") setBranchIds(values => Array.from(new Set([...values.filter(id => !usedBranches.has(id)), ...freeBranchIds])));
  }

  async function upload(): Promise<void> {
    if (disabled || drawing || locked.current || !current()) return;
    locked.current = true; setPreparing(true); setError(null);
    try {
      const result = await picker(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, allowsMultipleSelection: false }));
      if (!current() || result.canceled) return;
      const asset = result.assets[0];
      if (!asset || asset.fileSize !== undefined && asset.fileSize > 5 * 1024 * 1024) throw new Error("La imagen de firma debe pesar como maximo 5 MiB.");
      const png = await signatureImagePng(asset.uri);
      if (current()) { setImage(png); setImageChanged(true); setMode("image"); setStrokes([]); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "No se pudo cargar la firma."); }
    finally { locked.current = false; if (mounted.current) setPreparing(false); }
  }

  async function save(): Promise<void> {
    if (disabled || drawing || locked.current || !current()) return;
    locked.current = true; setPreparing(true); setError(null);
    try {
      let signatureImage: string | null | undefined = imageChanged ? image : undefined;
      if (mode === "draw" && hasSignature(strokes)) {
        if (!pad.current) throw new Error("Vuelve a abrir el editor de firma.");
        signatureImage = await pad.current.capture();
      }
      const hasImage = signatureImage !== undefined ? Boolean(signatureImage) : Boolean(existing?.signatureImage);
      if (!hasImage) throw new Error("Dibuja tu firma o carga una imagen.");
      const phoneValue = phone.trim();
      const parsed = userSignatureInputSchema.safeParse({ id: existing?.id, signatureName: name, signatureEmail: email.trim() || null, signaturePhone: phoneValue === "" || phoneValue === PHONE_PREFIX.trim() ? null : phoneValue, signatureImage, branchIds });
      if (!parsed.success) throw new Error(branchIds.length === 0 ? "Elige al menos una sucursal donde se usará la firma." : "Indica un nombre y, si corresponde, un correo valido.");
      if (current()) await onSave(parsed.data, scope);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "No se pudo guardar la firma."); }
    finally { locked.current = false; if (mounted.current) setPreparing(false); }
  }

  return <View style={styles.root}>
    <View style={styles.header}><IconButton name="arrow-back-outline" label="Volver a mis firmas" disabled={busy || preparing || drawing} onPress={onCancel} /><SectionTitle title={title ?? (existing ? "Editar firma" : "Nueva firma")} /></View>
    <ScrollView scrollEnabled={!drawing} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.caption}>Dibuja tu firma, revisa los datos que aparecen debajo y elige en qué sucursales se usa.</Text>
      {error ? <Notice message={error} tone="error" /> : null}

      <View style={styles.section}>
        <StepTitle step={1} title="La firma" />
        <View accessibilityRole="tablist" style={styles.row}>
          <Button title="Dibujar" icon="create-outline" variant={mode === "draw" ? "primary" : "secondary"} disabled={disabled} onPress={() => setMode("draw")} />
          <Button title="Cargar imagen" icon="image-outline" variant={mode === "image" ? "primary" : "secondary"} disabled={disabled} onPress={() => void upload()} />
        </View>
        {mode === "draw" ? <SignatureField label="Imagen de firma" required={false} strokes={strokes} signatureRef={pad} disabled={disabled} onChange={value => { setStrokes(value); if (value.length === 0) { setImage(null); setImageChanged(true); } }} onDrawingChange={setDrawing} />
          : image ? <Image source={{ uri: image }} resizeMode="contain" style={styles.preview} accessibilityLabel="Imagen de firma guardada" /> : <Text style={styles.caption}>Sin imagen</Text>}
        {image ? <Button title="Quitar imagen" icon="trash-outline" variant="ghost" disabled={disabled} onPress={() => { setImage(null); setStrokes([]); setImageChanged(true); }} /> : null}
      </View>

      <View style={styles.section}>
        <StepTitle step={2} title="Datos bajo la firma" />
        <Field label="Nombre en firma" value={name} onChangeText={setName} maxLength={200} editable={!disabled} />
        <Field label="Correo en firma" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" maxLength={254} editable={!disabled} />
        <Field label="Telefono en firma" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={100} editable={!disabled} />
      </View>

      <View style={styles.section}>
        <StepTitle step={3} title="¿En qué sucursales se usa?" />
        {([
          { id: "all" as const, title: "Todas las sucursales", hint: freeBranchIds.length === access.branches.length ? `Se usará en ${access.branches.length === 1 ? access.branches[0]?.name ?? "tu sucursal" : `tus ${access.branches.length} sucursales`}.` : "Se usará en todas tus sucursales que aún no tienen otra firma." },
          { id: "some" as const, title: "Solo algunas", hint: "Elige en cuáles se usa." },
        ]).map(option => {
          const selected = scope === option.id;
          return <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.title} accessibilityState={{ checked: selected, disabled }} disabled={disabled}
            onPress={() => chooseScope(option.id)} style={[styles.option, selected && styles.selected]}>
            <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} color={palette.primary} size={22} />
            <View style={styles.grow}><Text style={styles.label}>{option.title}</Text><Text style={styles.caption}>{option.hint}</Text></View>
          </Pressable>;
        })}
        {scope === "some" ? access.branches.map(branch => {
          const selected = branchIds.includes(branch.id);
          const occupied = usedBranches.has(branch.id);
          return <Pressable key={branch.id} accessibilityRole="checkbox" accessibilityLabel={branch.name} accessibilityState={{ checked: selected, disabled: disabled || occupied }} aria-checked={selected} disabled={disabled || occupied}
            onPress={() => setBranchIds(values => selected ? values.filter(id => id !== branch.id) : [...values, branch.id])} style={[styles.branch, selected && styles.selected]}>
            <Ionicons name={selected ? "checkbox" : "square-outline"} color={occupied ? palette.textMuted : palette.primary} size={22} /><View style={styles.grow}><Text style={styles.label}>{branch.name}</Text>{occupied ? <Text style={styles.caption}>Ya tiene otra firma</Text> : null}</View>
          </Pressable>;
        }) : null}
        {branchIds.length === 0 ? <Text style={styles.warning}>Sin sucursales la firma no se usará en ningún documento.</Text> : null}
      </View>
    </ScrollView>
    <View style={styles.footer}><Button title="Guardar firma" icon="save-outline" disabled={!access.available || drawing} loading={busy || preparing} onPress={() => void save()} /><Button title="Cancelar" variant="ghost" disabled={busy || preparing || drawing} onPress={onCancel} /></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 }, header: { padding: 16, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderColor: palette.border },
  content: { padding: 16, gap: 20 }, footer: { padding: 16, gap: 8, borderTopWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  section: { gap: 12 },
  stepTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepNumber: { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  stepText: { color: palette.text, fontSize: 16, fontWeight: "700" },
  label: { color: palette.text, fontSize: 15, fontWeight: "600" }, caption: { color: palette.textSecondary, fontSize: 13 },
  warning: { color: palette.orange, fontSize: 13, fontWeight: "600" },
  option: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 10 },
  branch: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 8 }, selected: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, grow: { flex: 1 }, preview: { width: "100%", height: 170, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 8 },
});

import { useContext, useEffect, useRef, useState } from "react";
import { BackHandler, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { defaultUserSignature, ownSignatureOptions, type SelectedUserSignature, type UserSignature, type UserSignatureAccess, type UserSignatureInput, type UserSignatureOptions } from "../../domain/userSignatures";
import { signatureImagePng } from "../../infrastructure/signatureImage";
import { DeviceSecurityContext } from "../../security/DeviceSecurityContext";
import { Badge, Button, IconButton, SectionTitle } from "../../ui/components";
import { palette } from "../../ui/theme";
import { Notice } from "../workDetail/DetailUi";
import { SignatureEditor } from "./SignatureEditor";

export function UserSignaturesPanel(props: { access: UserSignatureAccess; onBack(): void; onSelect?(signature: SelectedUserSignature): void; onCatalog?(options: UserSignatureOptions): void }) {
  return <UserSignaturesContent key={props.access.scopeKey} {...props} />;
}

function UserSignaturesContent({ access, onBack, onSelect, onCatalog }: { access: UserSignatureAccess; onBack(): void; onSelect?(signature: SelectedUserSignature): void; onCatalog?(options: UserSignatureOptions): void }) {
  const [catalog, setCatalog] = useState<UserSignatureOptions | null>(null);
  const [editing, setEditing] = useState<UserSignature | null | undefined>(undefined);
  const [removing, setRemoving] = useState<UserSignature | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const flight = useRef(false);
  const latest = useRef({ access, onCatalog, onSelect }); latest.current = { access, onCatalog, onSelect };
  const security = useContext(DeviceSecurityContext);
  const securityRef = useRef(security); securityRef.current = security;
  const current = () => active.current && latest.current.access.scopeKey === access.scopeKey && (securityRef.current?.isUnlocked() ?? true);

  function accept(value: UserSignatureOptions): void {
    const parsed = ownSignatureOptions(value, access.userId, access.branchId);
    if (!current()) return;
    setCatalog(parsed); latest.current.onCatalog?.(parsed);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (flight.current || !current() || !latest.current.access.available) return;
    flight.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : "No se pudo completar la operacion de firmas."); }
    finally { flight.current = false; if (active.current) setBusy(false); }
  }

  async function reload(): Promise<void> { await run(async () => accept(await latest.current.access.actions.load())); }
  useEffect(() => { active.current = true; void reload(); return () => { active.current = false; }; }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (flight.current || !current()) return true;
      if (editing !== undefined) return true;
      if (removing) setRemoving(null);
      else onBack();
      return true;
    });
    return () => subscription.remove();
  }, [editing, removing, onBack]);

  async function save(input: UserSignatureInput): Promise<void> {
    if (flight.current || !current() || !latest.current.access.available) throw new Error("La sesion no permite guardar firmas en este momento.");
    flight.current = true; setBusy(true); setError(null);
    try {
      const result = await latest.current.access.actions.save(input);
      if (current()) { accept(result); setEditing(undefined); }
    } finally { flight.current = false; if (active.current) setBusy(false); }
  }

  async function select(signature: UserSignature): Promise<void> {
    await run(async () => {
      if (!signature.signatureImage) throw new Error("Esta firma no tiene imagen. Editala para dibujar o cargar una.");
      const png = await signatureImagePng(signature.signatureImage);
      if (current()) latest.current.onSelect?.({ id: signature.id, name: signature.signatureName, png });
    });
  }

  if (editing !== undefined) return <SignatureEditor key={editing?.id ?? "new"} access={access} existing={editing} signatures={catalog?.options ?? []} busy={busy} onSave={save} onCancel={() => { if (!flight.current) setEditing(undefined); }} />;
  return <View style={styles.root}>
    <View style={styles.header}><IconButton name="arrow-back-outline" label="Cerrar mis firmas" disabled={busy} onPress={onBack} /><View style={styles.grow}><SectionTitle title="Mis firmas" /></View><IconButton name="refresh-outline" label="Actualizar firmas" disabled={busy || !access.available} onPress={() => void reload()} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      {!access.available ? <Notice message="Conectate para consultar o configurar las firmas del perfil." tone="warning" /> : null}
      {error ? <Notice message={error} tone="error" /> : null}
      {catalog && !defaultUserSignature(catalog) ? <Notice message="No hay una firma predeterminada para esta sucursal." /> : null}
      {busy ? <Text accessibilityLiveRegion="polite" style={styles.caption}>Procesando firmas...</Text> : null}
      {catalog?.options.length === 0 ? <Text style={styles.label}>Sin firmas configuradas</Text> : null}
      {catalog?.options.map(signature => <View key={signature.id} style={styles.item}>
        <View style={styles.row}><View style={styles.grow}><Text style={styles.label}>{signature.signatureName}</Text>{signature.signatureEmail ? <Text style={styles.caption}>{signature.signatureEmail}</Text> : null}{signature.signaturePhone ? <Text style={styles.caption}>{signature.signaturePhone}</Text> : null}</View>{signature.isDefaultForBranch ? <Badge label="Esta sucursal" tone="teal" /> : null}</View>
        <Text style={styles.caption}>{signature.branches.map(branch => branch.label).join(", ")}</Text>
        {signature.signatureImage ? <Image source={{ uri: signature.signatureImage }} resizeMode="contain" style={styles.image} accessibilityLabel={`Firma de ${signature.signatureName}`} /> : <Text style={styles.caption}>Sin imagen</Text>}
        <View style={styles.row}>
          {onSelect ? <Button title="Usar firma" icon="checkmark-outline" disabled={busy || !access.available || !signature.signatureImage} onPress={() => void select(signature)} /> : null}
          <IconButton name="create-outline" label={`Editar firma: ${signature.signatureName}`} disabled={busy || !access.available} onPress={() => setEditing(signature)} />
          <IconButton name="trash-outline" label={`Eliminar firma: ${signature.signatureName}`} disabled={busy || !access.available} onPress={() => setRemoving(signature)} />
        </View>
        {removing?.id === signature.id ? <View style={styles.confirm}>
          <Text style={styles.label}>Eliminar esta firma del perfil?</Text>
          <Text style={styles.caption}>Los documentos ya firmados no cambian.</Text>
          <Button title="Confirmar eliminacion de firma" icon="trash-outline" variant="danger" disabled={busy || !access.available} onPress={() => void run(async () => { const result = await latest.current.access.actions.remove(signature.id); if (current()) { accept(result); setRemoving(null); } })} />
          <Button title="Cancelar eliminacion" variant="ghost" disabled={busy} onPress={() => setRemoving(null)} />
        </View> : null}
      </View>)}
    </ScrollView>
    <View style={styles.footer}><Button title="Agregar firma" icon="add-outline" disabled={busy || !access.available || catalog === null} onPress={() => setEditing(null)} /></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: palette.background }, header: { padding: 16, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderColor: palette.border },
  content: { padding: 16, gap: 16 }, footer: { padding: 16, borderTopWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  item: { gap: 12, padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: 8, backgroundColor: palette.surface }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }, grow: { flex: 1, minWidth: 120 },
  label: { color: palette.text, fontWeight: "600", fontSize: 16 }, caption: { color: palette.textSecondary, fontSize: 13 }, image: { height: 112, width: "100%", backgroundColor: palette.surface }, confirm: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: palette.border },
});
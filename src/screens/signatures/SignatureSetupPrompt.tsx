import { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { UserSignatureAccess, UserSignatureInput } from "../../domain/userSignatures";
import { Button } from "../../ui/components";
import { palette } from "../../ui/theme";
import { SignatureEditor } from "./SignatureEditor";

// Usuarios que ya vieron el aviso en esta ejecución de la app («Ahora no» no insiste hasta reabrirla).
const promptedUsers = new Set<string>();

/**
 * Al entrar sin firma configurada, la app saluda y ofrece crearla en el momento con el mismo
 * formulario de «Mis firmas» (por defecto queda en todas las sucursales).
 */
export function SignatureSetupPrompt({ access, firstName, enabled }: {
  access?: UserSignatureAccess;
  firstName: string;
  /** Solo cuando la sesión está verificada y no hay otra pantalla encima. */
  enabled: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const checking = useRef(false);
  const userKey = access ? `${access.userId}` : "";

  useEffect(() => {
    if (!enabled || !access?.available || promptedUsers.has(userKey) || checking.current) return;
    checking.current = true;
    let active = true;
    void access.actions.load()
      .then(result => {
        if (!active) return;
        promptedUsers.add(userKey);
        if (result.options.length === 0) setVisible(true);
      })
      .catch(() => { /* Sin conexión o sin permiso: se volverá a intentar en la próxima entrada. */ })
      .finally(() => { checking.current = false; });
    return () => { active = false; };
  }, [enabled, access, userKey]);

  if (!access || !visible) return null;

  async function save(input: UserSignatureInput): Promise<void> {
    if (!access) return;
    setBusy(true);
    try {
      await access.actions.save(input);
      setEditing(false);
      setSaved(true);
    } finally { setBusy(false); }
  }

  const close = () => { if (!busy) { setVisible(false); setEditing(false); setSaved(false); } };

  if (editing) {
    return <Modal visible animationType="slide" onRequestClose={() => { if (!busy) setEditing(false); }}>
      <SafeAreaView style={styles.full} edges={["top", "left", "right", "bottom"]}>
        <SignatureEditor access={access} existing={null} signatures={[]} busy={busy} title="Configura tu firma" onSave={save} onCancel={() => { if (!busy) setEditing(false); }} />
      </SafeAreaView>
    </Modal>;
  }

  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={styles.overlay}>
      <View style={styles.card} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.content}>
          {saved ? <>
            <View style={[styles.icon, styles.iconDone]}><Ionicons name="checkmark-circle" size={34} color={palette.primary} /></View>
            <Text style={styles.title}>¡Listo, {firstName}!</Text>
            <Text style={styles.text}>Tu firma quedó guardada y se aplicará sola en tus entregas y documentos. Puedes cambiarla cuando quieras en Perfil › Firmas.</Text>
            <Button title="Entendido" icon="checkmark-outline" onPress={close} />
          </> : <>
            <View style={styles.icon}><Ionicons name="create" size={30} color={palette.orange} /></View>
            <Text style={styles.title}>Hola, {firstName} 👋</Text>
            <Text style={styles.subtitle}>Configura tu firma</Text>
            <Text style={styles.text}>Aún no tienes una firma guardada. Se usa en las entregas de equipos, las recepciones en taller y los documentos que firmas desde la app. Créala una vez y se aplicará sola en todas tus sucursales.</Text>
            <View style={styles.steps}>
              {["Dibuja tu firma con el dedo", "Revisa nombre, correo y teléfono", "Queda lista para todas tus sucursales"].map((step, index) =>
                <View key={step} style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View><Text style={styles.stepText}>{step}</Text></View>)}
            </View>
            <Button title="Configurar mi firma" icon="create-outline" variant="warning" onPress={() => setEditing(true)} />
            <Button title="Ahora no" variant="ghost" onPress={close} />
          </>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: palette.background },
  overlay: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.55)", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 480, maxHeight: "88%", alignSelf: "center", borderRadius: 20, backgroundColor: palette.surface, overflow: "hidden" },
  content: { padding: 22, gap: 14, alignItems: "stretch" },
  icon: { alignSelf: "center", width: 60, height: 60, borderRadius: 30, backgroundColor: palette.orangeSoft, alignItems: "center", justifyContent: "center" },
  iconDone: { backgroundColor: palette.primarySoft },
  title: { color: palette.text, fontSize: 22, fontWeight: "800", textAlign: "center" },
  subtitle: { color: palette.orange, fontSize: 16, fontWeight: "700", textAlign: "center", marginTop: -6 },
  text: { color: palette.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" },
  steps: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: palette.background },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNumber: { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  stepText: { color: palette.text, fontSize: 14, flex: 1 },
});

import { useState } from "react";
import { ScrollView } from "react-native";
import type { Tenant } from "../domain/models";
import { BodyText, Brand, Button, Card, Field, SectionTitle } from "../ui/components";
import { palette } from "../ui/theme";

export function ForcedPasswordScreen({ tenant, busy, error, onSave, onCancel }: { tenant: Tenant; busy: boolean; error: string | null; onSave: (password: string, confirmation: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 24, maxWidth: 560, width: "100%", alignSelf: "center" }}>
    <Brand tenant={tenant} />
    <Card style={{ gap: 12 }}>
      <SectionTitle title="Empresa actual" subtitle={tenant.name} />
      <BodyText>{tenant.portalOrigin}</BodyText>
      <BodyText>El cambio de contraseña se aplicará a tu cuenta en esta empresa.</BodyText>
    </Card>
    <Card style={{ gap: 20 }}>
      <SectionTitle title="Protege tu cuenta" subtitle="Qualitzer requiere cambiar tu contraseña temporal antes de continuar." />
      <Field label="Nueva contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" hint="Al menos 8 caracteres." editable={!busy} accessibilityState={{ disabled: busy }} />
      <Field label="Repetir contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" editable={!busy} accessibilityState={{ disabled: busy }} />
      {error && <BodyText style={{ color: palette.danger }}>{error}</BodyText>}
      <Button title="Guardar contraseña y continuar" loading={busy} disabled={password.length < 8 || password !== confirmation} onPress={() => { onSave(password, confirmation); setPassword(""); setConfirmation(""); }} />
      <Button title="Volver al acceso" variant="ghost" disabled={busy} onPress={onCancel} />
    </Card>
  </ScrollView>;
}
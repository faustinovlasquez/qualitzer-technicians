import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { CreationModal } from "./CreationModal";
import { BodyText, Button } from "../../ui/components";
import { palette } from "../../ui/theme";
import type { CreationResult } from "../../domain/creation";

export function CreationSuccess({ kind, confirmed, name, demo, onContinue }: { kind: CreationResult["kind"]; confirmed: boolean; name: string; demo: boolean; onContinue(): void }) {
  const maintenance = kind === "maintenance";
  const title = confirmed ? maintenance ? "Mantenimiento creado exitosamente" : "Trabajo creado exitosamente"
    : maintenance ? "Mantenimiento guardado en el teléfono" : "Trabajo guardado en el teléfono";
  return <CreationModal title={title} onClose={onContinue}>
    <View style={{ alignItems: "center", gap: 12 }} testID="creation-success">
      <Ionicons name={confirmed ? "checkmark-circle" : "cloud-upload-outline"} color={palette.primary} size={64} accessible={false} />
      <Text style={{ color: palette.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>{name}</Text>
      {!confirmed || demo ? <BodyText>{demo ? "Creación en demostración." : "Pendiente de sincronizar con Qualitzer."}</BodyText> : null}
    </View>
    <Button title={maintenance ? "Gestionar mantenimiento" : "Gestionar trabajo"} icon="arrow-forward-outline" onPress={onContinue} />
  </CreationModal>;
}
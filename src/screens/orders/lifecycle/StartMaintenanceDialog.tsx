import { Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BodyText, Button, SectionTitle } from "../../../ui/components";
import { Notice } from "../../workDetail/DetailUi";
import { styles } from "./lifecycleStyles";

export function StartMaintenanceDialog({ orderLabel, busy, allowed, mode, error, onClose, onStart }: {
  orderLabel: string;
  busy: boolean;
  allowed: boolean;
  mode: "live" | "demo";
  error: string | null;
  onClose: () => void;
  onStart: () => void;
}) {
  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={styles.overlay}>
      <View style={styles.modal}>
        <ScrollView contentContainerStyle={styles.content}>
          <SectionTitle title="Iniciar OT de mantenimiento" subtitle={orderLabel} />
          <BodyText>Se registrará el inicio de la reparación. Los cronómetros de cada trabajo se gestionan desde sus propias fichas.</BodyText>
          {mode === "demo" ? <Notice message="Demostración: el inicio no modifica datos reales." /> : null}
          {!allowed ? <Notice tone="warning" message="Esta OT ya no está pendiente o no admite el inicio desde este panel." /> : null}
          {error ? <Notice tone="error" message={error} /> : null}
          <Button title={mode === "demo" ? "Iniciar OT en demo" : "Confirmar inicio de OT"} icon="play-outline" loading={busy} disabled={!allowed} onPress={onStart} />
          <Button title="Cancelar" variant="secondary" disabled={busy} onPress={onClose} />
        </ScrollView>
      </View>
    </SafeAreaView>
  </Modal>;
}
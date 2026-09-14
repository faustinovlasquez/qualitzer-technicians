import { ScrollView, View } from "react-native";
import { PrivateModal } from "../../../security/DeviceSecurityContext";
import { BodyText, Button, SectionTitle } from "../../../ui/components";
import { Notice } from "../DetailUi";
import { styles } from "../detailStyles";
import type { CameraPermissionGuideState } from "./useCameraPermissionGuide";

export function CameraPermissionGuide({ guide }: { guide: CameraPermissionGuideState }) {
  return <PrivateModal visible={guide.visible} transparent animationType="fade" onRequestClose={guide.cancel}>
    <View style={styles.modalOverlay}><View style={styles.modalCard} accessibilityViewIsModal><ScrollView contentContainerStyle={styles.modalContent}>
      <SectionTitle title="Permiso de cámara" />
      <BodyText>Para tomar una foto, permite que Qualitzer use la cámara. Tus archivos y borradores se conservan.</BodyText>
      {guide.canAskAgain ? <BodyText>Puedes volver a solicitar el permiso y elegir Permitir en el aviso del dispositivo.</BodyText> : <BodyText>En Ajustes, abre Aplicaciones → Qualitzer → Permisos → Cámara → Permitir. Después vuelve a la app y pulsa Volver a intentar.</BodyText>}
      {guide.message ? <Notice message={guide.message} tone="error" /> : null}
      {!guide.canAskAgain ? <Button title="Abrir ajustes" disabled={guide.busy} onPress={() => { void guide.openSettings(); }} /> : null}
      <Button title={guide.canAskAgain ? "Reintentar permiso" : "Volver a intentar"} disabled={guide.busy} onPress={() => { void guide.retry(); }} />
      {guide.hasGallery ? <Button title="Galería" variant="secondary" disabled={guide.busy} onPress={() => { void guide.pickGallery(); }} /> : null}
      <Button title="Cancelar" variant="secondary" onPress={guide.cancel} />
    </ScrollView></View></View>
  </PrivateModal>;
}
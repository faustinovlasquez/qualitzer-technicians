import { View } from "react-native";
import { BodyText, Card, SectionTitle } from "../../ui/components";
import { Notice } from "../workDetail/DetailUi";
import { styles } from "../workDetail/detailStyles";
import { operationStatusLabels, type PendingAnswer } from "./offlineUi";

export function QueuedNotice({ answers, count = answers.length }: { answers: PendingAnswer[]; count?: number }) {
  if (!count) return null;
  return <Card style={styles.stack}>
    <SectionTitle title={`${count} respuesta(s) en cola`} />
    <Notice message="Guardadas en este dispositivo; pendientes de confirmación. No aumentan el progreso del servidor. Una respuesta idéntica no se volverá a encolar; puedes editarla para preparar otro cambio." tone="warning" />
    {answers.map((operation) => <View key={operation.id} style={styles.tight}>
      <BodyText>Paso {operation.stepId} · {operationStatusLabels[operation.status]}</BodyText>
      <BodyText>{JSON.stringify(operation.answer)}</BodyText>
      {operation.lastError ? <BodyText>{operation.lastError}</BodyText> : null}
    </View>)}
  </Card>;
}
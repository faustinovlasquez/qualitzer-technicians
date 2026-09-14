import { Text, View } from "react-native";
import { Notice } from "../workDetail/DetailUi";
import { styles } from "../workDetail/detailStyles";
import { operationStatusLabels, type PendingAnswer } from "./offlineUi";
import { operationNeedsAttention, syncUserError } from "./syncUserPresentation";

export function QueuedNotice({ answers, count = answers.length }: { answers: PendingAnswer[]; count?: number }) {
  if (!count) return null;
  return <View style={styles.tight}>
    <Text accessibilityLiveRegion="polite" style={styles.caption}>{count} respuesta(s) pendientes</Text>
    {answers.filter(operationNeedsAttention).map((operation) => <Notice key={operation.id} message={`Paso ${operation.stepId} · ${operationStatusLabels[operation.status]}${operation.lastError ? `. ${syncUserError(operation.lastError)}` : ""}`} tone="error" />)}
  </View>;
}
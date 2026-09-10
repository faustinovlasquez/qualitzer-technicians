import type { OfflineSnapshot } from "../../domain/offline";
import { Button, Card, SectionTitle } from "../../ui/components";
import { OrderLifecyclePanel, type OrderLifecyclePanelProps } from "../orders/OrderLifecyclePanel";
import { Notice } from "../workDetail/DetailUi";
import { styles } from "../workDetail/detailStyles";

export interface OfflineOrderLifecyclePanelProps extends OrderLifecyclePanelProps { offline: OfflineSnapshot | null; staleReadOnly?: boolean; }

export function OfflineOrderLifecyclePanel({ offline, staleReadOnly, ...props }: OfflineOrderLifecyclePanelProps) {
  if (props.group.type !== "internal_maintenance") return null;
  const awaitingSnapshot = props.group.works.length > 0 && props.group.works.every((work) => work.missingRequiredInfo.includes("OFFLINE_AWAITING_SERVER_SNAPSHOT"));
  if (offline?.online && !offline.authBlocked && !props.group.id.startsWith("local-") && !staleReadOnly && !awaitingSnapshot) return <OrderLifecyclePanel {...props} />;
  return <Card style={styles.stack}>
    <SectionTitle title="Inicio y entrega de OT" />
    <Notice message="El inicio y la entrega con firmas requieren conexión y una OT confirmada. No se abre el formulario ni se simula su entrega offline. Los borradores de firma actuales son temporales de sesión, no una copia duradera." tone="warning" />
    <Button title="Iniciar OT · requiere conexión" variant="secondary" disabled onPress={() => {}} />
    <Button title="Preparar entrega · requiere conexión" disabled onPress={() => {}} />
  </Card>;
}
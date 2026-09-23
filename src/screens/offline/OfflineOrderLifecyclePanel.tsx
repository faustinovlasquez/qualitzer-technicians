import type { OfflineSnapshot } from "../../domain/offline";
import { View } from "react-native";
import { Button, Card, SectionTitle } from "../../ui/components";
import { OrderLifecyclePanel, type OrderLifecyclePanelProps } from "../orders/OrderLifecyclePanel";
import { Notice } from "../workDetail/DetailUi";
import { styles } from "../workDetail/detailStyles";

export interface OfflineOrderLifecyclePanelProps extends OrderLifecyclePanelProps { offline: OfflineSnapshot | null; staleReadOnly?: boolean; }

export function OfflineOrderLifecyclePanel({ offline, staleReadOnly, ...props }: OfflineOrderLifecyclePanelProps) {
  if (props.group.type !== "internal_maintenance") return null;
  const awaitingSnapshot = props.group.works.length > 0 && props.group.works.every((work) => work.missingRequiredInfo.includes("OFFLINE_AWAITING_SERVER_SNAPSHOT"));
  if (offline?.online && !offline.authBlocked && !props.group.id.startsWith("local-") && !staleReadOnly && !awaitingSnapshot) return <OrderLifecyclePanel {...props} />;
  if (props.dock) return <View style={{ flexDirection: "row", gap: 8 }}>
    {[{ title: "Iniciar OT", icon: "play-outline" as const }, { title: "Entregar OT", icon: "checkmark-circle-outline" as const }, ...(props.onCreateWork ? [{ title: "Crear trabajo", icon: "add-outline" as const }] : [])].map(item => <Button key={item.title} {...item} variant="secondary" disabled onPress={() => {}} style={{ flex: 1, minWidth: 0, flexDirection: "column", paddingHorizontal: 4 }} textStyle={{ fontSize: 12, textAlign: "center" }} />)}
  </View>;
  return <Card style={styles.stack}>
    <SectionTitle title="Inicio y entrega de OT" />
    <Notice message="El inicio y la entrega con firmas requieren conexión y una OT confirmada. No se abre el formulario ni se simula su entrega offline. Los borradores de firma actuales son temporales de sesión, no una copia duradera." tone="warning" />
    <Button title="Iniciar OT · requiere conexión" variant="secondary" disabled onPress={() => {}} />
    <Button title="Preparar entrega · requiere conexión" disabled onPress={() => {}} />
  </Card>;
}
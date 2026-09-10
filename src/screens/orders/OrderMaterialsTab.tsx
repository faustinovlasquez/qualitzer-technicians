import { StyleSheet, Text, View } from "react-native";
import { plainText } from "../../domain/format";
import type { AssignmentGroup, Material } from "../../domain/models";
import { Badge, Button, Card, EmptyState, SectionTitle, type BadgeTone } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";

const stockStates: { [K in Material["stockStatus"]]: { label: string; tone: BadgeTone } } = {
  in_stock: { label: "En stock", tone: "success" },
  requested: { label: "Solicitado", tone: "warning" },
  reserved: { label: "Reservado", tone: "info" },
};

export function OrderMaterialsTab({ group, onShowWorks }: { group: AssignmentGroup; onShowWorks: () => void }) {
  const direct = group.type === "direct_assignment";
  return <View style={styles.stack}>
    <SectionTitle title={direct ? "Repuestos de la asignación" : "Repuestos de la OT"} subtitle={`${group.products.length} líneas de repuestos informadas. La cantidad corresponde a cada línea.`} />
    {group.products.length === 0 ? <Card>
      <EmptyState title="Sin repuestos informados" message="No se recibieron repuestos a nivel de esta orden. Los materiales específicos de cada trabajo se consultan en su detalle." icon="cube-outline" />
      <Button title={`Ver trabajos (${group.works.length})`} variant="secondary" icon="list-outline" onPress={onShowWorks} />
    </Card> : <Card style={styles.stack}>
      {group.products.map((material, index) => <View key={`${material.id}:${index}`} style={styles.material}>
        <View style={styles.copy}>
          <Text style={styles.name}>{plainText(material.name)}</Text>
          {material.ref?.trim() ? <Text selectable style={styles.caption}>Ref. {plainText(material.ref)}</Text> : null}
          <Badge label={stockStates[material.stockStatus].label} tone={stockStates[material.stockStatus].tone} />
        </View>
        <View style={styles.quantity}>
          <Text style={styles.caption}>Cantidad</Text>
          <Text style={styles.amount}>{Number.isFinite(material.quantity) ? material.quantity.toLocaleString("es-CL", { maximumFractionDigits: 8 }) : "No informada"}</Text>
        </View>
      </View>)}
      <Text style={styles.caption}>Los materiales propios de cada trabajo se consultan en su ficha. Esta lista corresponde únicamente a la orden o asignación.</Text>
    </Card>}
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  material: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 12, borderBottomWidth: 1, borderBottomColor: palette.track, paddingBottom: 16 },
  copy: { flex: 1, minWidth: 125, gap: 7 },
  name: { ...typography.label, color: palette.text, fontWeight: "700" },
  caption: { ...typography.caption, color: palette.textSecondary },
  quantity: { alignItems: "flex-end", maxWidth: "100%", gap: 3, backgroundColor: palette.background, borderRadius: radius.sm, padding: 10 },
  amount: { ...typography.heading, color: palette.navy, fontVariant: ["tabular-nums"] },
});
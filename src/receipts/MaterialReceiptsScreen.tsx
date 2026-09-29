import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, IconButton, SectionTitle } from "../ui/components";
import { palette } from "../ui/theme";
import type { useMaterialReceipts } from "./useMaterialReceipts";

export function MaterialReceiptsScreen({ receipt, onBack }: { receipt: ReturnType<typeof useMaterialReceipts>; onBack: () => void }) {
  const items = receipt.data?.items ?? [];
  return <View style={styles.screen}>
    <View style={styles.header}><IconButton name="arrow-back-outline" label="Volver" disabled={receipt.busy} onPress={onBack} /><View style={styles.title}><SectionTitle title="Materiales por recibir" /></View><IconButton name="refresh-outline" label="Actualizar" disabled={receipt.busy} onPress={() => void receipt.refresh()} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.caption}>{"Al confirmar se registra tu ubicaci\u00f3n. Si no est\u00e1 disponible, se guarda el motivo."}</Text>
      {receipt.error ? <Text accessibilityRole="alert" style={styles.error}>{receipt.error}</Text> : null}
      {items.length === 0 && receipt.data ? <Text>No tienes materiales pendientes de recepcion.</Text> : null}
      {!receipt.data && !receipt.error ? <Text>Cargando materiales...</Text> : null}
      {receipt.data?.hasMore ? <Text style={styles.caption}>{"Hay m\u00e1s entregas pendientes adem\u00e1s de las mostradas."}</Text> : null}
      {items.map(item => <View key={item.id} style={styles.receipt}>
        <View style={styles.row}><View style={styles.title}><Text style={styles.code}>{item.code}</Text><Text style={styles.caption}>{item.sourceLabel}</Text><Text style={styles.caption}>{item.destination}</Text></View></View>
        {item.products.map(product => <View key={product.id} style={styles.row}><View style={styles.title}><Text>{product.name}</Text><Text style={styles.caption}>{product.code}</Text></View><Text style={styles.quantity}>{product.quantity} {product.unit}</Text></View>)}
        {item.receiptStatus === "INCIDENT" ? <Text style={styles.error}>Recepcion con incidencia</Text> : null}
        <Button title="Recibido" icon="checkmark-outline" disabled={receipt.busy || Boolean(receipt.pending) || !receipt.ready} onPress={() => void receipt.confirm([item])} />
      </View>)}
    </ScrollView>
    <View style={styles.footer}><Button title={receipt.pending ? "Reintentar confirmaci\u00f3n" : `Recib\u00ed todo (${items.length})`} icon="checkmark-done-outline" loading={receipt.busy} disabled={!receipt.ready || !receipt.pending && items.length === 0} onPress={() => void receipt.confirm(items)} /></View>
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: palette.background }, header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 }, title: { flex: 1, minWidth: 0 }, content: { padding: 14, gap: 14 }, caption: { color: palette.textSecondary, fontSize: 12 }, error: { color: palette.danger, fontSize: 13 }, receipt: { borderBottomWidth: 1, borderColor: palette.border, paddingBottom: 14, gap: 10 }, row: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, code: { fontWeight: "700", fontSize: 14 }, quantity: { flexShrink: 0, fontWeight: "600" }, footer: { padding: 12, borderTopWidth: 1, borderColor: palette.border } });
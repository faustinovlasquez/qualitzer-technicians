import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_RESOURCE_QUANTITY, type MaintenanceResource, type MaintenanceResources, type ResourceCatalogPage, type ResourceCatalogQuery } from "../../domain/maintenanceResources";
import type { AssignmentGroup } from "../../domain/models";
import { plainText } from "../../domain/format";
import { Button, Card, EmptyState, SectionTitle } from "../../ui/components";
import { palette, typography } from "../../ui/theme";
import { AddProductSheet } from "../../workshop/order/OrderItemSheets";
import { Notice } from "../workDetail/DetailUi";

export interface MaintenanceResourcesActions {
  load: (group: AssignmentGroup) => Promise<MaintenanceResources>;
  catalog: (group: AssignmentGroup, query: ResourceCatalogQuery) => Promise<ResourceCatalogPage>;
  add: (group: AssignmentGroup, productId: number, quantity: number) => Promise<MaintenanceResources>;
  setQuantity: (group: AssignmentGroup, resourceId: number, quantity: number) => Promise<MaintenanceResources>;
  remove: (group: AssignmentGroup, resourceId: number) => Promise<MaintenanceResources>;
}

interface Props {
  group: AssignmentGroup;
  actions: MaintenanceResourcesActions;
  online: boolean;
  disabled: boolean;
}

const failureText = (failure: unknown, fallback: string): string => failure instanceof Error && failure.message ? failure.message : fallback;

/** Recursos (productos) del mantenimiento, como la pestaña "Recursos" de la web: agregar del catálogo, cambiar cantidad y quitar. */
export function MaintenanceResourcesPanel({ group, actions, online, disabled }: Props) {
  const [data, setData] = useState<MaintenanceResources | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const ticket = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ticket.current++; }; }, []);

  async function load(): Promise<void> {
    if (!online) return;
    const current = ++ticket.current;
    setLoading(true); setError(null);
    try {
      const result = await actions.load(group);
      if (mounted.current && current === ticket.current) setData(result);
    } catch (cause) {
      if (mounted.current && current === ticket.current) setError(failureText(cause, "No se pudieron cargar los recursos."));
    } finally { if (mounted.current && current === ticket.current) setLoading(false); }
  }
  // Se recarga al abrir y cada vez que la agenda trae otros repuestos (por ejemplo, al actualizar con el botón de arriba).
  const productsKey = JSON.stringify(group.products.map((product) => [product.id, product.quantity]));
  useEffect(() => { void load(); }, [group.id, online, productsKey]);

  async function change(item: MaintenanceResource, quantity: number | null): Promise<void> {
    if (savingId !== null) return;
    setSavingId(item.id); setError(null); setMessage(null);
    try {
      const result = quantity === null ? await actions.remove(group, item.id) : await actions.setQuantity(group, item.id, quantity);
      if (!mounted.current) return;
      ticket.current++;
      setData(result);
      if (quantity === null) setMessage(`Se quitó ${plainText(item.name)}.`);
    } catch (cause) {
      if (mounted.current) setError(failureText(cause, "No se pudo guardar el cambio. Revisa tu conexión."));
    } finally { if (mounted.current) setSavingId(null); }
  }

  const editable = Boolean(data?.canEdit) && online && !disabled;
  const items = data?.items ?? [];
  return <View style={styles.stack}>
    <SectionTitle title="Recursos del mantenimiento" subtitle="Productos que se usan en el mantenimiento. Se registran igual que en la web, sin precios." />
    {!online ? <Notice message="Sin conexión: los recursos se consultan y cambian en el servidor. Conéctate para verlos." tone="warning" /> : null}
    {error ? <Notice message={error} tone="error" onDismiss={() => setError(null)} /> : null}
    {message ? <Notice message={message} tone="success" onDismiss={() => setMessage(null)} /> : null}
    {loading && !data ? <ActivityIndicator accessibilityLabel="Cargando recursos" color={palette.primary} /> : null}
    {data && !data.canEdit ? <Text style={styles.hint}>El mantenimiento ya está cerrado: los recursos se cambian desde la web.</Text> : null}
    {data && items.length === 0 ? <Card><EmptyState title="Sin recursos" message="Todavía no hay productos en este mantenimiento." icon="cube-outline" /></Card> : null}
    {items.length > 0 ? <Card style={styles.list}>
      {items.map((item) => {
        const saving = savingId === item.id;
        return <View key={item.id} style={styles.row}>
          <View style={styles.copy}>
            {item.code ? <Text selectable style={styles.code}>{plainText(item.code)}</Text> : null}
            <Text style={styles.name}>{plainText(item.name)}</Text>
            {item.workTitle ? <Text style={styles.hint}>{`En: ${plainText(item.workTitle)}`}</Text> : null}
          </View>
          <View style={styles.controls}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Restar uno a ${item.name}`} disabled={!editable || saving || item.quantity <= 1}
              onPress={() => void change(item, item.quantity - 1)} style={[styles.stepper, (!editable || item.quantity <= 1) && styles.disabled]}>
              <Ionicons name="remove" size={18} color={palette.primary} accessible={false} />
            </Pressable>
            {saving ? <ActivityIndicator color={palette.primary} /> : <Text style={styles.amount} accessibilityLabel={`Cantidad ${item.quantity}`}>{item.quantity.toLocaleString("es-CL")}</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel={`Sumar uno a ${item.name}`} disabled={!editable || saving || item.quantity >= MAX_RESOURCE_QUANTITY}
              onPress={() => void change(item, item.quantity + 1)} style={[styles.stepper, !editable && styles.disabled]}>
              <Ionicons name="add" size={18} color={palette.primary} accessible={false} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${item.name}`} disabled={!editable || saving}
              onPress={() => void change(item, null)} style={[styles.remove, !editable && styles.disabled]}>
              <Ionicons name="trash-outline" size={18} color={palette.danger} accessible={false} />
            </Pressable>
          </View>
        </View>;
      })}
    </Card> : null}
    {editable ? <Button title="Agregar producto" icon="add-circle-outline" disabled={savingId !== null} onPress={() => { setAdding(true); setMessage(null); }} /> : null}
    {adding ? <AddProductSheet addLabel="Agregar al mantenimiento" priceNote="El precio lo toma del catálogo, igual que en la web."
      load={async (search, page) => {
        const result = await actions.catalog(group, { search, page });
        return { items: result.items.map((item) => ({ id: item.id, code: item.code, name: item.name, description: item.description, stock: null, unit: null })), hasMore: result.hasMore };
      }}
      onAdd={async ({ item }) => {
        if (item.kind !== "product") return;
        const result = await actions.add(group, item.productId, item.quantity);
        if (!mounted.current) return;
        ticket.current++;
        setData(result); setAdding(false); setMessage("Producto agregado al mantenimiento.");
      }}
      onClose={() => setAdding(false)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  list: { gap: 4 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.track },
  copy: { flex: 1, minWidth: 140, gap: 3 },
  code: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
  name: { ...typography.label, color: palette.text, fontWeight: "700" },
  hint: { ...typography.caption, color: palette.textSecondary },
  controls: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepper: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  remove: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  amount: { minWidth: 36, textAlign: "center", ...typography.heading, color: palette.heading, fontVariant: ["tabular-nums"] },
  disabled: { opacity: 0.4 },
});

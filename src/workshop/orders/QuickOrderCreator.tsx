import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { WorkshopArea, WorkshopEntry } from "../../domain/workshopBoard";
import type { WorkshopEntryDetail } from "../../domain/workshopEntry";
import type { useWorkshopBoard } from "../useWorkshopBoard";
import { LocalPicker } from "../intake/IntakePickers";
import { CreationDone } from "../../screens/creation/CreationUi";
import { CreateOrderSheet } from "./OrderSheets";
import { OrderSentSuccess } from "./OrderSentSuccess";

type Workshop = ReturnType<typeof useWorkshopBoard>;
type Picked = { entry: WorkshopEntry; area: WorkshopArea };
type Created = { picked: Picked; orderId: number; title: string; worksCount: number; sent: boolean };

/**
 * Nueva OT desde el menú Crear: las OT de la app pertenecen a un ingreso, así que primero se elige el equipo en taller
 * y luego se usa el mismo formulario de OT del Taller. Al terminar, ventana de éxito con ir a la OT.
 */
export function QuickOrderCreator({ workshop, onClose, onOpenOrder }: {
  workshop: Workshop; onClose: () => void; onOpenOrder?: (picked: Picked, orderId: number) => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [detail, setDetail] = useState<WorkshopEntryDetail | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const board = workshop.board;

  useEffect(() => { if (!board && !workshop.loading) void workshop.refresh(); }, []);
  useEffect(() => {
    if (!picked) return;
    let active = true;
    setDetail(null); setError("");
    workshop.loadEntry(picked.entry.id).then((value) => {
      if (!active) return;
      if (value.delivery) setError("Este equipo ya fue entregado: no se le pueden crear OT.");
      else setDetail(value);
    }, (failure: unknown) => { if (active) setError(failure instanceof Error && failure.message ? failure.message : "No se pudo cargar el ingreso. Revisa tu conexión."); });
    return () => { active = false; };
  }, [picked?.entry.id]);

  if (created) {
    const view = onOpenOrder ? { label: "Ver la OT", icon: "document-text-outline" as const, onPress: () => onOpenOrder(created.picked, created.orderId) } : null;
    const done = { label: "Listo", icon: "checkmark" as const, onPress: onClose };
    return created.sent
      ? <OrderSentSuccess code={null} title={created.title} worksCount={created.worksCount} created onDismiss={onClose} primary={view ?? done} secondary={view ? done : undefined} />
      : <Modal visible transparent animationType="none" onRequestClose={onClose}>
        <View style={styles.fill}>
          <CreationDone busy={false} icon="document-text" question={view ? "¿Qué quieres hacer ahora?" : null} title="¡OT creada!" code={created.picked.entry.code}
            subtitle={`Quedó en el ingreso ${created.picked.entry.code}, sin enviar a comercial. Puedes enviarla cuando esté lista.`}
            details={[{ icon: "document-text-outline", label: created.title }, { icon: "construct-outline", label: created.picked.entry.equipmentLabel },
              { icon: "list-outline", label: created.worksCount === 1 ? "1 trabajo incluido" : `${created.worksCount} trabajos incluidos` }]}
            primary={view ?? done} secondary={view ? done : undefined} />
        </View>
      </Modal>;
  }

  if (!picked) {
    if (!board) return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {workshop.error ? <>
            <Text style={styles.title}>No se pudo cargar el taller</Text>
            <Text style={styles.hint}>{workshop.error}</Text>
            <Button title="Reintentar" icon="refresh" variant="secondary" onPress={() => void workshop.refresh()} />
            <Button title="Cerrar" variant="ghost" onPress={onClose} />
          </> : <><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando los equipos en taller…</Text></>}
        </View>
      </View>
    </Modal>;
    const entries = board.areas.flatMap((area) => area.entries.map((entry) => ({ id: entry.id, entry, area })));
    return <LocalPicker<{ id: number; entry: WorkshopEntry; area: WorkshopArea }> title="Nueva OT · ¿Para qué equipo?" placeholder="Buscar por ingreso, equipo o cliente"
      emptyText="No hay equipos en taller. La OT se crea desde un ingreso."
      load={async () => entries} label={(item) => `${item.entry.code} · ${item.entry.equipmentLabel}`}
      detail={(item) => [item.entry.customerName ?? (item.entry.isInternalEntry ? "Equipo interno" : null), item.area.title].filter(Boolean).join(" · ") || null}
      selectedId={null} onClose={onClose} onPick={(item) => setPicked({ entry: item.entry, area: item.area })} />;
  }

  if (!detail) return <Modal visible transparent animationType="fade" onRequestClose={() => setPicked(null)}>
    <View style={styles.overlay}>
      <View style={styles.card}>
        {error ? <>
          <Text style={styles.title}>{picked.entry.code}</Text>
          <Text style={styles.error}>{error}</Text>
          <Button title="Elegir otro equipo" variant="secondary" onPress={() => setPicked(null)} />
        </> : <><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Abriendo el ingreso {picked.entry.code}…</Text></>}
      </View>
    </View>
  </Modal>;

  return <CreateOrderSheet attempt={attempt} looseWorks={detail.works.items.filter((work) => work.loose)} preselected={[]}
    loadRules={() => workshop.orders.rules(picked.entry.id)} onClose={() => setPicked(null)}
    onCreate={async (input) => {
      const result = await workshop.orders.create(picked.entry.id, input);
      setCreated({ picked, orderId: result.id, title: input.title, worksCount: input.workIds.length, sent: result.sent });
      void workshop.refresh();
      return result;
    }} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "rgba(15,23,42,0.55)" },
  card: { width: "100%", maxWidth: 420, alignItems: "stretch", gap: 12, padding: 20, borderRadius: radius.lg, backgroundColor: palette.surface },
  title: { fontSize: 17, fontWeight: "800", color: palette.heading },
  hint: { ...typography.body, color: palette.textSecondary, textAlign: "center" },
  error: { ...typography.body, color: palette.danger }
});

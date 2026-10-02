import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { assignmentNegotiationCode, assignmentWorkOrderCode } from "../../domain/assignmentCodes";
import { isFinished, plainText, shortDate, STATUS_LABELS } from "../../domain/format";
import { assignmentDay } from "../../domain/assignmentSchedule";
import type { AssignmentGroup } from "../../domain/models";
import { Badge, Button, Card } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { AssignmentMetadataRow } from "./AssignmentMetadataRow";
import { InfoBlock, infoStyles } from "./AssignmentInfoBlock";
import { equipmentLabel, groupTypes, statusTones } from "./assignmentPresentation";

export interface AssignmentOrderCardProps {
  group: AssignmentGroup;
  matchingWorkCount: number;
  busy?: boolean;
  onOpenGroup: (group: AssignmentGroup, initialTab?: "works" | "files" | "deliver") => void;
}

export function AssignmentOrderSummary({ group }: { group: AssignmentGroup }) {
  const workOrderCode = assignmentWorkOrderCode(group);
  const negotiationCode = assignmentNegotiationCode(group);
  const completed = group.works.filter(isFinished).length;
  const total = group.works.length;
  const remaining = total - completed;
  const progress = total > 0 ? Math.round(completed / total * 100) : 0;
  const closed = group.status === "completed" || group.status === "delivered";
  const direct = group.type === "direct_assignment";
  const maintenance = group.type === "internal_maintenance";
  const location = group.locationName.trim() ? group.locationName : group.locationAddress;

  return <View style={styles.summary}>
    <View style={styles.typeRow}>
      <View style={styles.typeIcon}><Ionicons name={groupTypes[group.type].icon} size={21} color={palette.primary} accessible={false} /></View>
      <Text style={styles.type}>{groupTypes[group.type].label}</Text>
      {group.isOverdue && remaining > 0 ? <Badge label="Con atrasos" tone="danger" /> : null}
    </View>
    <View style={styles.codes}>
      {workOrderCode ? <Badge label={workOrderCode} tone="teal" /> : group.code.trim() ? <Badge label={plainText(group.code)} tone="teal" /> : null}
      {negotiationCode ? <Badge label={negotiationCode} tone="info" /> : null}
    </View>
    <Text accessibilityRole="header" style={styles.title}>{plainText(group.title)}</Text>
    <View style={styles.codes}>
      <Text style={styles.statusLabel}>{direct ? "Estado de asignación" : maintenance ? "Estado del mantenimiento" : "Estado OT"}</Text>
      <Badge label={STATUS_LABELS[group.status]} tone={statusTones[group.status]} />
    </View>
    <View style={styles.metadata}>
      <AssignmentMetadataRow icon="hardware-chip-outline" text={equipmentLabel(group.equipment)} strong />
      <AssignmentMetadataRow icon="business-outline" text={group.customerName?.trim() ? group.customerName : "Cliente no informado"} />
      <AssignmentMetadataRow icon="location-outline" text={location?.trim() ? location : "Ubicación no informada"} />
      {group.locationAddress?.trim() && group.locationName.trim() && group.locationAddress !== group.locationName ? <AssignmentMetadataRow icon="navigate-outline" text={group.locationAddress} /> : null}
    </View>
    <View style={styles.metrics}>
      <View style={styles.metric}><Text style={styles.metricValue}>{total}</Text><Text style={styles.caption}>Trabajos asignados</Text></View>
      <View style={styles.metric}><Text style={styles.metricValue}>{group.products.length}</Text><Text style={styles.caption}>{direct ? "Repuestos de asignación" : maintenance ? "Repuestos del mantenimiento" : "Repuestos de la OT"}</Text></View>
    </View>
    <View style={styles.progress}>
      <View style={styles.between}><Text style={styles.statusLabel}>Avance de trabajos</Text><Text style={styles.progressCount}>{completed}/{total} completados</Text></View>
      <View accessibilityRole="progressbar" accessibilityLabel="Trabajos completados y entregados" accessibilityValue={{ min: 0, max: total || 1, now: completed, text: `${completed} de ${total} trabajos completados o entregados` }} style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <Text style={styles.caption}>{total === 0 ? "Sin trabajos asignados en la información recibida." : `${progress}% · incluye trabajos completados y entregados.`}</Text>
    </View>
    {closed && remaining > 0 ? <View style={styles.warning}>
      <Ionicons name="information-circle-outline" size={20} color={palette.amber} accessible={false} />
      <Text style={styles.warningText}>{direct ? "Asignación cerrada" : maintenance ? "Mantenimiento cerrado" : "OT cerrada"} con {remaining} {remaining === 1 ? "trabajo sin finalizar" : "trabajos sin finalizar"}. El estado de la orden no equivale al avance de sus trabajos. Cada trabajo conserva las acciones que habilita Qualitzer.</Text>
    </View> : null}
  </View>;
}

export function AssignmentOrderCard({ group, matchingWorkCount, busy = false, onOpenGroup }: AssignmentOrderCardProps) {
  const workOrderCode = assignmentWorkOrderCode(group);
  const negotiationCode = assignmentNegotiationCode(group);
  const codes = [workOrderCode ?? (group.code.trim() ? plainText(group.code) : null), negotiationCode].filter((code): code is string => Boolean(code));
  const completed = group.works.filter(isFinished).length;
  const total = group.works.length;
  const remaining = total - completed;
  const progress = total > 0 ? Math.round(completed / total * 100) : 0;
  const closed = group.status === "completed" || group.status === "delivered";
  const direct = group.type === "direct_assignment";
  const maintenance = group.type === "internal_maintenance";
  const location = group.locationName.trim() ? group.locationName : group.locationAddress;
  const address = group.locationAddress?.trim() && group.locationName.trim() && group.locationAddress !== group.locationName ? group.locationAddress : null;
  const equipment = group.equipment;
  const equipmentDetail = equipment ? [equipment.identifier, equipment.internalNumber].filter((value) => value && value !== equipment.label).join(" · ") || null : null;
  const day = assignmentDay(group.scheduledDate);
  const start = group.scheduledStartTime.slice(0, 5);
  const end = group.scheduledEndTime.slice(0, 5);
  const time = start || end ? `${start || "--:--"} - ${end || "--:--"}` : "Sin horario definido";
  const title = plainText(group.title) || groupTypes[group.type].label;
  const worksTitle = group.works.length > 0 ? `Ver trabajos (${group.works.length})` : maintenance ? "Ver mantenimiento" : "Ver orden";
  const filesTitle = direct ? "Archivos de la asignación" : maintenance ? "Archivos del mantenimiento" : "Archivos de la OT";
  const canDeliver = maintenance && group.status !== "delivered" && group.status !== "completed";

  return <Card style={styles.orderCard}>
    <View style={styles.between}>
      <View style={styles.codes}>
        {codes.map((code) => <Text key={code} style={styles.code}>{code}</Text>)}
      </View>
      <Badge label={STATUS_LABELS[group.status]} tone={statusTones[group.status]} />
    </View>
    <View style={styles.typeLine}>
      <Ionicons name={groupTypes[group.type].icon} size={14} color={palette.textMuted} accessible={false} />
      <Text style={styles.typeText}>{groupTypes[group.type].label}</Text>
      {group.isOverdue && remaining > 0 ? <Badge label="Con atrasos" tone="danger" /> : null}
    </View>
    <View style={styles.heading}>
      <Text accessibilityRole="header" numberOfLines={2} style={styles.orderTitle}>{title}</Text>
      <Text style={styles.caption}>{total} {total === 1 ? "trabajo" : "trabajos"} · {group.products.length} {group.products.length === 1 ? "repuesto" : "repuestos"}</Text>
    </View>
    <View style={infoStyles.list}>
      {group.customerName?.trim() ? <InfoBlock label="Cliente" value={group.customerName} /> : null}
      <InfoBlock label="Equipo" value={equipment ? equipment.label || equipmentLabel(equipment) : "Sin equipo asociado"} detail={equipmentDetail} />
      <InfoBlock label="Ubicación" icon="location-outline" value={location?.trim() ? location : "Sin ubicación"} detail={address} />
      <InfoBlock label="Horario" icon="calendar-outline" tone="blue" value={`${day ? `${shortDate(day)} ${day.slice(0, 4)}` : "Sin fecha programada"} · ${time}`} />
    </View>
    <View style={styles.orderProgress}>
      <View style={styles.between}>
        <Text style={styles.overline}>Trabajos</Text>
        <Text style={styles.progressCount}>{completed}/{total} · {progress}%</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel="Trabajos completados y entregados" accessibilityValue={{ min: 0, max: total || 1, now: completed, text: `${completed} de ${total} trabajos completados o entregados` }} style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
    </View>
    {closed && remaining > 0 ? <View style={styles.warning}>
      <Ionicons name="information-circle-outline" size={20} color={palette.amber} accessible={false} />
      <Text style={styles.warningText}>{direct ? "Asignación cerrada" : maintenance ? "Mantenimiento cerrado" : "OT cerrada"} con {remaining} {remaining === 1 ? "trabajo sin finalizar" : "trabajos sin finalizar"}.</Text>
    </View> : null}
    {matchingWorkCount !== group.works.length ? <Text style={styles.caption}>{matchingWorkCount} de {group.works.length} trabajos coinciden con la fecha y los filtros. Al abrir se muestran todos los trabajos asignados de esta orden.</Text> : null}
    <View style={styles.actionBar}>
      <Button stacked title="Detalle" accessibilityLabel={worksTitle} icon="document-text-outline" variant="secondary" iconColor={palette.info} disabled={busy} onPress={() => onOpenGroup(group, "works")} style={[styles.cell, styles.cellPrimary]} textStyle={styles.cellPrimaryText} />
      <Button stacked title="Archivos" accessibilityLabel={filesTitle} icon="folder-open-outline" variant="secondary" iconColor={palette.textSecondary} disabled={busy} onPress={() => onOpenGroup(group, "files")} style={[styles.cell, !canDeliver && styles.cellLast]} textStyle={styles.cellText} />
      {canDeliver ? <Button stacked title="Entregar OT" accessibilityLabel="Entregar OT" icon="checkmark-circle-outline" variant="secondary" iconColor="#C4510A" disabled={busy} onPress={() => onOpenGroup(group, "deliver")} style={[styles.cell, styles.cellLast, styles.cellDeliver]} textStyle={styles.cellDeliverText} /> : null}
    </View>
  </Card>;
}

const styles = StyleSheet.create({
  card: { gap: 16 },
  summary: { gap: 14 },
  typeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 9 },
  typeIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" },
  type: { ...typography.caption, color: palette.textSecondary, flex: 1 },
  codes: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: { ...typography.heading, color: palette.navy },
  statusLabel: { ...typography.caption, color: palette.text, fontWeight: "700" },
  metadata: { gap: 8 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { flex: 1, minWidth: 105, padding: 13, gap: 3, borderRadius: radius.sm, backgroundColor: palette.background },
  metricValue: { fontSize: 25, lineHeight: 31, fontWeight: "800", color: palette.navy, fontVariant: ["tabular-nums"] },
  caption: { ...typography.caption, color: palette.textSecondary },
  progress: { gap: 7 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  progressCount: { ...typography.caption, color: palette.primary, fontWeight: "700" },
  progressTrack: { height: 7, borderRadius: radius.pill, backgroundColor: palette.track, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: palette.teal, borderRadius: radius.pill },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: radius.sm, backgroundColor: palette.amberSoft },
  warningText: { ...typography.caption, color: palette.amber, flex: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, borderTopWidth: 1, borderTopColor: palette.track, paddingTop: 14 },
  action: { flexGrow: 1, flexBasis: 190, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12 },
  orderCard: { gap: 10, padding: 12, borderRadius: 12, overflow: "hidden" },
  code: { ...typography.caption, fontWeight: "800", color: palette.primary, letterSpacing: 0.5, backgroundColor: palette.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, overflow: "hidden" },
  typeLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: -4 },
  typeText: { ...typography.caption, color: palette.textMuted },
  heading: { gap: 2 },
  orderTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800", color: palette.navy, textTransform: "uppercase" },
  orderProgress: { gap: 4 },
  overline: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.8, color: palette.textMuted, textTransform: "uppercase" },
  actionBar: { flexDirection: "row", marginHorizontal: -12, marginBottom: -12, borderTopWidth: 1, borderTopColor: palette.border },
  cell: { flex: 1, minWidth: 0, borderRadius: 0, borderWidth: 0, borderRightWidth: 1, borderRightColor: palette.border, backgroundColor: palette.surface },
  cellLast: { borderRightWidth: 0 },
  cellPrimary: { backgroundColor: palette.infoSoft },
  cellPrimaryText: { color: palette.info },
  cellDeliver: { backgroundColor: "#FFF1E6" },
  cellDeliverText: { color: "#C4510A" },
  cellText: { color: palette.textSecondary },
});
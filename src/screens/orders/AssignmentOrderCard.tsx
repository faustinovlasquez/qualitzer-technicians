import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { assignmentNegotiationCode, assignmentWorkOrderCode } from "../../domain/assignmentCodes";
import { isFinished, plainText, shortDate, STATUS_LABELS } from "../../domain/format";
import { assignmentDay } from "../../domain/assignmentSchedule";
import type { AssignmentGroup } from "../../domain/models";
import { Badge, Button, Card } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { InfoBlock, infoStyles } from "./AssignmentInfoBlock";
import { equipmentLabel, groupTypes, statusTones } from "./assignmentPresentation";

export interface AssignmentOrderCardProps {
  group: AssignmentGroup;
  matchingWorkCount: number;
  busy?: boolean;
  onOpenGroup: (group: AssignmentGroup, initialTab?: "works" | "files" | "deliver") => void;
}

// Colores del estado de la orden en la tarjeta oscura (misma convención que el detalle del trabajo).
const heroStatusColors: Record<string, { soft: string; text: string }> = {
  pending: { soft: palette.amberSoft, text: palette.amber }, in_progress: { soft: palette.primarySoft, text: palette.primary }, paused: { soft: palette.amberSoft, text: palette.amber },
  completed: { soft: palette.successSoft, text: palette.success }, delivered: { soft: palette.infoSoft, text: palette.info },
};

/**
 * Tarjeta superior de la orden, fija sobre las pestañas: tipo y estado, título, equipo/cliente/ubicación a la izquierda
 * y trabajos, repuestos y avance a la derecha. Se puede minimizar a una línea con el título y el avance.
 */
export function AssignmentOrderSummary({ group, collapsed = false, onToggle }: { group: AssignmentGroup; collapsed?: boolean; onToggle?: () => void }) {
  const completed = group.works.filter(isFinished).length;
  const total = group.works.length;
  const remaining = total - completed;
  const progress = total > 0 ? Math.round(completed / total * 100) : 0;
  const closed = group.status === "completed" || group.status === "delivered";
  const direct = group.type === "direct_assignment";
  const maintenance = group.type === "internal_maintenance";
  const location = group.locationName.trim() ? group.locationName : group.locationAddress;
  const address = group.locationAddress?.trim() && group.locationName.trim() && group.locationAddress !== group.locationName ? group.locationAddress : null;
  const status = heroStatusColors[group.status] ?? { soft: palette.track, text: palette.text };
  const title = plainText(group.title) || groupTypes[group.type].label;

  return <LinearGradient colors={[palette.navy, palette.navyLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero} testID="order-hero">
    <View style={styles.heroTop}>
      <Ionicons name={groupTypes[group.type].icon} size={14} color={palette.onDark} accessible={false} />
      <Text style={styles.heroOverline} numberOfLines={1}>{groupTypes[group.type].label.toUpperCase()}</Text>
      {group.isOverdue && remaining > 0 ? <View style={styles.heroAlert}><Text style={styles.heroAlertText}>Con atrasos</Text></View> : null}
      <View style={[styles.heroStatus, { backgroundColor: status.soft }]}><Text style={[styles.heroStatusText, { color: status.text }]}>{STATUS_LABELS[group.status]}</Text></View>
      {onToggle ? <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? "Expandir tarjeta de la orden" : "Minimizar tarjeta de la orden"} accessibilityState={{ expanded: !collapsed }} hitSlop={10} onPress={onToggle} style={({ pressed }) => [styles.heroToggle, pressed && styles.heroPressed]} testID="order-hero-toggle">
        <Ionicons name={collapsed ? "chevron-down" : "chevron-up"} size={16} color={palette.white} accessible={false} />
      </Pressable> : null}
    </View>
    <View style={styles.heroTitleRow}>
      <Text accessibilityRole="header" style={styles.heroTitle} numberOfLines={collapsed ? 1 : 2}>{title}</Text>
      {collapsed ? <Text style={styles.heroCollapsedProgress}>{completed}/{total} · {progress}%</Text> : null}
    </View>
    {collapsed ? null : <View style={styles.heroBody}>
      <View style={styles.heroColumn}>
        <HeroFact label="Equipo" value={equipmentLabel(group.equipment)} />
        <HeroFact label="Cliente" value={group.customerName?.trim() ? group.customerName : "Cliente no informado"} />
        <HeroFact label="Ubicación" value={location?.trim() ? location : "Ubicación no informada"} detail={address} />
      </View>
      <View style={styles.heroDivider} />
      <View style={styles.heroColumn}>
        <View style={styles.heroCount}><Text style={styles.heroLabel}>Trabajos asignados</Text><Text style={styles.heroCountValue}>{total}</Text></View>
        <View style={styles.heroCount}><Text style={styles.heroLabel}>{direct ? "Repuestos de asignación" : maintenance ? "Repuestos del mantenimiento" : "Repuestos de la OT"}</Text><Text style={styles.heroCountValue}>{group.products.length}</Text></View>
        <View style={styles.heroProgress}>
          <Text style={styles.heroLabel}>Avance de trabajos</Text>
          <Text style={styles.heroProgressCount}>{completed}/{total} completados</Text>
          <View style={styles.heroProgressRow}>
            <View accessibilityRole="progressbar" accessibilityLabel="Trabajos completados y entregados" accessibilityValue={{ min: 0, max: total || 1, now: completed, text: `${completed} de ${total} trabajos completados o entregados` }} style={styles.heroTrack}>
              <View style={[styles.heroFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.heroPercent}>{progress}%</Text>
          </View>
        </View>
      </View>
    </View>}
    {!collapsed && closed && remaining > 0 ? <View style={styles.heroWarning}>
      <Ionicons name="information-circle-outline" size={16} color={palette.amber} accessible={false} />
      <Text style={styles.heroWarningText}>{direct ? "Asignación cerrada" : maintenance ? "Mantenimiento cerrado" : "OT cerrada"} con {remaining} {remaining === 1 ? "trabajo sin finalizar" : "trabajos sin finalizar"}. El estado de la orden no equivale al avance de sus trabajos.</Text>
    </View> : null}
  </LinearGradient>;
}

function HeroFact({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return <View style={styles.heroFact}>
    <Text style={styles.heroLabel}>{label}</Text>
    <Text style={styles.heroValue} numberOfLines={2}>{plainText(value)}</Text>
    {detail ? <Text style={styles.heroDetail} numberOfLines={1}>{plainText(detail)}</Text> : null}
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
      {canDeliver ? <Button stacked title="Entregar OT" accessibilityLabel="Entregar OT" icon="checkmark-circle-outline" variant="secondary" iconColor={palette.orange} disabled={busy} onPress={() => onOpenGroup(group, "deliver")} style={[styles.cell, styles.cellLast, styles.cellDeliver]} textStyle={styles.cellDeliverText} /> : null}
    </View>
  </Card>;
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: 10, marginTop: 4, marginBottom: 8, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 10, gap: 6, overflow: "hidden" },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroOverline: { flex: 1, minWidth: 0, fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.6, color: palette.onDark },
  heroAlert: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: palette.dangerSoft },
  heroAlertText: { fontSize: 10, lineHeight: 14, fontWeight: "800", color: palette.danger },
  heroStatus: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  heroStatusText: { fontSize: 11, fontWeight: "800" },
  heroToggle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  heroPressed: { opacity: 0.7 },
  heroTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: "800", color: palette.white },
  heroCollapsedProgress: { fontSize: 11, fontWeight: "800", color: palette.onDark },
  heroBody: { flexDirection: "row", alignItems: "stretch", borderTopWidth: 1, borderColor: "rgba(255,255,255,0.14)", paddingTop: 6 },
  heroColumn: { flex: 1, minWidth: 0, gap: 6 },
  heroDivider: { width: 1, marginHorizontal: 8, backgroundColor: "rgba(255,255,255,0.14)" },
  heroFact: { gap: 0 },
  heroLabel: { fontSize: 10, lineHeight: 13, fontWeight: "700", color: palette.onDark },
  heroValue: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: palette.white },
  heroDetail: { fontSize: 11, lineHeight: 14, color: palette.onDark },
  heroCount: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  heroCountValue: { fontSize: 16, lineHeight: 20, fontWeight: "800", color: palette.white, fontVariant: ["tabular-nums"] },
  heroProgress: { gap: 2 },
  heroProgressCount: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: palette.teal },
  heroProgressRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroTrack: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.85)", overflow: "hidden" },
  heroFill: { height: "100%", backgroundColor: palette.teal, borderRadius: radius.pill },
  heroPercent: { fontSize: 11, fontWeight: "800", color: palette.white, fontVariant: ["tabular-nums"] },
  heroWarning: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 8, borderRadius: radius.sm, backgroundColor: palette.amberSoft },
  heroWarningText: { fontSize: 11, lineHeight: 15, color: palette.amber, flex: 1 },
  codes: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  caption: { ...typography.caption, color: palette.textSecondary },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  progressCount: { ...typography.caption, color: palette.primary, fontWeight: "700" },
  progressTrack: { height: 7, borderRadius: radius.pill, backgroundColor: palette.track, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: palette.teal, borderRadius: radius.pill },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: radius.sm, backgroundColor: palette.amberSoft },
  warningText: { ...typography.caption, color: palette.amber, flex: 1 },
  orderCard: { gap: 10, padding: 12, borderRadius: 12, overflow: "hidden" },
  code: { ...typography.caption, fontWeight: "800", color: palette.primary, letterSpacing: 0.5, backgroundColor: palette.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, overflow: "hidden" },
  typeLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: -4 },
  typeText: { ...typography.caption, color: palette.textMuted },
  heading: { gap: 2 },
  orderTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800", color: palette.heading, textTransform: "uppercase" },
  orderProgress: { gap: 4 },
  overline: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.8, color: palette.textMuted, textTransform: "uppercase" },
  actionBar: { flexDirection: "row", marginHorizontal: -12, marginBottom: -12, borderTopWidth: 1, borderTopColor: palette.border },
  cell: { flex: 1, minWidth: 0, borderRadius: 0, borderWidth: 0, borderRightWidth: 1, borderRightColor: palette.border, backgroundColor: palette.surface },
  cellLast: { borderRightWidth: 0 },
  cellPrimary: { backgroundColor: palette.infoSoft },
  cellPrimaryText: { color: palette.info },
  cellDeliver: { backgroundColor: palette.orangeSoft },
  cellDeliverText: { color: palette.orange },
  cellText: { color: palette.textSecondary },
});
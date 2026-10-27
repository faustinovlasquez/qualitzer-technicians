import { useState, type ComponentProps, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { duration, plainText } from "../../domain/format";
import { isWorkActivity } from "../../domain/workActivities";
import { workChecklistProgress } from "../../domain/assignmentChecklistProgress";
import type { Activity, AssignmentGroup, AssignmentWork, Equipment, Material } from "../../domain/models";
import { Badge, BodyText, Button, Card, EmptyState, Field, IconButton, SectionTitle } from "../../ui/components";
import { PrivateModal } from "../../security/DeviceSecurityContext";
import { AttachmentList, Fact, HttpLink, Notice } from "./DetailUi";
import { styles } from "./detailStyles";
import { palette, radius } from "../../ui/theme";
import type { EquipmentLocationPort } from "../../domain/equipmentLocation";
import { EquipmentLocationPanel } from "../../location/EquipmentLocationPanel";

export function WorkDescription({ work, disabled = false }: { work: AssignmentWork; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const description = plainText(work.summary);
  const schedule = [work.scheduledStartTime ? `Desde ${work.scheduledStartTime.slice(0, 5)}` : "", work.scheduledEndTime ? `Hasta ${work.scheduledEndTime.slice(0, 5)}${work.endDateOffset === 1 ? " (+1 día)" : ""}` : ""].filter(Boolean).join(" · ");
  return <>
    {description ? <Pressable accessibilityRole="button" accessibilityLabel="Ver descripción completa del trabajo" accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(true)} style={({ pressed }) => [styles.descriptionPreview, pressed && styles.descriptionPressed]} testID="work-description-preview">
      {/* Una sola línea en la tarjeta; el horario, el sistema y el texto completo se ven al tocarla. */}
      <View style={styles.descriptionHeading}><Text numberOfLines={1} ellipsizeMode="tail" style={[styles.heroSmall, styles.grow]} testID="work-description-excerpt">{description}</Text><Ionicons name="expand-outline" size={14} color={palette.onDark} accessible={false} /></View>
    </Pressable> : <Text style={styles.heroSmall}>Sin descripción informada</Text>}
    {open ? <PrivateModal visible animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.safe} testID="work-description-dialog" accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)}>
        <View style={styles.descriptionHeader}><Text accessibilityRole="header" style={[styles.heading, styles.grow]}>Detalle del trabajo</Text><IconButton name="close-outline" label="Cerrar detalle del trabajo" onPress={() => setOpen(false)} /></View>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Text selectable accessibilityRole="header" style={styles.heading}>{plainText(work.title)}</Text>
          <View style={styles.columns}>
            <View style={styles.column}><Fact label="Fecha programada" value={work.scheduledDate.slice(0, 10) || "Sin fecha"} /><Fact label="Horario" value={schedule || "No informado"} /></View>
            <View style={styles.column}><Fact label="Tiempo asignado" value={duration(work.plannedMinutes)} /><Fact label="Prioridad" value={work.priority === "high" ? "Alta" : work.priority === "medium" ? "Media" : "Baja"} /></View>
          </View>
          {work.systemName || work.componentName ? <View style={styles.columns}>
            <View style={styles.column} testID="work-system-summary"><Fact label="Sistema" value={work.systemName} /></View>
            <View style={styles.column}><Fact label="Subsistema" value={work.componentName} /></View>
          </View> : null}
          <Text style={styles.label}>Descripción</Text>
          <Text selectable style={styles.descriptionFull} testID="work-description-full">{description}</Text>
        </ScrollView>
      </SafeAreaView>
    </PrivateModal> : null}
  </>;
}

function Materials({ materials }: { materials: Material[] }) {
  const states: { [key in Material["stockStatus"]]: string } = { in_stock: "En stock", requested: "Solicitado", reserved: "Reservado" };
  return materials.length === 0 ? <BodyText>No hay materiales informados para este trabajo.</BodyText> : <View>{materials.map((material) => <View key={material.id} style={styles.item}>
    <View style={styles.between}><Text style={[styles.label, styles.grow]}>{plainText(material.name)}</Text><Text style={styles.label}>Cantidad: {material.quantity}</Text></View>
    <View style={styles.row}>{material.ref ? <Text style={styles.caption}>Ref. {material.ref}</Text> : null}<Badge label={states[material.stockStatus]} /></View>
  </View>)}</View>;
}

export function Activities({ activities, documents = false }: { activities: Activity[]; documents?: boolean }) {
  return activities.length === 0 ? <BodyText>No hay actividades asociadas informadas.</BodyText> : <View style={styles.tight}>{activities.map((activity) => <View key={activity.id} style={styles.item}>
    <Text style={styles.label}>{plainText(activity.activity)}</Text>
    <Badge label={activity.isCompleted ? "Completada" : activity.isStarted ? "Iniciada" : "Pendiente"} tone={activity.isCompleted ? "success" : "neutral"} />
    {documents ? activity.technicalDocuments.length > 0 ? activity.technicalDocuments.map((document) => <View key={document.id} style={styles.tight}>
      <Text style={styles.label}>{plainText(document.documentName)}</Text>
      {document.notes ? <BodyText>{plainText(document.notes)}</BodyText> : null}
      {document.file ? <AttachmentList files={[document.file]} /> : <BodyText>No se recibió un archivo disponible para este documento.</BodyText>}
    </View>) : <BodyText>Sin documentos técnicos asociados a esta actividad.</BodyText> : null}
  </View>)}</View>;
}

interface WorkTabProps {
  activitiesPanel?: ReactNode;
  onChecklist?: (id: number) => void;
  /** Fotos y archivos del reporte: llevan a los archivos del trabajo, donde se toman, eligen o adjuntan. */
  onAttachments?: () => void;
  group: AssignmentGroup;
  work: AssignmentWork;
  report: string;
  savedReport: string | null;
  pendingReport?: boolean;
  disabled: boolean;
  readOnly: boolean;
  submitting: boolean;
  mode: "live" | "demo";
  onReportChange: (value: string) => void;
  onReportSubmit: () => void;
}

export function WorkTab({ group, work, report, savedReport, pendingReport = false, disabled, readOnly, submitting, mode, onReportChange, onReportSubmit, activitiesPanel, onChecklist, onAttachments }: WorkTabProps) {
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(report.trim().length > 0);
  const saved = savedReport !== null && savedReport === report.trim();
  return (
    <View style={styles.workSections}>
      {activitiesPanel ? <View style={styles.detailSection}>{activitiesPanel}</View> : <View style={styles.detailSection}><SectionTitle title="Actividades" /><Activities activities={(work.activities ?? []).filter(isWorkActivity)} documents /></View>}
      {work.checklists.length > 0 ? <View style={styles.checklistSection} testID="work-checklist-section">
        <View style={styles.checklistSectionHeading}><Ionicons name="checkbox-outline" size={20} color={palette.primary} /><Text accessibilityRole="header" style={styles.sectionTitleInline}>Checklists</Text><View style={styles.headingBadge}><Badge label={String(work.checklists.length)} /></View></View>
        {work.checklists.map(checklist => {
          const progress = workChecklistProgress({ checklists: [checklist] });
          const summary = progress.total > 0
            ? `${progress.completed}/${progress.total} confirmados · ${progress.remaining > 0 ? `${progress.remaining} ${progress.remaining === 1 ? "pendiente" : "pendientes"}` : "Completado"}`
            : checklist.steps.length > 0 ? "Sin requisitos obligatorios" : "Sin pasos";
          return <Pressable key={checklist.checklistId} testID={`work-checklist-card-${checklist.checklistId}`} accessibilityRole="button" accessibilityLabel={plainText(checklist.name)} accessibilityHint={`${summary}${progress.total > 0 ? `, ${progress.percentage}% de avance` : ""}`} accessibilityState={{ disabled: !onChecklist }} disabled={!onChecklist} onPress={() => onChecklist?.(checklist.checklistId)} style={({ pressed }) => [styles.checklistLink, pressed && styles.checklistLinkPressed]}>
            <View style={styles.checklistTitleRow}>
              <Text style={styles.checklistTitle}>{plainText(checklist.name)}</Text>
              {progress.total > 0 ? <Text style={styles.checklistPercentage}>{progress.percentage}%</Text> : null}
              <Ionicons name="chevron-forward-outline" size={18} color={palette.primary} accessible={false} />
            </View>
            <Text style={styles.checklistSummary}>{summary}{checklist.required ? " · Obligatorio" : ""}</Text>
            {progress.total > 0 ? <View style={styles.checklistProgressTrack} accessibilityRole="progressbar" accessibilityLabel={`Avance de ${plainText(checklist.name)}`} accessibilityValue={{ min: 0, max: progress.total, now: progress.completed, text: `${progress.percentage}% · ${progress.completed} de ${progress.total} requisitos confirmados` }}>
              <View style={[styles.checklistProgressFill, { width: `${progress.percentage}%` }]} />
            </View> : null}
          </Pressable>;
        })}
      </View> : null}
      {work.materials.length > 0 ? <View style={styles.detailSection} testID="work-materials-section"><View style={styles.sectionHeading}><Ionicons name="cube-outline" size={20} color={palette.primary} /><Text accessibilityRole="header" style={styles.sectionTitleInline}>Materiales</Text><View style={styles.headingBadge}><Badge label={String(work.materials.length)} /></View></View><Materials materials={work.materials} /></View> : null}
      {group.products.length > 0 ? <View style={styles.detailSection} testID="shared-materials-section"><View style={styles.sectionHeading}><Ionicons name="layers-outline" size={22} color={palette.primary} /><Text accessibilityRole="header" style={styles.sectionTitle}>Materiales compartidos</Text></View><Materials materials={group.products} /></View> : null}
      <View style={styles.detailSection}>
        <Pressable accessibilityRole="button" accessibilityLabel="Reporte técnico" accessibilityState={{ expanded: reportOpen }} onPress={() => setReportOpen(!reportOpen)} style={styles.sectionHeading}>
          <Ionicons name="document-text-outline" size={20} color={palette.primary} /><Text style={styles.sectionTitle}>Reporte técnico</Text><Ionicons name={reportOpen ? "chevron-up-outline" : "chevron-down-outline"} size={22} color={palette.primary} />
        </Pressable>
        {reportOpen ? <View style={styles.stack}>
        {pendingReport ? <Badge label="Reporte guardado · pendiente de sincronizar" tone="warning" /> : saved ? <Badge label={mode === "demo" ? "Guardado localmente · demo" : "Guardado en Qualitzer"} tone="info" /> : report.length > 0 ? <Badge label="Borrador en dispositivo" tone="warning" /> : null}
        <Field label="Nota del reporte (obligatoria)" value={report} onChangeText={onReportChange} editable={!disabled && !readOnly} multiline maxLength={10000} style={styles.multiline} placeholder="Trabajo realizado, condiciones del equipo y observaciones…" error={reportError} hint={`${report.length}/10000 caracteres. El texto se guarda como borrador mientras escribes; solo se envía al pulsar Guardar reporte.`} />
        {onAttachments ? <View style={styles.reportTools} testID="report-attachment-tools">
          {([["camera-outline", "Tomar foto para el reporte"], ["image-outline", "Agregar imagen al reporte"], ["attach-outline", "Adjuntar archivo al reporte"]] as const).map(([icon, label]) =>
            <Pressable key={icon} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onAttachments} hitSlop={6} style={({ pressed }) => [styles.reportTool, pressed && styles.checklistLinkPressed]}>
              <Ionicons name={icon} size={22} color={palette.textSecondary} accessible={false} />
            </Pressable>)}
        </View> : null}
        {group.type === "internal_maintenance" ? <BodyText>El reporte de mantenimiento se envía para guardarlo como un archivo de texto adjunto al trabajo.</BodyText> : null}
        {!readOnly ? <Button title={mode === "demo" ? "Guardar reporte en demo" : "Guardar reporte"} icon="document-text-outline" disabled={disabled || saved || pendingReport} loading={submitting} onPress={() => {
          if (!report.trim()) { setReportError("Escribe una nota antes de guardar el reporte."); return; }
          setReportError(null);
          onReportSubmit();
        }} /> : <BodyText>Asignación cerrada. No se pueden enviar nuevos reportes.</BodyText>}
        </View> : null}
      </View>
    </View>
  );
}

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Dato de la ficha en un recuadro: etiqueta pequeña arriba y valor destacado (o «No informado» atenuado). */
function Spec({ label, value }: { label: string; value: string | null | undefined }) {
  const text = plainText(value ?? "");
  return <View style={equipmentStyles.spec} accessible accessibilityLabel={`${label}: ${text || "No informado"}`}>
    <Text style={equipmentStyles.specLabel} numberOfLines={1}>{label}</Text>
    <Text selectable style={[equipmentStyles.specValue, !text && equipmentStyles.muted]} numberOfLines={2}>{text || "No informado"}</Text>
  </View>;
}

/** Fila con ícono para el contexto del trabajo. */
function ContextRow({ icon, label, value, last = false }: { icon: IconName; label: string; value: string | null | undefined; last?: boolean }) {
  const text = plainText(value ?? "");
  return <View style={[equipmentStyles.row, !last && equipmentStyles.rowDivider]} accessible accessibilityLabel={`${label}: ${text || "No informado"}`}>
    <View style={equipmentStyles.rowIcon}><Ionicons name={icon} size={16} color={palette.primary} accessible={false} /></View>
    <View style={styles.grow}>
      <Text style={equipmentStyles.specLabel}>{label}</Text>
      <Text style={[equipmentStyles.rowValue, !text && equipmentStyles.muted]} numberOfLines={2}>{text || "No informado"}</Text>
    </View>
  </View>;
}

function EquipmentCard({ equipment, title, children }: { equipment: Equipment; title: string; children?: ReactNode }) {
  const owner = plainText(equipment.ownerLabel ?? "");
  return <Card style={equipmentStyles.card}>
    <View style={equipmentStyles.head}>
      <View style={equipmentStyles.headIcon}><Ionicons name="hardware-chip-outline" size={24} color={palette.primary} accessible={false} /></View>
      <View style={styles.grow}>
        <Text style={equipmentStyles.kicker}>{title}</Text>
        <Text accessibilityRole="header" selectable style={equipmentStyles.name} numberOfLines={3}>{plainText(equipment.label) || "Equipo sin nombre"}</Text>
      </View>
      {owner ? <View style={equipmentStyles.owner}><Text style={equipmentStyles.ownerText} numberOfLines={1}>{owner}</Text></View> : null}
    </View>
    <View style={equipmentStyles.specs}>
      <Spec label="Identificación" value={equipment.identifier} />
      <Spec label="Número interno" value={equipment.internalNumber} />
    </View>
    {children ? <View style={equipmentStyles.section}>{children}</View> : null}
  </Card>;
}

export function EquipmentTab({ group, work, locationPort, identity = "", disabled = false, online = true, onAssociate }: { group: AssignmentGroup; work: AssignmentWork; locationPort?: EquipmentLocationPort; identity?: string; disabled?: boolean; online?: boolean; onAssociate?: () => void }) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const inherited = group.type === "internal_maintenance";
  const equipment = inherited ? group.equipment : work.workEquipment ?? group.equipment;
  const showGroupEquipment = !inherited && work.workEquipment && group.equipment && JSON.stringify(work.workEquipment) !== JSON.stringify(group.equipment);
  const activities = (work.activities ?? []).filter(isWorkActivity);
  return <View style={styles.stack}>
    {equipment ? <EquipmentCard equipment={equipment} title={inherited ? "Equipo del mantenimiento" : work.workEquipment ? "Equipo del trabajo" : "Equipo de la asignación"}>
      {locationPort ? <EquipmentLocationPanel key={`${identity}:work`} port={locationPort} target="work" identity={identity} disabled={disabled} online={online} /> : null}
    </EquipmentCard> : <Card style={equipmentStyles.card}><EmptyState title="Sin equipo asociado" message={inherited ? "El mantenimiento no tiene un equipo informado." : "Asocia el equipo para ver su ficha y ubicación."} icon="hardware-chip-outline" />
      {!inherited && onAssociate ? <Button title="Asociar equipo" icon="hardware-chip-outline" variant="secondary" disabled={disabled || !online} onPress={onAssociate} /> : null}
    </Card>}
    {showGroupEquipment && group.equipment ? <EquipmentCard equipment={group.equipment} title="Equipo de la asignación general">
      {locationPort ? <EquipmentLocationPanel key={`${identity}:group`} port={locationPort} target="group" identity={identity} disabled={disabled} online={online} /> : null}
    </EquipmentCard> : null}
    <Card style={equipmentStyles.card}>
      <View style={equipmentStyles.sectionHead}><Ionicons name="briefcase-outline" size={18} color={palette.primary} accessible={false} /><Text accessibilityRole="header" style={equipmentStyles.sectionTitle}>Contexto del trabajo</Text></View>
      <View>
        <ContextRow icon="business-outline" label="Cliente" value={work.workCustomerName ?? group.customerName} />
        <ContextRow icon="location-outline" label="Ubicación" value={group.locationName} />
        <ContextRow icon="cog-outline" label="Sistema" value={work.systemName} />
        <ContextRow icon="git-branch-outline" label="Subsistema" value={work.componentName} last={!group.locationAddress?.trim()} />
      </View>
      {group.locationAddress?.trim() ? <View style={equipmentStyles.address}>
        <Ionicons name="navigate-outline" size={16} color={palette.primary} accessible={false} />
        <View style={styles.grow}><Text style={equipmentStyles.specLabel}>Dirección · toca para abrir en Maps</Text><HttpLink label={group.locationAddress} url={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(group.locationAddress)}`} onError={setLinkError} /></View>
      </View> : null}
      {linkError ? <Notice message={linkError} tone="error" onDismiss={() => setLinkError(null)} /> : null}
    </Card>
    {activities.length > 0 ? <Card style={equipmentStyles.card}>
      <View style={equipmentStyles.sectionHead}><Ionicons name="document-text-outline" size={18} color={palette.primary} accessible={false} /><Text accessibilityRole="header" style={equipmentStyles.sectionTitle}>Actividades y documentos técnicos</Text></View>
      <Activities activities={activities} documents />
    </Card> : null}
  </View>;
}

const equipmentStyles = StyleSheet.create({
  card: { gap: 14, padding: 16 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  kicker: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", color: palette.textSecondary },
  name: { marginTop: 2, fontSize: 18, lineHeight: 24, fontWeight: "800", color: palette.heading },
  owner: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.primarySoft, maxWidth: 120 },
  ownerText: { fontSize: 12, fontWeight: "800", color: palette.primary },
  specs: { flexDirection: "row", gap: 10 },
  spec: { flex: 1, minWidth: 0, gap: 4, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  specLabel: { fontSize: 12, fontWeight: "600", color: palette.textSecondary },
  specValue: { fontSize: 16, fontWeight: "800", color: palette.heading },
  muted: { fontWeight: "500", color: palette.textMuted },
  section: { paddingTop: 14, borderTopWidth: 1, borderTopColor: palette.border },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: palette.border },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  rowValue: { fontSize: 15, fontWeight: "700", color: palette.heading },
  address: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: palette.background }
});
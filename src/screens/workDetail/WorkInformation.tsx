import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
import { palette } from "../../ui/theme";
import type { EquipmentLocationPort } from "../../domain/equipmentLocation";
import { EquipmentLocationPanel } from "../../location/EquipmentLocationPanel";

export function WorkDescription({ work, disabled = false }: { work: AssignmentWork; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const description = plainText(work.summary);
  const schedule = [work.scheduledStartTime ? `Desde ${work.scheduledStartTime.slice(0, 5)}` : "", work.scheduledEndTime ? `Hasta ${work.scheduledEndTime.slice(0, 5)}${work.endDateOffset === 1 ? " (+1 día)" : ""}` : ""].filter(Boolean).join(" · ");
  return <>
    {description ? <Pressable accessibilityRole="button" accessibilityLabel="Ver descripción completa del trabajo" accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(true)} style={({ pressed }) => [styles.descriptionPreview, pressed && styles.descriptionPressed]} testID="work-description-preview">
      <View style={styles.descriptionHeading}><Text style={styles.heroText}>Descripción</Text><Ionicons name="expand-outline" size={20} color={palette.onDark} accessible={false} /></View>
      <Text numberOfLines={3} ellipsizeMode="tail" style={styles.heroText} testID="work-description-excerpt">{description}</Text>
    </Pressable> : <Text style={styles.heroText}>Sin descripción informada</Text>}
    {schedule ? <Text style={styles.heroText}>{schedule}</Text> : null}
    {open ? <PrivateModal visible animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.safe} testID="work-description-dialog" accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)}>
        <View style={styles.descriptionHeader}><Text accessibilityRole="header" style={[styles.heading, styles.grow]}>Detalle del trabajo</Text><IconButton name="close-outline" label="Cerrar detalle del trabajo" onPress={() => setOpen(false)} /></View>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <Text selectable accessibilityRole="header" style={styles.heading}>{plainText(work.title)}</Text>
          <View style={styles.columns}>
            <View style={styles.column}><Fact label="Fecha programada" value={work.scheduledDate.slice(0, 10) || "Sin fecha"} /><Fact label="Horario" value={schedule || "No informado"} /></View>
            <View style={styles.column}><Fact label="Tiempo asignado" value={duration(work.plannedMinutes)} /><Fact label="Prioridad" value={work.priority === "high" ? "Alta" : work.priority === "medium" ? "Media" : "Baja"} /></View>
          </View>
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

export function WorkTab({ group, work, report, savedReport, pendingReport = false, disabled, readOnly, submitting, mode, onReportChange, onReportSubmit, activitiesPanel, onChecklist }: WorkTabProps) {
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(report.trim().length > 0);
  const saved = savedReport !== null && savedReport === report.trim();
  return (
    <View style={styles.workSections}>
      {activitiesPanel ?? <View style={styles.detailSection}><SectionTitle title="Actividades" /><Activities activities={(work.activities ?? []).filter(isWorkActivity)} documents /></View>}
      {work.checklists.length > 0 ? <View style={styles.checklistSection} testID="work-checklist-section">
        <View style={styles.checklistSectionHeading}><Ionicons name="checkbox-outline" size={20} color={palette.primary} /><Text accessibilityRole="header" style={styles.sectionTitle}>Checklists</Text><Badge label={String(work.checklists.length)} /></View>
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
      {work.materials.length > 0 ? <View style={styles.detailSection} testID="work-materials-section"><View style={styles.sectionHeading}><Ionicons name="cube-outline" size={22} color={palette.primary} /><Text accessibilityRole="header" style={styles.sectionTitle}>Materiales</Text><Badge label={String(work.materials.length)} /></View><Materials materials={work.materials} /></View> : null}
      {group.products.length > 0 ? <View style={styles.detailSection} testID="shared-materials-section"><View style={styles.sectionHeading}><Ionicons name="layers-outline" size={22} color={palette.primary} /><Text accessibilityRole="header" style={styles.sectionTitle}>Materiales compartidos</Text></View><Materials materials={group.products} /></View> : null}
      {work.responsibles.length > 0 ? <View style={styles.detailSection}><Text style={styles.caption}>Responsables</Text><Text style={styles.label}>{work.responsibles.map(responsible => responsible.name).join(", ")}</Text></View> : null}
      <View style={styles.detailSection}>
        <Pressable accessibilityRole="button" accessibilityLabel="Reporte técnico" accessibilityState={{ expanded: reportOpen }} onPress={() => setReportOpen(!reportOpen)} style={styles.sectionHeading}>
          <Ionicons name="document-text-outline" size={22} color={palette.primary} /><Text style={styles.sectionTitle}>Reporte técnico</Text><Ionicons name={reportOpen ? "chevron-up-outline" : "chevron-down-outline"} size={22} color={palette.primary} />
        </Pressable>
        {reportOpen ? <View style={styles.stack}>
        {pendingReport ? <Badge label="Reporte guardado · pendiente de sincronizar" tone="warning" /> : saved ? <Badge label={mode === "demo" ? "Guardado localmente · demo" : "Guardado en Qualitzer"} tone="info" /> : report.length > 0 ? <Badge label="Borrador en dispositivo" tone="warning" /> : null}
        <Field label="Nota del reporte (obligatoria)" value={report} onChangeText={onReportChange} editable={!disabled && !readOnly} multiline maxLength={10000} style={styles.multiline} placeholder="Trabajo realizado, condiciones del equipo y observaciones…" error={reportError} hint={`${report.length}/10000 caracteres. El texto se guarda como borrador mientras escribes; solo se envía al pulsar Guardar reporte.`} />
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

function EquipmentCard({ equipment, title, children }: { equipment: Equipment; title: string; children?: ReactNode }) {
  return <Card style={styles.stack}>
    <SectionTitle title={title} subtitle={plainText(equipment.label)} />
    <View style={styles.columns}>
      <View style={styles.column}><Fact label="Identificación" value={equipment.identifier} /><Fact label="Número interno" value={equipment.internalNumber} /></View>
      <View style={styles.column}><Fact label="Propietario" value={equipment.ownerLabel} /></View>
    </View>
    {children}
  </Card>;
}

export function EquipmentTab({ group, work, locationPort, identity = "", disabled = false, online = true, onAssociate }: { group: AssignmentGroup; work: AssignmentWork; locationPort?: EquipmentLocationPort; identity?: string; disabled?: boolean; online?: boolean; onAssociate?: () => void }) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const inherited = group.type === "internal_maintenance";
  const equipment = inherited ? group.equipment : work.workEquipment ?? group.equipment;
  const showGroupEquipment = !inherited && work.workEquipment && group.equipment && JSON.stringify(work.workEquipment) !== JSON.stringify(group.equipment);
  return <View style={styles.stack}>
    <SectionTitle title="Ficha de la asignación" subtitle="Datos de equipo recibidos con este trabajo. No corresponde a una ficha completa del catálogo." />
    {equipment ? <EquipmentCard equipment={equipment} title={inherited ? "Equipo del mantenimiento" : work.workEquipment ? "Equipo del trabajo" : "Equipo de la asignación"}>
      {locationPort ? <EquipmentLocationPanel key={`${identity}:work`} port={locationPort} target="work" identity={identity} disabled={disabled} online={online} /> : null}
    </EquipmentCard> : <View style={styles.stack}><EmptyState title="Sin equipo asociado" message={inherited ? "El mantenimiento no tiene un equipo informado." : ""} icon="hardware-chip-outline" />
      {!inherited && onAssociate ? <Button title="Asociar equipo" icon="hardware-chip-outline" variant="secondary" disabled={disabled || !online} onPress={onAssociate} /> : null}
    </View>}
    {showGroupEquipment && group.equipment ? <EquipmentCard equipment={group.equipment} title="Equipo de la asignación general">
      {locationPort ? <EquipmentLocationPanel key={`${identity}:group`} port={locationPort} target="group" identity={identity} disabled={disabled} online={online} /> : null}
    </EquipmentCard> : null}
    <Card style={styles.stack}>
      <SectionTitle title="Ubicación y contexto" />
      <View style={styles.columns}>
        <View style={styles.column}><Fact label="Cliente" value={work.workCustomerName ?? group.customerName} /><Fact label="Ubicación" value={group.locationName} /><Fact label="Sucursal" value="No informada en esta ficha" /></View>
        <View style={styles.column}><Fact label="Sistema" value={work.systemName} /><Fact label="Componente" value={work.componentName} /></View>
      </View>
      {group.locationAddress?.trim() ? <View style={styles.tight}><Text style={styles.caption}>Dirección · toca para buscar en Maps</Text><HttpLink label={group.locationAddress} url={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(group.locationAddress)}`} onError={setLinkError} /></View> : <BodyText>No se recibió una dirección para abrir en Maps.</BodyText>}
      {linkError ? <Notice message={linkError} tone="error" onDismiss={() => setLinkError(null)} /> : null}
    </Card>
    <View style={styles.stack}><SectionTitle title="Actividades y documentos técnicos" /><Activities activities={(work.activities ?? []).filter(isWorkActivity)} documents /></View>
  </View>;
}
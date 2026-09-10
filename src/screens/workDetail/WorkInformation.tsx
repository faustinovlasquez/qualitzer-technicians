import { useState } from "react";
import { Text, View } from "react-native";
import { plainText } from "../../domain/format";
import type { Activity, AssignmentGroup, AssignmentWork, Equipment, Material } from "../../domain/models";
import { Badge, BodyText, Button, Card, EmptyState, Field, SectionTitle } from "../../ui/components";
import { AttachmentList, Fact, HttpLink, Notice } from "./DetailUi";
import { styles } from "./detailStyles";

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
  group: AssignmentGroup;
  work: AssignmentWork;
  report: string;
  savedReport: string | null;
  disabled: boolean;
  readOnly: boolean;
  submitting: boolean;
  mode: "live" | "demo";
  onReportChange: (value: string) => void;
  onReportSubmit: () => void;
}

export function WorkTab({ group, work, report, savedReport, disabled, readOnly, submitting, mode, onReportChange, onReportSubmit }: WorkTabProps) {
  const [reportError, setReportError] = useState<string | null>(null);
  const saved = savedReport !== null && savedReport === report.trim();
  return (
    <View style={styles.stack}>
      <Card style={styles.stack}>
        <SectionTitle title="Instrucciones del trabajo" />
        <BodyText>{plainText(work.summary) || "No se recibieron instrucciones adicionales para este trabajo."}</BodyText>
      </Card>
      <View style={styles.columns}>
        <Card style={styles.column}><SectionTitle title="Materiales del trabajo" /><Materials materials={work.materials} /></Card>
        <Card style={styles.column}>
          <SectionTitle title="Responsables" />
          {work.responsibles.length === 0 ? <BodyText>No se informaron responsables.</BodyText> : work.responsibles.map((responsible) => <View key={String(responsible.id)} style={styles.item}><Text style={styles.label}>{responsible.name}</Text></View>)}
        </Card>
      </View>
      {group.products.length > 0 ? <Card style={styles.stack}><SectionTitle title="Materiales de la asignación" subtitle="Materiales informados a nivel de la orden o asignación, no necesariamente exclusivos de este trabajo." /><Materials materials={group.products} /></Card> : null}
      <Card style={styles.stack}><SectionTitle title="Actividades asociadas" /><Activities activities={work.activities ?? []} /></Card>
      <Card style={styles.stack}>
        <SectionTitle title="Reporte técnico" subtitle="Describe lo realizado, los hallazgos y cualquier pendiente." />
        {saved ? <Badge label={mode === "demo" ? "Guardado localmente · demo" : "Guardado en Qualitzer"} tone="info" /> : report.length > 0 ? <Badge label="Borrador en dispositivo" tone="warning" /> : null}
        <Field label="Nota del reporte (obligatoria)" value={report} onChangeText={onReportChange} editable={!disabled && !readOnly} multiline maxLength={10000} style={styles.multiline} placeholder="Trabajo realizado, condiciones del equipo y observaciones…" error={reportError} hint={`${report.length}/10000 caracteres. El texto se guarda como borrador mientras escribes; solo se envía al pulsar Guardar reporte.`} />
        {group.type === "internal_maintenance" ? <BodyText>El reporte de mantenimiento se envía para guardarlo como un archivo de texto adjunto al trabajo.</BodyText> : null}
        <BodyText>{saved ? "Confirmación del último envío desde este dispositivo. " : ""}No hay historial de reportes disponible en esta ficha; este campo no es una lectura de comentarios anteriores.</BodyText>
        {!readOnly ? <Button title={mode === "demo" ? "Guardar reporte en demo" : "Guardar reporte"} icon="document-text-outline" disabled={disabled || saved} loading={submitting} onPress={() => {
          if (!report.trim()) { setReportError("Escribe una nota antes de guardar el reporte."); return; }
          setReportError(null);
          onReportSubmit();
        }} /> : <BodyText>Asignación cerrada. No se pueden enviar nuevos reportes.</BodyText>}
      </Card>
    </View>
  );
}

function EquipmentCard({ equipment, title }: { equipment: Equipment; title: string }) {
  return <Card style={styles.stack}>
    <SectionTitle title={title} subtitle={plainText(equipment.label)} />
    <View style={styles.columns}>
      <View style={styles.column}><Fact label="Identificación" value={equipment.identifier} /><Fact label="Número interno" value={equipment.internalNumber} /></View>
      <View style={styles.column}><Fact label="Propietario" value={equipment.ownerLabel} /></View>
    </View>
  </Card>;
}

export function EquipmentTab({ group, work }: { group: AssignmentGroup; work: AssignmentWork }) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const equipment = work.workEquipment ?? group.equipment;
  const showGroupEquipment = work.workEquipment && group.equipment && JSON.stringify(work.workEquipment) !== JSON.stringify(group.equipment);
  return <View style={styles.stack}>
    <SectionTitle title="Ficha de la asignación" subtitle="Datos de equipo recibidos con este trabajo. No corresponde a una ficha completa del catálogo." />
    {equipment ? <EquipmentCard equipment={equipment} title={work.workEquipment ? "Equipo del trabajo" : "Equipo de la asignación"} /> : <Card><EmptyState title="Sin equipo informado" message="La asignación no incluye datos de un equipo. No se consultan ni infieren equipos por identificador." icon="hardware-chip-outline" /></Card>}
    {showGroupEquipment && group.equipment ? <EquipmentCard equipment={group.equipment} title="Equipo de la asignación general" /> : null}
    <Card style={styles.stack}>
      <SectionTitle title="Ubicación y contexto" />
      <View style={styles.columns}>
        <View style={styles.column}><Fact label="Cliente" value={work.workCustomerName ?? group.customerName} /><Fact label="Ubicación" value={group.locationName} /><Fact label="Sucursal" value="No informada en esta ficha" /></View>
        <View style={styles.column}><Fact label="Sistema" value={work.systemName} /><Fact label="Componente" value={work.componentName} /></View>
      </View>
      {group.locationAddress?.trim() ? <View style={styles.tight}><Text style={styles.caption}>Dirección · toca para buscar en Maps</Text><HttpLink label={group.locationAddress} url={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(group.locationAddress)}`} onError={setLinkError} /></View> : <BodyText>No se recibió una dirección para abrir en Maps.</BodyText>}
      {linkError ? <Notice message={linkError} tone="error" onDismiss={() => setLinkError(null)} /> : null}
    </Card>
    <Card style={styles.stack}><SectionTitle title="Actividades y documentos técnicos" subtitle="Solo se muestran los documentos asociados que incluye la asignación." /><Activities activities={work.activities ?? []} documents /></Card>
  </View>;
}
import { useState } from "react";
import { ActivityIndicator, Image, Platform, Text, View } from "react-native";
import { plainText } from "../../domain/format";
import type { AssignmentWork, Attachment } from "../../domain/models";
import { Badge, BodyText, Button, Card, SectionTitle } from "../../ui/components";
import { palette } from "../../ui/theme";
import { AttachmentList, ChoiceButton, Notice } from "./DetailUi";
import { styles } from "./detailStyles";
import type { PendingPhoto } from "./useWorkDraft";

interface EvidenceTabProps {
  work: AssignmentWork;
  maintenance: boolean;
  mode: "live" | "demo";
  files: Attachment[] | null;
  loading: boolean;
  filesError: string | null;
  photos: PendingPhoto[];
  target: string | undefined;
  disabled: boolean;
  readOnly: boolean;
  preparing: boolean;
  uploading: boolean;
  onTarget: (stepId?: string) => void;
  onPick: (source: "camera" | "library") => void;
  onCancelPick: () => void;
  onRemove: (id: string) => void;
  onUpload: () => void;
  onCleanup: () => void;
  onLoad: () => void;
}

function LocalPreview({ item, disabled, onRemove }: { item: PendingPhoto; disabled: boolean; onRemove: () => void }) {
  const [failed, setFailed] = useState(false);
  return <View style={styles.photoCard}>
    {!failed ? <Image source={{ uri: item.photo.uri }} style={styles.photo} resizeMode="contain" accessibilityLabel={`Foto pendiente: ${item.photo.name}`} onError={() => setFailed(true)} /> : <Notice message="Vista previa no disponible. Si el archivo ya no existe, quítalo y vuelve a seleccionarlo." tone="warning" />}
    <Text style={styles.label}>{item.photo.name}</Text>
    <Text style={styles.caption}>{item.photo.size === undefined ? "Tamaño no disponible" : `${(item.photo.size / 1024 / 1024).toFixed(1)} MB`}</Text>
    <Button title={`Quitar ${item.photo.name}`} variant="secondary" icon="trash-outline" disabled={disabled} onPress={onRemove} />
  </View>;
}

export function EvidenceTab(props: EvidenceTabProps) {
  const pending = props.photos.filter((item) => !item.uploaded);
  const selected = pending.filter((item) => item.stepId === props.target);
  const steps = props.work.checklists.flatMap((checklist) => [...checklist.steps].sort((a, b) => a.order - b.order));
  const targetStep = steps.find((step) => String(step.stepId) === props.target);
  const targetMissing = props.target !== undefined && !targetStep;
  const unavailable = props.disabled || props.readOnly;
  const orphanTargets = [...new Set(pending.filter((item) => item.stepId !== undefined && !steps.some((step) => String(step.stepId) === item.stepId)).map((item) => item.stepId))];
  return <View style={styles.stack}>
    <Card style={styles.stack}>
      <SectionTitle title="Preparar evidencias" subtitle="Selecciona fotos, revisa la vista previa y confirma el envío." />
      <BodyText>Hasta 4 fotos pendientes entre todos los destinos · máximo 25 MB por foto y 40 MB en total (MiB). JPEG, PNG, WebP o HEIC. Se conserva la calidad original.</BodyText>
      {Platform.OS === "web" ? <Notice message="Fotos solo en esta sesión del navegador: no son un borrador duradero. Se conservan al volver dentro de la app, pero se pierden al recargar o cerrar la página. Súbelas antes de salir." tone="warning" /> : <BodyText>Las fotos se copian al almacenamiento duradero del dispositivo. Solo se eliminan después de confirmar el envío o al borrar los datos de esta sesión.</BodyText>}
      {props.maintenance ? <View style={styles.tight}>
        <Text style={styles.label}>Destino de las fotos</Text>
        <ChoiceButton label="Evidencia general del trabajo" selected={props.target === undefined} disabled={props.disabled} onPress={() => props.onTarget(undefined)} />
        {steps.map((step) => <ChoiceButton key={String(step.stepId)} label={`Paso: ${plainText(step.title)}`} selected={props.target === String(step.stepId)} disabled={props.disabled} onPress={() => props.onTarget(String(step.stepId))} />)}
        {orphanTargets.map((id) => <ChoiceButton key={id} label="Paso ya no disponible · recuperar fotos pendientes" selected={props.target === id} disabled={props.disabled} onPress={() => props.onTarget(id)} />)}
      </View> : <BodyText>Las fotos se adjuntan al trabajo. La carga por paso no está disponible para trabajos estándar.</BodyText>}
      {targetMissing ? <Notice message="Este paso ya no está en la asignación. No se enviarán fotos a un destino desconocido; quítalas y vuelve a seleccionarlas para el trabajo." tone="warning" /> : null}
      <Badge label={props.target === undefined ? "Destino: trabajo" : `Destino: ${plainText(targetStep?.title ?? "paso no disponible")}`} tone="info" />
      <View style={styles.row}>
        <Button title="Tomar foto" icon="camera-outline" variant="secondary" disabled={unavailable || pending.length >= 4 || targetMissing} onPress={() => props.onPick("camera")} />
        <Button title="Elegir de galería" icon="images-outline" variant="secondary" disabled={unavailable || pending.length >= 4 || targetMissing} onPress={() => props.onPick("library")} />
      </View>
      {props.preparing ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><BodyText>Esperando selección o preparando las fotos…</BodyText></View> : null}
      {props.preparing && Platform.OS === "web" ? <Button title="Ya cerré el selector · cancelar selección" variant="secondary" onPress={props.onCancelPick} /> : null}
      <Text style={styles.label}>{selected.length} fotos pendientes en este destino · {pending.length}/4 en total</Text>
      {selected.length > 0 ? <View style={styles.photos}>{selected.map((item) => <LocalPreview key={item.photo.id} item={item} disabled={unavailable} onRemove={() => props.onRemove(item.photo.id)} />)}</View> : <BodyText>No hay fotos pendientes para este destino.</BodyText>}
      {selected.length > 0 ? <Badge label={Platform.OS === "web" ? "Pendiente · solo en esta sesión" : "Borrador en dispositivo"} tone="warning" /> : null}
      {!props.readOnly ? <Button title={props.mode === "demo" ? "Guardar fotos en demo" : `Subir ${selected.length} fotos`} icon="cloud-upload-outline" loading={props.uploading} disabled={unavailable || selected.length === 0 || targetMissing || (!props.maintenance && props.target !== undefined)} onPress={props.onUpload} /> : <BodyText>Asignación cerrada: los archivos son de solo lectura.</BodyText>}
      {props.photos.some((item) => item.uploaded) ? <View style={styles.tight}><Notice message="Hay fotos cuyo envío ya fue confirmado. Solo queda limpiar su copia local; no se volverán a subir." /><Button title="Limpiar copias ya enviadas" variant="secondary" disabled={props.disabled} onPress={props.onCleanup} /></View> : null}
    </Card>
    <Card style={styles.stack}>
      <View style={styles.between}><SectionTitle title={props.mode === "demo" ? "Archivos de demostración" : "Archivos guardados en Qualitzer"} subtitle="Evidencia general del trabajo" /><Button title="Actualizar archivos" variant="secondary" icon="refresh-outline" disabled={props.disabled || props.loading} loading={props.loading} onPress={props.onLoad} /></View>
      {props.filesError ? <Notice message={props.filesError} tone="error" /> : null}
      {props.loading ? <BodyText>Consultando archivos…</BodyText> : null}
      {props.files !== null ? <AttachmentList files={props.files} /> : !props.loading ? <BodyText>No se ha podido verificar la lista de archivos.</BodyText> : null}
    </Card>
    {steps.some((step) => step.attachments.length > 0) ? <Card style={styles.stack}><SectionTitle title="Evidencias confirmadas por paso" />{steps.filter((step) => step.attachments.length > 0).map((step) => <View key={String(step.stepId)} style={styles.tight}><Text style={styles.label}>{plainText(step.title)}</Text><AttachmentList files={step.attachments} /></View>)}</Card> : null}
  </View>;
}
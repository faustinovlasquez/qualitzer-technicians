import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { checklistAnswerError, hasChecklistStepAnswer, isChecklistStepProgressRelevant, normalizeChecklistAnswer } from "../../../domain/checklistProgress";
import { answerFromStep, plainText } from "../../../domain/format";
import type { ChecklistStep, StepAnswer } from "../../../domain/models";
import { Badge, BodyText, Button, Field, IconButton } from "../../../ui/components";
import type { ChecklistTabProps } from "../ChecklistTab";
import { AttachmentList, Notice } from "../DetailUi";
import { errorMessage } from "../detailRules";
import { styles } from "../detailStyles";
import { displayedAnswer } from "../useWorkDraft";
import { checklistAnswerLabel, checklistStepStatus } from "./checklistPresentation";
import { ResponseInput } from "./ResponseInput";
import { checklistStyles } from "./styles";

export function StepEditor({ step, context, onPrevious, onNext, notices }: { step: ChecklistStep; context: ChecklistTabProps; onPrevious?: () => void; onNext?: () => void; notices?: ReactNode }) {
  const [validation, setValidation] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [showConfirmed, setShowConfirmed] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const nextAfterSave = useRef(onNext);
  nextAfterSave.current = onNext;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const id = String(step.stepId);
  const entry = context.draft.answers[id];
  const dirty = entry?.saved === false;
  const confirmedAnswer = entry?.saved === true ? displayedAnswer(step, entry) : answerFromStep(step);
  const answer = context.readOnly ? confirmedAnswer : displayedAnswer(step, entry);
  const queued = context.isAnswerQueued?.(step, answer) === true;
  const confirmed = entry?.saved === true || hasChecklistStepAnswer(step) || step.comment.trim() !== "";
  const pendingFiles = context.draft.photos.filter((item) => item.stepId === id && !item.uploaded).length + (context.pendingEvidenceCount?.(id) ?? 0);
  const disabled = context.disabled || context.readOnly || saving || context.savingStep !== null;
  const status = checklistStepStatus(step);
  const supported = ["validation", "text", "number", "select", "multiselect", "approval"].includes(step.type);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [step.stepId]);
  useEffect(() => { if (validation) scroll.current?.scrollTo({ y: 0, animated: false }); }, [validation]);

  function change(next: StepAnswer): void {
    setValidation(null);
    context.onChange(step, next);
  }

  async function save(advance: boolean): Promise<void> {
    if (disabled || running.current || !dirty || queued) return;
    const submitted = normalizeChecklistAnswer(step, answer);
    const error = checklistAnswerError(step, submitted);
    setValidation(error);
    if (error) return;
    running.current = true;
    setSaving(true);
    try {
      await Promise.resolve(context.onSave(step, submitted));
      if (mounted.current && advance) nextAfterSave.current?.();
    } catch (error) {
      if (mounted.current) setValidation(`No se pudo confirmar el guardado. El borrador se conserva. ${errorMessage(error)}`);
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <View style={checklistStyles.screen}>
      <ScrollView ref={scroll} testID="checklist-question-scroll" style={checklistStyles.scroll} contentContainerStyle={checklistStyles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={false}>
      <View style={checklistStyles.question}>
        <Text accessibilityRole="header" style={checklistStyles.questionHeading}>{plainText(step.title) || "Paso sin título"}</Text>
        <View style={checklistStyles.stepMeta}>
          {isChecklistStepProgressRelevant(step) ? <Badge label="Respuesta obligatoria" tone="warning" /> : null}
          {step.isFilesRequired ? <Badge label="Evidencia obligatoria" tone="warning" /> : null}
          {pendingFiles > 0 ? <Badge label={`${pendingFiles} archivos sin confirmar`} tone="warning" /> : null}
          {step.tag.trim() ? <Badge label={plainText(step.tag)} /> : null}
          {queued ? <Badge label="En cola · sin confirmar" tone="warning" /> : dirty ? <Badge label="Borrador · no enviado" tone="warning" /> : <Badge {...status} />}
        </View>
        {plainText(step.description) ? <BodyText>{plainText(step.description)}</BodyText> : null}
      </View>
      {validation ? <Notice message={validation} tone="error" /> : null}
      <ResponseInput step={step} answer={answer} disabled={disabled} onChange={change} />
      {step.type === "validation" && answer.responseValue === false ? <Notice message="«No» es una respuesta válida, pero no una validación exitosa. El progreso mide respuestas y evidencia confirmadas; no significa aprobación." tone="warning" /> : null}
      {answer.responseValue === "not_applicable" ? <BodyText>«No aplica» registra una respuesta, sin afirmar aprobación.</BodyText> : null}
      {step.type === "approval" && answer.responseValue === "rejected" ? <Notice message="La respuesta es «Rechazado». Responder este paso no equivale a aprobarlo." tone="warning" /> : null}
      <View style={checklistStyles.actions}>
        {!showComment && !answer.comment?.trim() && !context.readOnly ? <Button title="Comentario" accessibilityLabel="Añadir comentario del paso" icon="chatbubble-outline" variant="ghost" style={checklistStyles.compactButton} disabled={disabled} onPress={() => setShowComment(true)} /> : null}
        <Button title={context.readOnly ? "Ver archivos" : "Archivos"} accessibilityLabel={context.readOnly ? "Consultar evidencias del paso" : "Adjuntar al paso"} icon="attach-outline" variant="ghost" style={checklistStyles.compactButton} disabled={!context.readOnly && disabled} onPress={() => context.onEvidence(id)} />
      </View>
      {showComment || answer.comment?.trim() ? <Field label="Comentario del paso (opcional)" value={answer.comment ?? ""} onChangeText={(comment) => change(normalizeChecklistAnswer(step, { ...answer, comment }))} editable={!disabled} multiline maxLength={10000} style={checklistStyles.comment} placeholder="Observaciones o motivo de la respuesta…" hint={!isChecklistStepProgressRelevant(step) ? "Puedes guardar solo el comentario, sin seleccionar una respuesta." : undefined} /> : null}
      {step.isFilesRequired || step.attachments.length > 0 || pendingFiles > 0 ? <View style={styles.tight}>
        <Text style={styles.label}>Archivos · {step.attachments.length} confirmados{step.isFilesRequired ? " · requeridos para entregar" : ""}</Text>
        {step.attachments.length > 0 ? <AttachmentList files={step.attachments} /> : null}
        {pendingFiles > 0 ? <BodyText>{pendingFiles} archivos pendientes en el dispositivo; todavía no cuentan como evidencia confirmada.</BodyText> : null}
      </View> : null}
      {confirmed ? <Button title={showConfirmed ? "Ocultar respuesta confirmada" : "Ver respuesta confirmada"} variant="ghost" style={checklistStyles.compactButton} onPress={() => setShowConfirmed(!showConfirmed)} /> : null}
      {showConfirmed && confirmed ? <View style={checklistStyles.snapshot}>
        <Text style={styles.label}>{context.mode === "demo" ? "Última respuesta guardada · demostración local" : "Última respuesta confirmada por Qualitzer"}</Text>
        <Text selectable style={styles.caption}>{confirmed ? checklistAnswerLabel(step, confirmedAnswer) : "No hay una respuesta guardada en la información recibida."}</Text>
        {confirmedAnswer.comment?.trim() ? <Text selectable style={styles.caption}>Comentario: {confirmedAnswer.comment}</Text> : null}
        {entry?.saved === true ? <Text style={styles.caption}>Envío confirmado. El progreso se calcula con la ficha recibida, no con el borrador.</Text> : null}
      </View> : null}
      {context.readOnly ? <Notice message={dirty ? "Solo lectura. Se muestra la última información confirmada; el borrador pendiente se conserva sin enviarlo ni sobrescribirlo." : "Solo lectura. Las respuestas y los archivos recibidos siguen disponibles para consulta."} /> : null}
      {context.readOnly && dirty && entry ? <View style={styles.tight}>
        <Button title={showDraft ? "Ocultar borrador no enviado" : "Consultar borrador no enviado"} variant="ghost" onPress={() => setShowDraft(!showDraft)} />
        {showDraft ? <View style={checklistStyles.snapshot}><Text style={styles.label}>Borrador · no confirmado</Text><BodyText>{checklistAnswerLabel(step, entry.answer)}</BodyText>{entry.answer.comment ? <BodyText>{entry.answer.comment}</BodyText> : null}</View> : null}
      </View> : null}
      {!context.readOnly ? <View style={styles.tight}>
        {onNext && dirty && !queued ? <Button title="Guardar sin avanzar" accessibilityLabel="Guardar respuesta sin avanzar" variant="secondary" style={checklistStyles.compactButton} disabled={disabled || !supported} onPress={() => { void save(false); }} /> : null}
        {dirty && !queued ? <Button title="Descartar borrador de este paso" variant="ghost" style={checklistStyles.compactButton} disabled={disabled} onPress={() => { setValidation(null); context.onDiscard(step); }} /> : null}
        {queued ? <Notice message="Esta versión ya está registrada. Consulta su estado en el centro offline; no se volverá a enviar desde este botón. Puedes editar la respuesta para preparar un nuevo cambio." tone="warning" /> : null}
        {dirty && !queued ? <Text style={styles.caption}>Las flechas y el resumen no envían respuestas. Pulsa Guardar para enviarlas.</Text> : null}
      </View> : null}
      {notices}
      </ScrollView>
      <View style={checklistStyles.dock} testID="checklist-step-dock">
        <IconButton name="chevron-back-outline" label="Paso anterior sin guardar" disabled={!onPrevious || context.disabled || saving} onPress={() => onPrevious?.()} />
        {context.readOnly ? <Text style={checklistStyles.dockHint}>Solo lectura</Text> : <Button title={queued ? "En cola" : onNext ? "Guardar y seguir" : "Guardar respuesta"} accessibilityLabel={queued ? "Respuesta ya registrada en cola" : onNext ? "Guardar y siguiente" : "Guardar respuesta"} style={checklistStyles.dockSave} loading={saving || context.savingStep === id} disabled={disabled || !dirty || !supported || queued} onPress={() => { void save(Boolean(onNext)); }} />}
        <IconButton name="chevron-forward-outline" label="Paso siguiente sin guardar" disabled={!onNext || context.disabled || saving} onPress={() => onNext?.()} />
      </View>
    </View>
  );
}
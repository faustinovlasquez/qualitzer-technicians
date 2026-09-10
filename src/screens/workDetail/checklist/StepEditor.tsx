import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { checklistAnswerError, hasChecklistStepAnswer, isChecklistStepProgressRelevant, normalizeChecklistAnswer } from "../../../domain/checklistProgress";
import { answerFromStep, plainText } from "../../../domain/format";
import type { ChecklistStep, StepAnswer } from "../../../domain/models";
import { Badge, BodyText, Button, Field } from "../../../ui/components";
import type { ChecklistTabProps } from "../ChecklistTab";
import { AttachmentList, Notice } from "../DetailUi";
import { errorMessage } from "../detailRules";
import { styles } from "../detailStyles";
import { displayedAnswer } from "../useWorkDraft";
import { checklistAnswerLabel, checklistStepStatus } from "./checklistPresentation";
import { ResponseInput } from "./ResponseInput";
import { checklistStyles } from "./styles";

export function StepEditor({ step, number, total, context, onNext }: { step: ChecklistStep; number: number; total: number; context: ChecklistTabProps; onNext?: () => void }) {
  const [validation, setValidation] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
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
  const pendingFiles = context.draft.photos.filter((item) => item.stepId === id && !item.uploaded).length;
  const disabled = context.disabled || context.readOnly || saving || context.savingStep !== null;
  const status = checklistStepStatus(step);
  const supported = ["validation", "text", "number", "select", "multiselect", "approval"].includes(step.type);

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
    <View style={styles.stack}>
      <View style={styles.tight}>
        <Text style={styles.overline}>PASO {number} DE {total}</Text>
        <Text accessibilityRole="header" style={styles.heading}>{plainText(step.title) || "Paso sin título"}</Text>
        <View style={styles.row}>
          <Badge label={isChecklistStepProgressRelevant(step) ? "Respuesta obligatoria" : step.type === "text" ? "Informativo" : "Respuesta opcional"} tone={isChecklistStepProgressRelevant(step) ? "warning" : "neutral"} />
          {step.isFilesRequired ? <Badge label="Evidencia obligatoria para entregar" tone="warning" /> : null}
          {step.tag.trim() ? <Badge label={plainText(step.tag)} /> : null}
          {queued ? <Badge label="Registrada en cola · consultar estado" tone="warning" /> : dirty ? <Badge label="Borrador · no enviado" tone="warning" /> : <Badge {...status} />}
        </View>
        {plainText(step.description) ? <BodyText>{plainText(step.description)}</BodyText> : null}
      </View>
      <View style={checklistStyles.snapshot}>
        <Text style={styles.label}>{context.mode === "demo" ? "Última respuesta guardada · demostración local" : "Última respuesta confirmada por Qualitzer"}</Text>
        <Text selectable style={styles.caption}>{confirmed ? checklistAnswerLabel(step, confirmedAnswer) : "No hay una respuesta guardada en la información recibida."}</Text>
        {confirmedAnswer.comment?.trim() ? <Text selectable style={styles.caption}>Comentario: {confirmedAnswer.comment}</Text> : null}
        {entry?.saved === true ? <Text style={styles.caption}>Envío confirmado. El progreso se calcula con la ficha recibida, no con el borrador.</Text> : null}
      </View>
      {context.readOnly ? <Notice message={dirty ? "Solo lectura. Se muestra la última información confirmada; el borrador pendiente se conserva sin enviarlo ni sobrescribirlo." : "Solo lectura. Las respuestas y los archivos recibidos siguen disponibles para consulta."} /> : null}
      {context.readOnly && dirty && entry ? <View style={styles.tight}>
        <Button title={showDraft ? "Ocultar borrador no enviado" : "Consultar borrador no enviado"} variant="ghost" onPress={() => setShowDraft(!showDraft)} />
        {showDraft ? <View style={checklistStyles.snapshot}><Text style={styles.label}>Borrador · no confirmado</Text><BodyText>{checklistAnswerLabel(step, entry.answer)}</BodyText>{entry.answer.comment ? <BodyText>{entry.answer.comment}</BodyText> : null}</View> : null}
      </View> : null}
      <ResponseInput step={step} answer={answer} disabled={disabled} onChange={change} />
      {step.type === "validation" && answer.responseValue === false ? <Notice message="«No» es una respuesta válida, pero no una validación exitosa. El progreso mide respuestas y evidencia confirmadas; no significa aprobación." tone="warning" /> : null}
      {answer.responseValue === "not_applicable" ? <BodyText>«No aplica» registra una respuesta, sin afirmar aprobación.</BodyText> : null}
      {step.type === "approval" && answer.responseValue === "rejected" ? <Notice message="La respuesta es «Rechazado». Responder este paso no equivale a aprobarlo." tone="warning" /> : null}
      <Field label="Comentario del paso (opcional)" value={answer.comment ?? ""} onChangeText={(comment) => change(normalizeChecklistAnswer(step, { ...answer, comment }))} editable={!disabled} multiline maxLength={10000} style={checklistStyles.comment} placeholder="Observaciones o motivo de la respuesta…" hint={!isChecklistStepProgressRelevant(step) ? "Puedes guardar solo el comentario, sin seleccionar una respuesta." : undefined} />
      <View style={styles.tight}>
        <Text style={styles.label}>Archivos de este paso · {step.attachments.length} confirmados</Text>
        <AttachmentList files={step.attachments} />
        {pendingFiles > 0 ? <BodyText>{pendingFiles} archivos pendientes en el dispositivo; todavía no cuentan como evidencia confirmada.</BodyText> : null}
        <Button title={context.readOnly ? "Consultar evidencias del paso" : "Adjuntar al paso"} icon="attach-outline" variant="secondary" disabled={!context.readOnly && disabled} onPress={() => context.onEvidence(id)} />
      </View>
      {validation ? <Notice message={validation} tone="error" /> : null}
      {!context.readOnly ? <View style={styles.tight}>
        {onNext ? <Button title="Guardar y siguiente" icon="save-outline" loading={saving || context.savingStep === id} disabled={disabled || !dirty || !supported || queued} onPress={() => { void save(true); }} /> : null}
        <Button title={queued ? "Respuesta ya registrada en cola" : "Guardar respuesta"} icon="save-outline" variant={onNext ? "secondary" : "primary"} loading={!onNext && (saving || context.savingStep === id)} disabled={disabled || !dirty || !supported || queued} onPress={() => { void save(false); }} />
        {dirty && !queued ? <Button title="Descartar borrador de este paso" variant="ghost" disabled={disabled} onPress={() => { setValidation(null); context.onDiscard(step); }} /> : null}
        {queued ? <Notice message="Esta versión ya está registrada. Consulta su estado en el centro offline; no se volverá a enviar desde este botón. Puedes editar la respuesta para preparar un nuevo cambio." tone="warning" /> : null}
        <BodyText>Anterior, Siguiente y Resumen solo navegan. Los cambios quedan en borrador hasta que pulses Guardar.</BodyText>
      </View> : null}
      {onNext ? <Button title={dirty && !queued && !context.readOnly ? "Siguiente sin guardar" : "Siguiente paso"} icon="chevron-forward-outline" variant="ghost" onPress={onNext} /> : null}
    </View>
  );
}
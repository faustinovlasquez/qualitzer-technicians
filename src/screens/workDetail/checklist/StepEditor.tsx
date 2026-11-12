import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { checklistAnswerError, isChecklistStepProgressRelevant, normalizeChecklistAnswer } from "../../../domain/checklistProgress";
import { answerFromStep, plainText } from "../../../domain/format";
import type { ChecklistStep, StepAnswer } from "../../../domain/models";
import { BodyText, Button, Field, IconButton, type BadgeTone } from "../../../ui/components";
import { palette } from "../../../ui/theme";
import type { ChecklistTabProps } from "../ChecklistTab";
import { Notice } from "../DetailUi";
import { EvidenceCollage } from "./EvidenceCollage";
import { userActionError as errorMessage } from "../../offline/syncUserPresentation";
import { styles } from "../detailStyles";
import { displayedAnswer } from "../useWorkDraft";
import { checklistAnswerLabel, checklistStepStatus } from "./checklistPresentation";
import { ResponseInput } from "./ResponseInput";
import { checklistStyles } from "./styles";

/** Escribir el comentario no dispara el envío automático: se guarda con las flechas o el botón Guardar. */
function answerChangesOnlyComment(previous: StepAnswer, next: StepAnswer): boolean {
  return (previous.comment ?? "") !== (next.comment ?? "") && JSON.stringify({ ...previous, comment: "" }) === JSON.stringify({ ...next, comment: "" });
}

function StepTag({ label, color }: { label: string; color: string }) {
  return <View style={checklistStyles.tag}>
    <View style={[checklistStyles.tagDot, { backgroundColor: color }]} />
    <Text style={[checklistStyles.tagText, { color }]}>{label}</Text>
  </View>;
}

function StepAction({ icon, title, subtitle, label, disabled, divided, onPress }: { icon: ComponentProps<typeof Ionicons>["name"]; title: string; subtitle: string; label: string; disabled: boolean; divided?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [checklistStyles.actionRow, divided && checklistStyles.actionDivider, pressed && checklistStyles.pressed, disabled && checklistStyles.disabledRow]}>
    <View style={checklistStyles.actionIcon}><Ionicons name={icon} size={20} color={palette.primary} accessible={false} /></View>
    <View style={checklistStyles.actionText}>
      <Text style={checklistStyles.actionTitle}>{title}</Text>
      <Text numberOfLines={1} style={checklistStyles.actionSubtitle}>{subtitle}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={palette.textMuted} accessible={false} />
  </Pressable>;
}

function tagColor(tone: BadgeTone): string {
  switch (tone) {
    case "warning": return palette.amber;
    case "info": return palette.info;
    case "success": return palette.success;
    case "danger": return palette.danger;
    case "teal": return palette.primary;
    case "neutral": return palette.textSecondary;
  }
}

export function StepEditor({ step, context, onPrevious, onNext, onFinish, notices }: { step: ChecklistStep; context: ChecklistTabProps; onPrevious?: () => void; onNext?: () => void; onFinish?: () => void; notices?: ReactNode }) {
  const [validation, setValidation] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  /** Fila de envíos de este paso y la última respuesta enviada (para no repetirla). */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const submittedKey = useRef<string | null>(null);
  const nextAfterSave = useRef(onNext);
  nextAfterSave.current = onNext;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const id = String(step.stepId);
  const entry = context.draft.answers[id];
  const dirty = entry?.saved === false;
  const confirmedAnswer = entry?.saved === true ? displayedAnswer(step, entry) : answerFromStep(step);
  const answer = context.readOnly ? confirmedAnswer : displayedAnswer(step, entry);
  const queued = context.isAnswerQueued?.(step, answer) === true;
  const pendingSave = dirty && !queued;
  const confirmedFiles = step.attachments.filter((file) => !String(file.id).startsWith("local-")).length;
  const title = plainText(step.title) || "Paso sin título";
  const description = plainText(step.description);
  const pendingFiles = context.draft.photos.filter((item) => item.stepId === id && !item.uploaded).length + (context.pendingEvidenceCount?.(id) ?? 0);
  // Guardar no deshabilita el paso: se puede seguir eligiendo, comentando y avanzando mientras se anota la respuesta.
  const disabled = context.disabled || context.readOnly;
  const savingHere = saving || context.savingStep === id;
  const status = checklistStepStatus(step);
  const supported = ["validation", "text", "number", "select", "multiselect", "approval"].includes(step.type);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); submittedKey.current = null; }, [step.stepId]);
  useEffect(() => { if (validation) scroll.current?.scrollTo({ y: 0, animated: false }); }, [validation]);

  // Guardado automático: las respuestas de selección se envían al elegirlas; la selección múltiple, al dejar de marcar.
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); }, [step.stepId]);
  const autoSaved = !context.readOnly && supported && ["validation", "select", "approval", "multiselect"].includes(step.type);

  function change(next: StepAnswer): void {
    setValidation(null);
    context.onChange(step, next);
    if (!autoSaved || answerChangesOnlyComment(answer, next)) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { autoSaveTimer.current = null; void persist(next, undefined, true); }, step.type === "multiselect" ? 900 : 0);
  }

  /**
   * Envía la respuesta del paso. En el guardado automático un error de validación no se muestra (aún se está respondiendo)
   * y no se marca el paso como "guardando": la pantalla sigue disponible. Los envíos van en fila y una misma respuesta
   * que ya se está enviando no se repite.
   */
  async function persist(value: StepAnswer, after?: () => void, automatic = false): Promise<boolean> {
    if (disabled || queued) return false;
    // Un segundo toque de "Guardar y seguir" mientras se guarda se ignora (no avanza antes de que quede protegida).
    if (!automatic && running.current) return false;
    const submitted = normalizeChecklistAnswer(step, value);
    const error = checklistAnswerError(step, submitted, { allowMissingFiles: context.allowAnswerWithoutFiles });
    if (error) { if (!automatic) setValidation(error); return false; }
    const key = JSON.stringify(submitted);
    if (submittedKey.current === key) {
      // Esta misma respuesta ya se está enviando (o se envió): no se repite ni se espera; se avanza de inmediato.
      if (mounted.current) after?.();
      return true;
    }
    submittedKey.current = key;
    if (!automatic) { running.current = true; setSaving(true); }
    const run = chain.current.then(() => Promise.resolve(context.onSave(step, submitted)));
    chain.current = run.catch(() => undefined);
    try {
      await run;
      if (mounted.current) after?.();
      return true;
    } catch (error) {
      if (submittedKey.current === key) submittedKey.current = null;
      if (mounted.current) setValidation(`No se pudo confirmar el guardado. El borrador se conserva. ${errorMessage(error)}`);
      return false;
    } finally {
      if (!automatic) { running.current = false; if (mounted.current) setSaving(false); }
    }
  }

  async function save(advance: boolean): Promise<void> {
    if (!dirty) return;
    await persist(answer, advance ? () => nextAfterSave.current?.() : undefined);
  }

  /** Las flechas guardan lo pendiente del paso antes de moverse; si no se puede enviar, el borrador queda en el teléfono. */
  async function move(target?: () => void): Promise<void> {
    if (!target) return;
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    if (!context.readOnly && dirty && supported && !queued && !disabled && !running.current) {
      const submitted = normalizeChecklistAnswer(step, answer);
      if (!checklistAnswerError(step, submitted, { allowMissingFiles: context.allowAnswerWithoutFiles })) { await persist(answer, target); return; }
    }
    if (mounted.current && !running.current) target();
  }

  return (
    <View style={checklistStyles.dialogBody}>
      <ScrollView ref={scroll} testID="checklist-question-scroll" style={checklistStyles.scroll} contentContainerStyle={checklistStyles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={false}>
      {validation ? <Notice message={validation} tone="error" /> : null}
      <View style={checklistStyles.section}>
        <View style={checklistStyles.question}>
          <Text accessibilityRole="header" style={checklistStyles.questionHeading}>{title}</Text>
          {/* Muchas plantillas repiten el título como descripción: no se muestra dos veces. */}
          {description && description !== title ? <Text style={checklistStyles.questionDescription}>{description}</Text> : null}
          <View style={checklistStyles.stepMeta}>
            {isChecklistStepProgressRelevant(step) ? <StepTag label="Respuesta obligatoria" color={tagColor("warning")} /> : null}
            {step.isFilesRequired ? <StepTag label="Evidencia obligatoria" color={tagColor("warning")} /> : null}
            {pendingFiles > 0 ? <StepTag label={`${pendingFiles} archivos sin confirmar`} color={tagColor("warning")} /> : null}
            {step.tag.trim() ? <StepTag label={plainText(step.tag)} color={tagColor("neutral")} /> : null}
            {savingHere ? <StepTag label="Guardando…" color={tagColor("info")} /> : queued ? <StepTag label="Respuesta registrada en el teléfono" color={tagColor("info")} /> : dirty ? <StepTag label="Borrador · no enviado" color={tagColor("warning")} /> : <StepTag label={status.label} color={tagColor(status.tone)} />}
          </View>
        </View>
        <ResponseInput step={step} answer={answer} disabled={disabled} onChange={change} />
      </View>
      {step.type === "validation" && answer.responseValue === false ? <Notice message="«No» es una respuesta válida, pero no una validación exitosa. El progreso mide respuestas y evidencia confirmadas; no significa aprobación." tone="warning" /> : null}
      {answer.responseValue === "not_applicable" ? <BodyText>«No aplica» registra una respuesta, sin afirmar aprobación.</BodyText> : null}
      {step.type === "approval" && answer.responseValue === "rejected" ? <Notice message="La respuesta es «Rechazado». Responder este paso no equivale a aprobarlo." tone="warning" /> : null}
      {context.renderStepFiles ? <View style={checklistStyles.section} testID="checklist-step-inline-files">{context.renderStepFiles(id)}</View> : null}
      <View style={checklistStyles.sectionFlush}>
        {context.renderStepFiles ? null : <><StepAction icon="camera-outline" title={context.readOnly ? "Ver archivos" : "Fotos y archivos"} subtitle={`${confirmedFiles === 1 ? "1 archivo" : `${confirmedFiles} archivos`}${pendingFiles > 0 ? ` · ${pendingFiles} por subir` : ""}${step.isFilesRequired ? " · Obligatorio" : " · Opcional"}`} label={context.readOnly ? "Consultar evidencias del paso" : "Adjuntar al paso"} disabled={!context.readOnly && disabled} onPress={() => context.onEvidence(id)} />
        {step.attachments.length > 0 ? <EvidenceCollage files={step.attachments} manageLabel={context.readOnly ? "Ver archivos" : "Administrar"} onManage={() => context.onEvidence(id)} /> : null}</>}
        {!showComment && !answer.comment?.trim() && !context.readOnly ? <StepAction divided icon="chatbubble-ellipses-outline" title="Comentario" subtitle="Agrega una observación" label="Añadir comentario del paso" disabled={disabled} onPress={() => setShowComment(true)} /> : null}
      </View>
      {showComment || answer.comment?.trim() ? <Field label="Comentario del paso (opcional)" value={answer.comment ?? ""} onChangeText={(comment) => change(normalizeChecklistAnswer(step, { ...answer, comment }))} editable={!disabled} multiline maxLength={10000} style={checklistStyles.comment} placeholder="Observaciones o motivo de la respuesta…" hint={!isChecklistStepProgressRelevant(step) ? "Puedes guardar solo el comentario, sin seleccionar una respuesta." : undefined} /> : null}
      {context.readOnly ? <Notice message={dirty ? "Solo lectura. Se muestra la última información confirmada; el borrador pendiente se conserva sin enviarlo ni sobrescribirlo." : "Solo lectura. Las respuestas y los archivos recibidos siguen disponibles para consulta."} /> : null}
      {context.readOnly && dirty && entry ? <View style={styles.tight}>
        <Button title={showDraft ? "Ocultar borrador no enviado" : "Consultar borrador no enviado"} variant="ghost" onPress={() => setShowDraft(!showDraft)} />
        {showDraft ? <View style={checklistStyles.snapshot}><Text style={styles.label}>Borrador · no confirmado</Text><BodyText>{checklistAnswerLabel(step, entry.answer)}</BodyText>{entry.answer.comment ? <BodyText>{entry.answer.comment}</BodyText> : null}</View> : null}
      </View> : null}
      {!context.readOnly ? <View style={styles.tight}>
        {onNext && dirty && !queued ? <Button title="Guardar sin avanzar" accessibilityLabel="Guardar respuesta sin avanzar" variant="secondary" style={checklistStyles.compactButton} disabled={disabled || !supported} onPress={() => { void save(false); }} /> : null}
        {dirty && !queued ? <Button title="Descartar borrador de este paso" variant="ghost" style={checklistStyles.compactButton} disabled={disabled} onPress={() => { setValidation(null); context.onDiscard(step); }} /> : null}
        {dirty && !queued ? <Text style={styles.caption}>{autoSaved ? "La respuesta se envía sola al elegirla." : "Las flechas guardan esta respuesta al cambiar de paso; también puedes pulsar Guardar."}</Text> : null}
      </View> : null}
      {notices}
      </ScrollView>
      <View style={checklistStyles.dock} testID="checklist-step-dock">
        <IconButton name="chevron-back-outline" label="Guardar y paso anterior" disabled={!onPrevious || context.disabled || saving} onPress={() => { void move(onPrevious); }} />
        {context.readOnly ? <Text style={checklistStyles.dockHint}>Solo lectura</Text> : pendingSave
          ? <Button title={onNext ? "Guardar y seguir" : "Guardar respuesta"} accessibilityLabel={onNext ? "Guardar y siguiente" : "Guardar respuesta"} style={checklistStyles.dockSave} loading={saving} disabled={disabled || saving || !supported} onPress={() => { void save(Boolean(onNext)); }} />
          : <Button title={onNext ? "Siguiente" : "Terminar"} icon={onNext ? undefined : "checkmark-outline"} style={checklistStyles.dockSave} loading={saving} disabled={context.disabled || saving} onPress={() => { if (onNext) void move(onNext); else onFinish?.(); }} />}
        <IconButton name="chevron-forward-outline" label="Guardar y paso siguiente" disabled={!onNext || context.disabled || saving} onPress={() => { void move(onNext); }} />
      </View>
    </View>
  );
}
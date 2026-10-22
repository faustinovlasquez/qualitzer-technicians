import { useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal } from "../../security/DeviceSecurityContext";
import { IconButton } from "../../ui/components";
import { palette } from "../../ui/theme";
import type { ChecklistStep, StepAnswer } from "../../domain/models";
import type { InspectionChecklist } from "../../domain/workshopInspection";
import { ChecklistTab } from "../../screens/workDetail/ChecklistTab";
import { answerSignature } from "../../screens/workDetail/detailRules";
import type { WorkDraft } from "../../screens/workDetail/useWorkDraft";
import { OptionRow, PickerSheet } from "../intake/IntakePickers";
import { inspectionChecklists, inspectionResponse, inspectionStepOf } from "./inspectionChecklistAdapter";

/**
 * Completar una lista de la inspección con la misma pantalla de checklist de los trabajos: un paso a la vez, resumen de
 * pasos, guardado automático al elegir y "Guardar y seguir". Las fotos del paso se suben con "Archivos".
 */
export function InspectionChecklistScreen({ inspectionId, checklists, checklistId, mode, onSave, onAddPhoto, onClose }: {
  inspectionId: number; checklists: InspectionChecklist[]; checklistId: number; mode: "live" | "demo";
  /** Guarda la respuesta (valor ya en el formato de la web) y recarga la inspección. */
  onSave: (checklistId: number, checklistStepId: number, responseValue: string | null, comment: string | null) => Promise<void>;
  /** Foto para la pregunta ya respondida (`stepId` es la respuesta guardada). Devuelve si quedó subida. */
  onAddPhoto: (stepId: number, source: "camera" | "library") => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<WorkDraft>({ version: 1, report: "", savedReport: null, answers: {}, photos: [] });
  const [evidence, setEvidence] = useState<{ stepId: number | null; title: string } | null>(null);
  const [savingStep, setSavingStep] = useState<string | null>(null);
  const backHandler = useRef<((home?: boolean) => boolean) | null>(null);
  const work = useMemo(() => ({ id: `inspection-${inspectionId}`, checklists: inspectionChecklists(checklists) }), [inspectionId, checklists]);
  const back = () => { if (!backHandler.current?.()) onClose(); };

  function change(step: ChecklistStep, answer: StepAnswer) {
    setDraft((current) => ({ ...current, answers: { ...current.answers, [String(step.stepId)]: { answer, saved: false, baseline: answerSignature(step) } } }));
  }
  function discard(step: ChecklistStep) {
    setDraft((current) => { const answers = { ...current.answers }; delete answers[String(step.stepId)]; return { ...current, answers }; });
  }
  async function save(step: ChecklistStep, answer: StepAnswer) {
    const found = inspectionStepOf(checklists, step.stepId);
    if (!found) throw new Error("Esa pregunta ya no está en la lista. Vuelve a abrir la inspección.");
    const responseValue = inspectionResponse(found.step, answer);
    setSavingStep(String(step.stepId));
    try {
      await onSave(found.checklist.checklistId, found.step.checklistStepId, responseValue, answer.comment?.trim() ? answer.comment.trim().slice(0, 2000) : null);
      // Ya guardada: se muestra lo que confirmó el servidor (la inspección recargada).
      discard(step);
    } finally { setSavingStep(null); }
  }

  return <PrivateModal visible animationType="slide" onRequestClose={back}>
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <IconButton name="close" label="Cerrar la lista" onPress={onClose} />
        <View style={styles.barText}>
          <Text style={styles.barTitle}>Lista de revisión</Text>
          <Text style={styles.barHint}>Se guarda a medida que respondes</Text>
        </View>
        <Ionicons name="cloud-done-outline" size={20} color={palette.success} accessible={false} />
      </View>
      <ChecklistTab work={work} draft={draft} maintenance={false} disabled={false} readOnly={false} mode={mode} savingStep={savingStep}
        storageKey={`workshop-inspection-${inspectionId}`} initialChecklistId={checklistId} backHandler={backHandler} allowAnswerWithoutFiles
        labels={{ catalogTitle: "Listas de la inspección", catalogSubtitle: "Elige una lista para responder.", progressNote: "El avance cuenta las respuestas ya guardadas en Qualitzer." }}
        onChange={change} onDiscard={discard} onSave={save}
        onEvidence={(stepId) => {
          const found = stepId === undefined ? null : inspectionStepOf(checklists, stepId);
          setEvidence({ stepId: found?.step.answer?.stepId ?? null, title: found?.step.title ?? "Pregunta" });
        }} />
      {evidence ? <PickerSheet title={`Foto: ${evidence.title}`} onClose={() => setEvidence(null)}>
        {evidence.stepId === null ? <Text style={styles.hint}>Primero responde la pregunta; después puedes agregarle fotos.</Text> : <>
          <OptionRow title="Tomar foto" subtitle="Con la cámara del teléfono" selected={false} leading={<Ionicons name="camera" size={22} color={palette.primary} />}
            onPress={() => { const stepId = evidence.stepId!; setEvidence(null); void onAddPhoto(stepId, "camera"); }} />
          <OptionRow title="Elegir de la galería" selected={false} leading={<Ionicons name="images-outline" size={22} color={palette.primary} />}
            onPress={() => { const stepId = evidence.stepId!; setEvidence(null); void onAddPhoto(stepId, "library"); }} />
        </>}
      </PickerSheet> : null}
    </SafeAreaView>
  </PrivateModal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  barText: { flex: 1, minWidth: 0 },
  barTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  barHint: { fontSize: 12, color: palette.textSecondary },
  hint: { fontSize: 13, color: palette.textSecondary }
});

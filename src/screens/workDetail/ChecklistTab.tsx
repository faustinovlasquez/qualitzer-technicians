import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { plainText } from "../../domain/format";
import type { AssignmentWork, Checklist, ChecklistStep, StepAnswer } from "../../domain/models";
import { Badge, BodyText, Button, Card, EmptyState, SectionTitle } from "../../ui/components";
import { ChecklistCatalog, ChecklistProgress } from "./checklist/ChecklistCatalog";
import { ChecklistOverview } from "./checklist/ChecklistOverview";
import { StepEditor } from "./checklist/StepEditor";
import { checklistStyles } from "./checklist/styles";
import { useChecklistNavigation } from "./checklist/useChecklistNavigation";
import { Notice } from "./DetailUi";
import { errorMessage } from "./detailRules";
import { styles } from "./detailStyles";
import type { WorkDraft } from "./useWorkDraft";

export interface ChecklistTabProps {
  work: AssignmentWork;
  draft: WorkDraft;
  maintenance: boolean;
  disabled: boolean;
  readOnly: boolean;
  mode: "live" | "demo";
  savingStep: string | null;
  onChange: (step: ChecklistStep, answer: StepAnswer) => void;
  onDiscard: (step: ChecklistStep) => void;
  onSave: (step: ChecklistStep, answer: StepAnswer) => Promise<void>;
  onEvidence: (stepId?: string) => void;
  storageKey: string;
  onRefresh?: () => Promise<void>;
  isAnswerQueued?: (step: ChecklistStep, answer: StepAnswer) => boolean;
}

export function ChecklistTab(props: ChecklistTabProps) {
  const scopeKey = JSON.stringify([props.storageKey, props.mode, props.maintenance, props.work.id]);
  return <ChecklistContent key={scopeKey} {...props} scopeKey={scopeKey} />;
}

function ChecklistContent(props: ChecklistTabProps & { scopeKey: string }) {
  const navigation = useChecklistNavigation(props.scopeKey);
  const [overview, setOverview] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshingRef = useRef(false);
  const checklist = props.work.checklists.find((item) => item.checklistId === navigation.selection.checklistId);
  const steps = useMemo(() => [...(checklist?.steps ?? [])].sort((left, right) => left.order - right.order), [checklist?.steps]);
  const stepId = checklist ? navigation.selection.stepIds[String(checklist.checklistId)] : undefined;
  const index = steps.findIndex((step) => String(step.stepId) === stepId);
  const step = steps[index];

  function open(item: Checklist): void {
    const firstStep = [...item.steps].sort((left, right) => left.order - right.order)[0];
    setOverview(false);
    navigation.open(item.checklistId, firstStep ? String(firstStep.stepId) : undefined);
  }

  function jump(id: string): void {
    if (!checklist) return;
    setOverview(false);
    navigation.jump(checklist.checklistId, id);
  }

  async function refresh(): Promise<void> {
    if (!props.onRefresh || refreshingRef.current || props.disabled) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshError(null);
    try { await props.onRefresh(); }
    catch (error) { setRefreshError(`No se pudo actualizar la información confirmada. ${errorMessage(error)}`); }
    finally { refreshingRef.current = false; setRefreshing(false); }
  }

  if (props.work.checklists.length === 0) return <Card><EmptyState title="Sin checklists disponibles" message="No se recibieron listas de verificación en esta ficha. Si esperabas un checklist, actualiza la asignación; los borradores anteriores no se eliminan." icon="list-outline" /></Card>;
  return (
    <View style={styles.stack}>
      <Notice message={props.mode === "demo" ? "Demostración local. El progreso usa las respuestas guardadas de la ficha demo, no los borradores." : "Progreso confirmado por Qualitzer. Los borradores no cuentan; una respuesta confirmada no significa aprobación."} />
      {navigation.error ? <Notice message={navigation.error} tone="warning" /> : null}
      {refreshError ? <Notice message={refreshError} tone="error" onDismiss={() => setRefreshError(null)} /> : null}
      {props.onRefresh ? <Button title="Actualizar respuestas y archivos" icon="refresh-outline" variant="ghost" loading={refreshing} disabled={props.disabled} onPress={() => { void refresh(); }} /> : null}
      {!checklist ? <View style={styles.stack}>
        <SectionTitle title="Checklists del trabajo" subtitle="Selecciona una lista para responder un solo paso a la vez." />
        {navigation.selection.checklistId !== null ? <Notice message="El checklist seleccionado ya no aparece en la ficha recibida. No se ha elegido otro ni eliminado sus borradores." tone="warning" /> : null}
        <ChecklistCatalog checklists={props.work.checklists} draft={props.draft} onOpen={open} />
      </View> : <Card style={checklistStyles.panel}>
        <Button title="Volver a los checklists" icon="arrow-back-outline" variant="ghost" onPress={() => { setOverview(false); navigation.catalog(); }} />
        <View style={styles.tight}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={checklistStyles.code}>{plainText(checklist.code) || "Sin código"}</Text>
          <SectionTitle title={plainText(checklist.name) || "Checklist sin nombre"} />
          <Badge label={checklist.required === true ? "Checklist obligatorio" : checklist.required === false ? "Complementario" : "Obligatoriedad no informada"} tone={checklist.required === true ? "warning" : "neutral"} />
          <ChecklistProgress checklist={checklist} />
        </View>
        {steps.length === 0 ? <EmptyState title="Sin pasos disponibles" message="No se recibieron pasos para este checklist. Actualiza la ficha o solicita revisar su configuración; no se presume completado." icon="list-outline" /> : <View style={styles.stack}>
          {step ? <View style={styles.tight}>
            <Text accessibilityLiveRegion="polite" style={styles.label}>Paso {index + 1} de {steps.length}</Text>
            <View style={checklistStyles.navigation}>
              <Button title="Anterior" icon="chevron-back-outline" variant="secondary" style={checklistStyles.navigationButton} disabled={index === 0} onPress={() => { const previous = steps[index - 1]; if (previous) jump(String(previous.stepId)); }} />
              <Button title="Siguiente" icon="chevron-forward-outline" variant="secondary" style={checklistStyles.navigationButton} disabled={index + 1 >= steps.length} onPress={() => { const next = steps[index + 1]; if (next) jump(String(next.stepId)); }} />
            </View>
            <Button title={overview ? "Volver al paso" : `Resumen · ${steps.length} pasos`} icon="grid-outline" variant="ghost" onPress={() => setOverview(!overview)} />
          </View> : <Notice message="El paso seleccionado ya no está en la ficha recibida. Su borrador no se ha eliminado. Elige un paso del resumen para continuar." tone="warning" />}
          <View style={styles.divider} />
          {overview || !step ? <ChecklistOverview key={checklist.checklistId} steps={steps} stepId={stepId} draft={props.draft} onJump={jump} /> : <StepEditor key={`${checklist.checklistId}:${step.stepId}`} step={step} number={index + 1} total={steps.length} context={props} onNext={index + 1 < steps.length ? () => { const next = steps[index + 1]; if (next) jump(String(next.stepId)); } : undefined} />}
        </View>}
        {props.readOnly ? <BodyText>Solo lectura. Puedes recorrer los pasos sin modificar la información guardada.</BodyText> : null}
      </Card>}
    </View>
  );
}
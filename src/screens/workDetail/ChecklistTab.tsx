import { useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { checklistResumeTarget } from "../../domain/checklistResume";
import { plainText } from "../../domain/format";
import type { AssignmentWork, Checklist, ChecklistStep, StepAnswer } from "../../domain/models";
import { Badge, BodyText, Button, EmptyState, IconButton, SectionTitle } from "../../ui/components";
import { ChecklistCatalog, ChecklistProgress } from "./checklist/ChecklistCatalog";
import { ChecklistOverview } from "./checklist/ChecklistOverview";
import { StepEditor } from "./checklist/StepEditor";
import { checklistStyles } from "./checklist/styles";
import { useChecklistNavigation } from "./checklist/useChecklistNavigation";
import { Notice } from "./DetailUi";
import { errorMessage } from "./detailRules";
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
  pendingEvidenceCount?: (stepId: string) => number;
  catalogHeader?: ReactNode;
  notices?: ReactNode;
}

export function ChecklistTab(props: ChecklistTabProps) {
  const scopeKey = JSON.stringify([props.storageKey, props.mode, props.maintenance, props.work.id]);
  return <ChecklistContent key={scopeKey} {...props} scopeKey={scopeKey} />;
}

function ChecklistContent(props: ChecklistTabProps & { scopeKey: string }) {
  const navigation = useChecklistNavigation(props.scopeKey, props.work.checklists);
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
    setOverview(false);
    navigation.open(item);
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

  const notices = <>
    {navigation.error ? <Notice message={navigation.error} tone="warning" /> : null}
    {refreshError ? <Notice message={refreshError} tone="error" onDismiss={() => setRefreshError(null)} /> : null}
    {checklist && step && checklistResumeTarget({ ...checklist, steps: [step] }).reason === "evidence" ? <Notice message="La respuesta está registrada, pero falta evidencia confirmada para este paso. Abre Archivos para adjuntarla o revisar los archivos pendientes; no necesitas volver a responder." tone="warning" /> : null}
    {props.notices}
  </>;

  if (navigation.restoring) return <View style={checklistStyles.screen}><BodyText>Recuperando navegación del checklist…</BodyText></View>;

  if (!checklist) return <ScrollView style={checklistStyles.screen} contentContainerStyle={checklistStyles.scrollContent} keyboardShouldPersistTaps="handled">
    <SectionTitle title="Checklists del trabajo" subtitle="Selecciona una lista para responder." />
    {notices}
    {navigation.selection.checklistId !== null ? <Notice message="El checklist seleccionado ya no aparece en la ficha recibida. No se ha elegido otro ni eliminado sus borradores." tone="warning" /> : null}
    {props.work.checklists.length === 0 ? <EmptyState title="Sin checklists disponibles" message="No se recibieron listas de verificación en esta ficha. Si esperabas un checklist, actualiza la asignación; los borradores anteriores no se eliminan." icon="list-outline" /> : <ChecklistCatalog checklists={props.work.checklists} draft={props.draft} onOpen={open} />}
    {props.catalogHeader}
    <BodyText>{props.mode === "demo" ? "Demostración local. El progreso usa las respuestas guardadas de la ficha demo, no los borradores." : "Progreso confirmado por Qualitzer. Los borradores no cuentan; una respuesta confirmada no significa aprobación."}</BodyText>
    {props.onRefresh ? <Button title="Actualizar respuestas y archivos" icon="refresh-outline" variant="ghost" loading={refreshing} disabled={props.disabled} onPress={() => { void refresh(); }} /> : null}
  </ScrollView>;

  return (
    <View style={checklistStyles.screen} testID="checklist-workspace">
      <View style={checklistStyles.toolbar}>
        <View style={checklistStyles.toolbarRow}>
          <IconButton name="arrow-back-outline" label="Volver a los checklists" disabled={props.disabled} onPress={() => { setOverview(false); navigation.catalog(); }} />
          <View style={checklistStyles.toolbarTitle}>
            <Text accessibilityRole="header" numberOfLines={2} style={checklistStyles.title}>{plainText(checklist.name) || "Checklist sin nombre"}</Text>
            <Text accessibilityLiveRegion="polite" style={checklistStyles.progress}>{step ? `Paso ${index + 1} de ${steps.length}` : `${steps.length} pasos`}{checklist.required === true ? " · Obligatorio" : checklist.required == null ? " · Obligatoriedad no informada" : ""}{props.readOnly ? " · Solo lectura" : ""}</Text>
          </View>
          <IconButton name={overview ? "create-outline" : "grid-outline"} label={overview ? "Volver al paso" : "Resumen de pasos"} disabled={!step || props.disabled} onPress={() => setOverview(!overview)} />
        </View>
        <ChecklistProgress checklist={checklist} compact />
      </View>
      {overview || !step ? <ScrollView key={`overview:${checklist.checklistId}`} style={checklistStyles.scroll} contentContainerStyle={checklistStyles.scrollContent} keyboardShouldPersistTaps="handled">
        {steps.length === 0 ? <EmptyState title="Sin pasos disponibles" message="No se recibieron pasos para este checklist. Actualiza la ficha o solicita revisar su configuración; no se presume completado." icon="list-outline" /> : <>
          {!step && stepId !== undefined ? <Notice message="El paso seleccionado ya no está en la ficha recibida. Su borrador no se ha eliminado. Elige un paso del resumen para continuar." tone="warning" /> : null}
          {!step && stepId === undefined ? <Notice message={checklistResumeTarget(checklist).reason === "review" ? "No quedan pasos obligatorios pendientes en la ficha recibida. Puedes revisar o responder cualquier paso desde el resumen, incluidos los opcionales e informativos. Los borradores y envíos pendientes se conservan; esto no confirma la entrega del trabajo." : "La ficha recibida tiene pasos pendientes. Elige uno desde el resumen o vuelve a abrir el checklist para continuar por el primer pendiente. Los borradores se conservan."} /> : null}
          <ChecklistOverview key={checklist.checklistId} steps={steps} stepId={stepId} draft={props.draft} onJump={jump} />
        </>}
        {checklist.required !== false ? <Badge label={checklist.required === true ? "Checklist obligatorio" : "Obligatoriedad no informada"} tone={checklist.required === true ? "warning" : "neutral"} /> : null}
        {notices}
      </ScrollView> : <StepEditor key={`${checklist.checklistId}:${step.stepId}`} step={step} context={props} notices={notices}
        onPrevious={index > 0 ? () => jump(String(steps[index - 1].stepId)) : undefined}
        onNext={index + 1 < steps.length ? () => jump(String(steps[index + 1].stepId)) : undefined} />}
    </View>
  );
}
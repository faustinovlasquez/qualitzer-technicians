import { useRef, useState, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WorkDetailScreen } from "../../../src/screens/WorkDetailScreen";
import { OfflineStatusBar } from "../../../src/screens/offline/OfflineStatusBar";
import type { AssignmentGroup, AssignmentWork, Attachment, ChecklistStep, StepAnswer, WorkComment } from "../../../src/domain/models";
import { OfflineQueuedError, type OfflineSnapshot } from "../../../src/domain/offline";

type Scenario = "standard" | "readonly" | "empty" | "long";
interface FixtureApi {
  render: (scenario?: Scenario) => void;
  mode: "save" | "fail" | "queue" | "hold";
  release?: () => void;
  saves: { stepId: string; answer: StepAnswer }[];
  uploads: { stepId?: string; name: string; size?: number }[];
  deletes: string[];
  comments: string[];
  refreshes: number;
  offlineOpens: number;
}
declare global { interface Window { compactChecklist: FixtureApi; } }

function makeStep(index: number, long: boolean): ChecklistStep {
  const type = index === 1 ? "text" : index === 2 ? "number" : index === 3 ? "multiselect" : index === 4 ? "approval" : index === 5 ? "select" : "validation";
  return { stepId: 1001 + index, order: index + 1, title: index === 0 ? "¿El equipo está limpio?" : `Pregunta ${index + 1}`, description: long ? "Verifica el estado de cada componente antes de responder. ".repeat(30) : "", tag: "", type,
    options: type === "approval" ? [] : [{ value: "a", label: "Primera opción" }, { value: "b", label: "Segunda opción" }],
    isRequired: type !== "text", isFilesRequired: index === 6, isCompleted: null, selectValue: "", optionsSelectValue: [], responseValue: "", comment: "", executionStatus: null, attachments: [] };
}

function makeWork(scenario: Scenario): AssignmentWork {
  return { id: "11", workType: "productive", title: "Inspección previa al despacho del equipo", summary: "Contexto extenso que no debe preceder las preguntas", specialty: "Mecánica", status: scenario === "readonly" ? "delivered" : "in_progress", priority: "high",
    scheduledDate: "2026-09-11", scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: 60, executedMinutes: 20, elapsedSeconds: 1200,
    commentsCount: 0, filesCount: 0, isFilesRequired: false, checklistDone: 0, checklistTotal: 47, isOverdue: false, canExecute: true, canEditDefinition: true, missingRequiredInfo: [], materials: [], responsibles: [],
    checklists: scenario === "empty" ? [] : [{ checklistId: 10, name: "Checklist de despacho", code: "EQUIPMENT_DISPATCH_CHECKLIST_1", required: false, steps: Array.from({ length: 47 }, (_, index) => makeStep(index, scenario === "long")) }], plannedDates: ["2026-09-11"] };
}

const initialOffline: OfflineSnapshot = { online: true, preparing: false, syncing: false, authBlocked: false, pending: 0, conflicts: 0, lastSyncedAt: null, lastError: null, coverage: [], operations: [], connection: { status: "ready", networkConnected: true, foreground: true, checkedAt: null } };
let renderFixture: (node: ReactNode) => void;
let sequence = 0;
const api: FixtureApi = { render: () => {}, mode: "save", saves: [], uploads: [], deletes: [], comments: [], refreshes: 0, offlineOpens: 0 };
window.compactChecklist = api;

function Fixture({ scenario, identity }: { scenario: Scenario; identity: string }) {
  const [work, setWork] = useState(() => makeWork(scenario));
  const [offline, setOffline] = useState(initialOffline);
  const files = useRef(new Map<string, Attachment[]>());
  const comments = useRef<WorkComment[]>([]);
  const group: AssignmentGroup = { id: "direct-11", type: "direct_assignment", code: "TR-11", title: "Asignación de prueba", status: work.status, customerName: "Cliente ficticio", locationName: "Taller", locationAddress: null,
    scheduledDate: "2026-09-11", scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: 60, isOverdue: false, isResponsible: true, canManage: true, equipment: null, products: [], works: [work] };
  const refresh = async () => { api.refreshes++; };
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
    <WorkDetailScreen tenant={{ id: "isolated", name: "Empresa ficticia", portalOrigin: "https://example.invalid", environment: "development" }} branchName="Sucursal ficticia" group={group} work={work} generatedAt="2026-09-11T12:00:00Z" mode="live" range={{ startDate: "2026-09-11", endDate: "2026-09-11" }} busy={false} error={null} storageKey={identity} companyBranchId={1} initialTab="checklist" allowEditExecutionTime={false} offline={offline}
      connectionStatus={<OfflineStatusBar snapshot={offline} embedded onOpen={() => { api.offlineOpens++; }} onSync={refresh} />}
      onBack={() => {}} onRefresh={refresh} onStatus={async () => { throw new Error("STATUS_OUT_OF_FIXTURE_SCOPE"); }} onReport={async () => {}} onUpload={async () => {}}
      onSaveStep={async (stepId, answer) => {
        api.saves.push({ stepId, answer });
        if (api.mode === "fail") throw new Error("Fallo simulado de guardado");
        if (api.mode === "hold") await new Promise<void>((resolve) => { api.release = resolve; });
        if (api.mode === "queue") {
          const operationId = "11111111-1111-4111-8111-111111111111";
          setOffline({ ...initialOffline, online: false, pending: 1, connection: { status: "offline", networkConnected: false, foreground: true, checkedAt: null } });
          throw new OfflineQueuedError({ operationId, operationIds: [operationId], kind: "answer", date: "2026-09-11", ownsFiles: false });
        }
        setWork((current) => ({ ...current, checklists: current.checklists.map((list) => ({ ...list, steps: list.steps.map((step) => String(step.stepId) !== stepId ? step : {
          ...step, isCompleted: answer.isCompleted, executionStatus: answer.executionStatus, comment: answer.comment ?? "",
          responseValue: step.type === "text" || step.type === "number" ? String(answer.responseValue ?? "") : step.responseValue,
          selectValue: typeof answer.responseValue === "string" ? answer.responseValue : "", optionsSelectValue: Array.isArray(answer.responseValue) ? answer.responseValue : [],
        }) })) }));
      }}
      onLoadChecklistOptions={async () => ({ items: [], page: 0, pageSize: 20, hasMore: false })}
      onAttachChecklist={async () => { throw new Error("ASSOCIATION_OUT_OF_FIXTURE_SCOPE"); }}
      onLoadFiles={async () => files.current.get("work") ?? []} onLoadStepFiles={async (id) => files.current.get(id) ?? []}
      onUploadDocuments={async (selected, stepId) => {
        for (const file of selected) {
          api.uploads.push({ stepId, name: file.name, size: file.size });
          const attachment: Attachment = { id: 9000 + api.uploads.length, name: file.name, type: file.mimeType, url: `https://files.example.invalid/${file.name}` };
          files.current.set(stepId ?? "work", [...(files.current.get(stepId ?? "work") ?? []), attachment]);
          setWork((current) => ({ ...current, checklists: current.checklists.map((list) => ({ ...list, steps: list.steps.map((step) => String(step.stepId) === stepId ? { ...step, attachments: [...step.attachments, attachment] } : step) })) }));
        }
      }}
      onDeleteFile={async (id, stepId) => {
        api.deletes.push(id);
        files.current.set(stepId ?? "work", (files.current.get(stepId ?? "work") ?? []).filter((file) => String(file.id) !== id));
        setWork((current) => ({ ...current, checklists: current.checklists.map((list) => ({ ...list, steps: list.steps.map((step) => ({ ...step, attachments: step.attachments.filter((file) => String(file.id) !== id) })) })) }));
      }}
      onLoadComments={async () => ({ data: comments.current, totalPages: 1, totalRows: comments.current.length })}
      onAddComment={async (text) => { api.comments.push(text); comments.current.push({ id: String(comments.current.length + 1), text, createdAt: "2026-09-11T12:00:00Z", author: { id: 1, name: "Técnico ficticio" }, files: [] }); }}
    />
  </SafeAreaProvider>;
}

api.render = (scenario = "standard") => {
  const identity = `compact-checklist-isolated-${++sequence}`;
  api.mode = "save";
  renderFixture(<Fixture key={identity} identity={identity} scenario={scenario} />);
};

export function mountCompactChecklist(render: (node: ReactNode) => void): void {
  renderFixture = render;
  api.render();
}
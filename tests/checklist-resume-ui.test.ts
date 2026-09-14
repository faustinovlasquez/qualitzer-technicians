import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import * as jsx from "react/jsx-runtime";
import { z } from "zod";
import * as resume from "../src/domain/checklistResume";
import * as progress from "../src/domain/checklistProgress";
import * as format from "../src/domain/format";
import * as rules from "../src/screens/workDetail/detailRules";
import * as presentation from "../src/screens/workDetail/checklist/checklistPresentation";
import type { Checklist, ChecklistStep, StepAnswer } from "../src/domain/models";
import type { ChecklistTabProps } from "../src/screens/workDetail/ChecklistTab";
import { step, work } from "../server/tests/fixtures";
import { loadSource, reactFixture } from "./helpers/tenant-challenge";

type EditorProps = Parameters<typeof import("../src/screens/workDetail/checklist/StepEditor").StepEditor>[0];
type OverviewProps = Parameters<typeof import("../src/screens/workDetail/checklist/ChecklistOverview").ChecklistOverview>[0];
interface ActionProps { title?: string; label?: string; accessibilityLabel?: string; disabled?: boolean; onPress: () => void; }

function elements<P extends object>(node: ReactNode, type: string): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type && isValidElement<P>(node) ? [node] : []), ...elements<P>(node.props.children, type)];
}
function element<P extends object>(node: ReactNode, type: string): ReactElement<P> {
  const result = elements<P>(node, type)[0];
  assert.ok(result, `Missing ${type}`);
  return result;
}
function action(node: ReactNode, label: string): ActionProps {
  const result = [...elements<ActionProps>(node, "Button"), ...elements<ActionProps>(node, "IconButton")]
    .find(({ props }) => props.accessibilityLabel === label || props.label === label || props.title === label);
  assert.ok(result, `Missing action ${label}`);
  return result.props;
}

async function fixture(confirmed = 20) {
  const hooks = reactFixture(); const editorHooks = reactFixture(); const overviewHooks = reactFixture();
  const storage = new Map<string, string>();
  const storageApi = { getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); } };
  const navigation = loadSource<typeof import("../src/screens/workDetail/checklist/useChecklistNavigation")>("screens/workDetail/checklist/useChecklistNavigation.ts", (id) => {
    if (id === "react") return hooks.react;
    if (id === "zod") return { z };
    if (id === "@react-native-async-storage/async-storage") return storageApi;
    if (id === "../../../domain/checklistResume") return resume;
    throw new Error(`UNEXPECTED_IMPORT ${id}`);
  });
  const draftModule = loadSource<typeof import("../src/screens/workDetail/useWorkDraft")>("screens/workDetail/useWorkDraft.ts", (id) => {
    if (id === "react") return hooks.react;
    if (id === "react-native") return { Platform: { OS: "android" } };
    if (id === "zod") return { z };
    if (id === "@react-native-async-storage/async-storage") return storageApi;
    if (id === "../../domain/format") return format;
    if (id === "./detailRules") return rules;
    if (id === "./localPhotos") return {};
    throw new Error(`UNEXPECTED_IMPORT ${id}`);
  });
  const ui = { Badge: "Badge", BodyText: "BodyText", Button: "Button", Field: "Field", IconButton: "IconButton", EmptyState: "EmptyState", SectionTitle: "SectionTitle" };
  const native = { ScrollView: "ScrollView", Text: "Text", View: "View", Pressable: "Pressable" };
  const list: Checklist = { checklistId: 501, name: "Checklist", code: "RESUME", steps: Array.from({ length: 47 }, (_, index) =>
    step({ stepId: index + 1, order: index + 1, title: `Pregunta ${index + 1}`, selectValue: index < confirmed ? "approved" : "" })) };
  let saves = 0; let evidenceStep: string | undefined;
  const props: ChecklistTabProps = { work: work({ checklists: [list] }), draft: { version: 1, report: "Reporte conservado", savedReport: null, answers: {}, photos: [] },
    maintenance: true, disabled: false, readOnly: false, mode: "live", savingStep: null, storageKey: "tenant-A/group-80/work-81",
    onChange: (candidate: ChecklistStep, answer: StepAnswer) => { props.draft.answers[String(candidate.stepId)] = { answer, saved: false, baseline: rules.answerSignature(candidate) }; },
    onDiscard: () => { throw new Error("UNEXPECTED_DISCARD"); }, onSave: async () => { saves++; },
    onEvidence: (id) => { evidenceStep = id; }, onRefresh: async () => {} };
  const tab = loadSource<{ ChecklistTab: (input: ChecklistTabProps) => { type: (input: ChecklistTabProps & { scopeKey: string }) => ReactNode; props: ChecklistTabProps & { scopeKey: string } } }>("screens/workDetail/ChecklistTab.tsx", (id) => {
    if (id === "react") return hooks.react;
    if (id === "react/jsx-runtime") return jsx;
    if (id === "react-native") return native;
    if (id === "../../domain/checklistResume") return resume;
    if (id === "../../domain/format") return format;
    if (id === "../../ui/components") return ui;
    if (id === "./checklist/ChecklistCatalog") return { ChecklistCatalog: "ChecklistCatalog", ChecklistProgress: "ChecklistProgress" };
    if (id === "./checklist/ChecklistOverview") return { ChecklistOverview: "ChecklistOverview" };
    if (id === "./checklist/StepEditor") return { StepEditor: "StepEditor" };
    if (id === "./checklist/styles") return { checklistStyles: {} };
    if (id === "./checklist/useChecklistNavigation") return navigation;
    if (id === "./DetailUi") return { Notice: "Notice" };
    if (id === "./detailRules") return rules;
    throw new Error(`UNEXPECTED_IMPORT ${id}`);
  });
  const childrenImports = (id: string): unknown => {
    if (id === "react/jsx-runtime") return jsx;
    if (id === "react-native") return native;
    if (id === "../../../domain/checklistProgress") return progress;
    if (id === "../../../domain/format") return format;
    if (id === "../../../ui/components") return ui;
    if (id === "../DetailUi") return { Notice: "Notice", AttachmentList: "AttachmentList" };
    if (id === "../detailRules") return rules;
    if (id === "../detailStyles") return { styles: {} };
    if (id === "../useWorkDraft") return draftModule;
    if (id === "./checklistPresentation") return presentation;
    if (id === "./ResponseInput") return { ResponseInput: "ResponseInput" };
    if (id === "./styles") return { checklistStyles: {} };
    throw new Error(`UNEXPECTED_IMPORT ${id}`);
  };
  const editor = loadSource<typeof import("../src/screens/workDetail/checklist/StepEditor")>("screens/workDetail/checklist/StepEditor.tsx", (id) => id === "react" ? editorHooks.react : childrenImports(id));
  const overview = loadSource<typeof import("../src/screens/workDetail/checklist/ChecklistOverview")>("screens/workDetail/checklist/ChecklistOverview.tsx", (id) => id === "react" ? overviewHooks.react : childrenImports(id));
  const render = (): ReactNode => { const root = tab.ChecklistTab(props); const tree = hooks.render(() => root.type(root.props)); hooks.flush(); return tree; };
  render(); await new Promise<void>((resolve) => setImmediate(resolve));
  const open = () => element<{ onOpen: (item: Checklist) => void }>(render(), "ChecklistCatalog").props.onOpen(list);
  const renderEditor = (): ReactNode => editorHooks.render(() => editor.StepEditor(element<EditorProps>(render(), "StepEditor").props));
  const renderOverview = (): ReactNode => overviewHooks.render(() => overview.ChecklistOverview(element<OverviewProps>(render(), "ChecklistOverview").props));
  return { props, list, render, renderEditor, renderOverview, open, hooks, saves: () => saves, evidence: () => evidenceStep, storage };
}

test("actual catalog opens editor at 21 and keeps draft answer, report and photos untouched", async () => {
  const f = await fixture();
  const candidate = f.list.steps[20];
  const answer = progress.normalizeChecklistAnswer(candidate, { responseValue: "rejected", isCompleted: false, executionStatus: null, comment: "Conservar" });
  f.props.onChange(candidate, answer);
  f.props.draft.photos.push({ photo: { id: "draft-photo", name: "photo.png", uri: "file:///private/fixture.png", mimeType: "image/png" }, stepId: "21", uploaded: false });
  const before = structuredClone(f.props.draft);
  f.open();
  assert.equal(element<EditorProps>(f.render(), "StepEditor").props.step.stepId, 21);
  assert.deepEqual(element<{ answer: StepAnswer }>(f.renderEditor(), "ResponseInput").props.answer, answer);
  assert.deepEqual(f.props.draft, before);
  assert.equal(f.saves(), 0);
});

test("resumed queued answer cannot resubmit and can move forward without changing its payload", async () => {
  const f = await fixture(); const candidate = f.list.steps[20];
  const answer = progress.normalizeChecklistAnswer(candidate, { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: null });
  f.props.onChange(candidate, answer);
  const operation = { id: "c49b3747-4c0d-4239-b9b9-bdab27bdde08", stepId: "21", answer: structuredClone(answer), status: "pending" };
  const before = structuredClone(operation);
  f.props.isAnswerQueued = (current, value) => String(current.stepId) === operation.stepId && JSON.stringify(value) === JSON.stringify(operation.answer);
  f.open();
  const tree = f.renderEditor();
  assert.equal(action(tree, "Respuesta ya registrada en cola").disabled, true);
  action(tree, "Respuesta ya registrada en cola").onPress();
  action(tree, "Paso siguiente sin guardar").onPress();
  assert.equal(element<EditorProps>(f.render(), "StepEditor").props.step.stepId, 22);
  assert.equal(f.saves(), 0);
  assert.deepEqual(operation, before);
  assert.deepEqual(f.props.draft.answers["21"].answer, answer);
});

test("complete list opens real summary and optional/informational steps remain editable through it", async () => {
  const f = await fixture(47);
  f.list.steps[0].type = "text";
  f.list.steps[1].isRequired = false;
  f.list.steps[1].selectValue = "";
  f.open();
  assert.equal(elements(f.render(), "StepEditor").length, 0);
  assert.ok(elements<{ message: string }>(f.render(), "Notice").some(({ props }) => /No quedan pasos obligatorios/.test(props.message)));
  const rows = elements<ActionProps>(f.renderOverview(), "Pressable");
  assert.equal(rows.length, 20);
  rows[0].props.onPress();
  assert.equal(element<EditorProps>(f.render(), "StepEditor").props.step.type, "text");
  action(f.render(), "Resumen de pasos").onPress();
  elements<ActionProps>(f.renderOverview(), "Pressable")[1].props.onPress();
  const editor = element<EditorProps>(f.render(), "StepEditor").props;
  assert.equal(editor.step.stepId, 2);
  assert.equal(editor.context.readOnly, false);
  f.props.onChange(editor.step, progress.normalizeChecklistAnswer(editor.step, { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: null }));
  action(f.renderEditor(), "Guardar y siguiente").onPress();
  await Promise.resolve();
  assert.equal(f.saves(), 1);
});

test("missing evidence opens the answered step with a warning and returns from files without reset", async () => {
  const f = await fixture();
  f.list.steps[3].isFilesRequired = true;
  f.props.pendingEvidenceCount = (id) => id === "4" ? 1 : 0;
  f.open();
  assert.equal(element<EditorProps>(f.render(), "StepEditor").props.step.stepId, 4);
  const tree = f.renderEditor();
  assert.ok(elements<{ message: string }>(tree, "Notice").some(({ props }) => /falta evidencia confirmada/.test(props.message)));
  assert.ok(elements<{ label: string }>(tree, "Badge").some(({ props }) => props.label === "1 archivos sin confirmar"));
  action(tree, "Adjuntar al paso").onPress();
  assert.equal(f.evidence(), "4");
  f.hooks.unmount();
  f.list.steps[3].attachments = [{ id: 91, name: "photo.png", url: "https://example.com/photo.png" }];
  assert.equal(element<EditorProps>(f.render(), "StepEditor").props.step.stepId, 4);
  assert.equal(f.saves(), 0);
});

test("freshly received pending steps do not turn a visible summary into an auto-jump or false complete message", async () => {
  const f = await fixture(47); f.open();
  f.list.steps[20].selectValue = "";
  assert.equal(elements(f.render(), "StepEditor").length, 0);
  assert.ok(elements<{ message: string }>(f.render(), "Notice").some(({ props }) => /tiene pasos pendientes/.test(props.message)));
});

test("removing the actively visited step shows summary without discarding its draft or choosing step one", async () => {
  const f = await fixture(); f.open();
  f.props.onChange(f.list.steps[20], { responseValue: "rejected", isCompleted: true, executionStatus: "completed", comment: "Guardar" });
  const before = structuredClone(f.props.draft);
  f.list.steps = f.list.steps.filter((candidate) => candidate.stepId !== 21);
  assert.equal(elements(f.render(), "StepEditor").length, 0);
  assert.ok(elements<{ message: string }>(f.render(), "Notice").some(({ props }) => /ya no está/.test(props.message)));
  assert.deepEqual(f.props.draft, before);
});
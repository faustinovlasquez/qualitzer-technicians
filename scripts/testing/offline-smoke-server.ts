import express, { type Request, type Response } from "express";
import cors from "cors";
import multer from "multer";
import { createHash } from "node:crypto";
import { makeDemoData, demoUser } from "../../src/infrastructure/demoData";
import { DemoCreationStore, demoCreationOptions } from "../../src/infrastructure/creationDemo";
import { DemoChecklistAssignments } from "../../src/infrastructure/checklistAssignmentDemo";
import { checklistAssignmentInputSchema, checklistCatalogQuerySchema } from "../../src/domain/checklistAssignment";
import { creationInputSchema, creationOptionsQuerySchema } from "../../src/domain/creation";
import { syncCommandSchema, syncDocumentSchema, syncAnswerFromStep, syncAnswersEqual, syncResponseForStep, type SyncReceipt } from "../../src/domain/offlineProtocol";
import { normalizeChecklistAnswer } from "../../src/domain/checklistProgress";
import type { Attachment, WorkComment } from "../../src/domain/models";

if (!process.argv.includes("--isolated-offline-fixture")) throw new Error("Explicit --isolated-offline-fixture required");

const app = express();
const data = makeDemoData();
const checklistAssignments = new DemoChecklistAssignments(data.groups.flatMap((group) => group.works.flatMap((work) => work.checklists)));
const checklistAttachments: { groupId: string; workId: string; checklistId: number; alreadyAssigned: boolean }[] = [];
const creationInputs: ReturnType<typeof creationInputSchema.parse>[] = [];
const tenant = { id: "offline-smoke", name: "OFFLINE SMOKE · FICTICIO", portalOrigin: "https://offline.example", environment: "development" as const };
const user = { ...demoUser, name: "Offline", lastnames: "Fixture", email: "technician@offline.example", tenant };
const comments = new Map<string, WorkComment[]>();
const files = new Map<string, Attachment[]>();
const receipts = new Map<string, { digest: string; receipt: SyncReceipt }>();
const creationRequests = new Map<string, unknown>();
const effects = { creations: 0, comments: 0, answers: 0, documents: 0 };
const requests: { method: string; path: string; operationId?: string }[] = [];
const uploads: { operationId: string; fileId: number; sha256: string; bytes: number; groupId: string; workId?: number }[] = [];
let offline = false;
let loseNext: "comment" | "answer" | "document" | "creation" | null = null;
let lostResponses = 0;
let nextFile = 70001;
let logoutCalls = 0;
const creation = new DemoCreationStore((group) => { data.groups.push(group); effects.creations++; });
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const key = (group: string, work?: string | number, step?: string | number) => `${group}:${work ?? "root"}:${step ?? "root"}`;

app.use((req, res, next) => {
  if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") || !["127.0.0.1:8788", "localhost:8788"].includes(req.headers.host ?? "")) { res.sendStatus(403); return; }
  if (req.headers.origin && !["http://localhost:8081", "http://127.0.0.1:8081"].includes(req.headers.origin)) { res.sendStatus(403); return; }
  next();
});
app.use(cors({ origin: ["http://localhost:8081", "http://127.0.0.1:8081"], credentials: true }));
app.use(express.json({ limit: "64kb" }));
app.get("/__offline_test__/state", (_req, res) => res.json({ fixture: "isolated-offline-smoke-v1", offline, loseNext, lostResponses, effects, logoutCalls, uploads, receipts: [...receipts.values()].map((entry) => entry.receipt), creations: [...creationRequests.entries()], creationInputs, checklistAttachments, requests }));
app.post("/__offline_test__/control", (req, res) => {
  if (typeof req.body.offline === "boolean") offline = req.body.offline;
  if (["comment", "answer", "document", "creation", null].includes(req.body.loseNext)) loseNext = req.body.loseNext;
  res.json({ offline, loseNext });
});
app.use((req, _res, next) => { if (offline) { req.socket.destroy(); return; } requests.push({ method: req.method, path: req.path }); next(); });
app.get("/health", (_req, res) => res.json({ ok: true, backendReachable: true, tenantOrigin: tenant.portalOrigin }));
app.post("/api/auth/login/start", (req, res) => {
  if (req.body.username !== "offline-fixture" || req.body.password !== "fictional-offline-only") { res.status(401).json({ error: "INVALID_FIXTURE_CREDENTIALS" }); return; }
  res.cookie("offline_smoke_session", "fictional", { httpOnly: true, sameSite: "lax", path: "/api", maxAge: 86400000 });
  res.json({ token: "cookie-session", username: user.name, email: user.email, nextStep: "DONE", tenant });
});
app.use("/api", (req, res, next) => {
  if (!req.headers.cookie?.includes("offline_smoke_session=fictional") || req.headers["x-qualitzer-tenant"] !== tenant.id) { res.status(401).json({ error: "FIXTURE_SESSION_REQUIRED" }); return; }
  next();
});
app.get("/api/auth/me", (_req, res) => res.json(user));
app.post("/api/auth/logout", (_req, res) => { logoutCalls++; res.clearCookie("offline_smoke_session", { path: "/api" }); res.sendStatus(204); });
app.get("/api/mobile-notifications/status", (_req, res) => res.json({ enabled: false, reasons: ["DEMO"], projectId: null, reconciliationSeconds: 120, deliveryGuaranteed: false }));
app.get("/api/creation/options", (req, res) => {
  const query = creationOptionsQuerySchema.parse({ ...req.query, companyBranchId: Number(req.query.companyBranchId), ...(req.query.page === undefined ? {} : { page: Number(req.query.page) }) });
  res.json(demoCreationOptions(query));
});
function respond(req: Request, res: Response, kind: typeof loseNext, value: unknown): void {
  if (loseNext === kind) { loseNext = null; lostResponses++; offline = true; req.socket.destroy(); return; }
  res.json(value);
}
app.post("/api/creation", (req, res) => {
  const input = creationInputSchema.parse(req.body);
  const result = creation.create(input);
  creationInputs.push(input);
  creationRequests.set(input.clientRequestId, result);
  requests.at(-1)!.operationId = input.clientRequestId;
  respond(req, res, "creation", result);
});
app.get("/api/assignments", (req, res) => {
  const result = structuredClone(data);
  result.generatedAt = new Date().toISOString();
  result.groups = result.groups.map((group) => ({ ...group, works: group.works.filter((work) => work.scheduledDate >= String(req.query.startDate) && work.scheduledDate <= String(req.query.endDate)).map((work) => ({ ...work, schedules: undefined })) })).filter((group) => group.works.length);
  const works = result.groups.flatMap((group) => group.works);
  result.summary = { totalGroups: result.groups.length, totalWorks: works.length, activeWorks: works.filter((work) => work.status === "in_progress").length, overdueWorks: 0, plannedMinutes: works.reduce((sum, work) => sum + work.plannedMinutes, 0) };
  res.json(result);
});
app.get("/api/assignments/:group/works/:work/checklists/options", (req, res) => {
  const work = data.groups.find((group) => group.id === req.params.group)?.works.find((item) => item.id === req.params.work);
  if (!work || Number(req.query.companyBranchId) !== 1) { res.status(404).json({ error: "FIXTURE_WORK_NOT_FOUND" }); return; }
  const query = checklistCatalogQuerySchema.parse({ search: req.query.search, page: req.query.page === undefined ? 0 : Number(req.query.page) });
  res.json(checklistAssignments.options(work, query));
});
app.post("/api/assignments/:group/works/:work/checklists", (req, res) => {
  const work = data.groups.find((group) => group.id === req.params.group)?.works.find((item) => item.id === req.params.work);
  if (!work || Number(req.query.companyBranchId) !== 1) { res.status(404).json({ error: "FIXTURE_WORK_NOT_FOUND" }); return; }
  const input = checklistAssignmentInputSchema.parse(req.body);
  const result = checklistAssignments.attach(work, input.checklistId);
  checklistAttachments.push({ groupId: req.params.group, workId: req.params.work, ...result });
  res.json(result);
});
app.get("/api/assignments/:group/works/:work/comments", (req, res) => {
  const items = comments.get(key(req.params.group, req.params.work)) ?? [];
  res.json({ data: items, totalRows: items.length, totalPages: items.length ? 1 : 0 });
});
app.get(["/api/assignments/:group/works/:work/files", "/api/assignments/:group/works/:work/steps/:step/files", "/api/assignments/:group/files"], (req, res) => res.json({ data: files.get(key(req.params.group, req.params.work, req.params.step)) ?? [] }));
app.get("/api/assignments/:group/maintenance-delivery", (req, res) => res.json({ groupId: req.params.group, status: "in_progress", maintenanceType: "preventive", finalizationNote: null, damageType: null, durationMinutes: null, startedAt: null, finalizedAt: null, incompleteChecklists: ["Fixture checklist"], canStart: false, canDeliver: false }));
app.get("/api/offline/receipts/:id", (req, res) => {
  const found = receipts.get(req.params.id);
  if (!found) { res.status(404).json({ error: "OFFLINE_RECEIPT_NOT_FOUND" }); return; }
  res.json(found.receipt);
});
function replay(operationId: string, digest: string): SyncReceipt | undefined {
  const previous = receipts.get(operationId);
  if (!previous) return;
  return previous.digest === digest ? previous.receipt : { operationId, state: "needs_review", error: "MOBILE_SYNC_OPERATION_REUSED" };
}
app.post("/api/offline/commands", (req, res) => {
  const input = syncCommandSchema.parse(req.body);
  requests.at(-1)!.operationId = input.operationId;
  const digest = sha(JSON.stringify(input));
  const previous = replay(input.operationId, digest);
  if (previous) { res.json(previous); return; }
  const work = data.groups.find((group) => group.id === input.scope.groupId)?.works.find((item) => item.id === String(input.scope.workId));
  let receipt: SyncReceipt = { operationId: input.operationId, state: "applied" };
  if (!work || input.scope.companyBranchId !== 1) receipt = { operationId: input.operationId, state: "rejected", error: "MOBILE_SYNC_WORK_NOT_FOUND" };
  else if (input.kind === "comment") {
    const scopeKey = key(input.scope.groupId, input.scope.workId);
    comments.set(scopeKey, [...(comments.get(scopeKey) ?? []), { id: `fixture-${input.operationId}`, text: input.payload.text, createdAt: new Date().toISOString(), author: { id: user.id, name: "Offline Fixture" }, files: [] }]);
    work.commentsCount++; effects.comments++;
  } else {
    const step = work.checklists.flatMap((list) => list.steps).find((entry) => String(entry.stepId) === String(input.payload.stepId));
    if (!step) receipt = { operationId: input.operationId, state: "rejected", error: "MOBILE_SYNC_STEP_NOT_FOUND" };
    else if (!syncAnswersEqual(syncAnswerFromStep(step), input.payload.base)) receipt = { operationId: input.operationId, state: "conflict", error: "MOBILE_SYNC_BASE_CONFLICT" };
    else {
      const answer = normalizeChecklistAnswer(step, { responseValue: syncResponseForStep(step, input.payload.answer), isCompleted: false, comment: input.payload.answer.comment, executionStatus: step.executionStatus });
      Object.assign(step, input.payload.answer, { isCompleted: step.type === "validation" ? input.payload.answer.isCompleted : answer.isCompleted });
      work.checklistDone = work.checklists.flatMap((list) => list.steps).filter((entry) => entry.isCompleted).length;
      effects.answers++;
    }
  }
  receipts.set(input.operationId, { digest, receipt });
  respond(req, res, input.kind, receipt);
});
app.post("/api/offline/documents", multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1 } }).single("files"), (req, res) => {
  const input = syncDocumentSchema.parse(JSON.parse(String(req.body.metadata)));
  requests.at(-1)!.operationId = input.operationId;
  if (!req.file || sha(req.file.buffer) !== input.sha256) { res.status(400).json({ error: "OFFLINE_DOCUMENT_DIGEST_MISMATCH" }); return; }
  const digest = sha(JSON.stringify({ input, name: req.file.originalname, mime: req.file.mimetype, bytes: req.file.size }));
  const previous = replay(input.operationId, digest);
  if (previous) { res.json(previous); return; }
  const work = data.groups.find((group) => group.id === input.scope.groupId)?.works.find((item) => item.id === String(input.scope.workId));
  if (!work || input.scope.companyBranchId !== 1) { res.status(400).json({ error: "MOBILE_SYNC_WORK_NOT_FOUND" }); return; }
  const fileId = nextFile++;
  const attachment: Attachment = { id: fileId, name: req.file.originalname, type: req.file.mimetype, url: `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`, createdAt: new Date().toISOString() };
  const scopeKey = key(input.scope.groupId, input.scope.workId, input.stepId);
  files.set(scopeKey, [...(files.get(scopeKey) ?? []), attachment]);
  work.filesCount++; effects.documents++;
  uploads.push({ operationId: input.operationId, fileId, sha256: input.sha256, bytes: req.file.size, groupId: input.scope.groupId, workId: input.scope.workId });
  const receipt: SyncReceipt = { operationId: input.operationId, state: "applied", fileId };
  receipts.set(input.operationId, { digest, receipt });
  respond(req, res, "document", receipt);
});
app.use((_req, res) => res.status(404).json({ error: "FIXTURE_ROUTE_NOT_IMPLEMENTED" }));
app.use((error: Error, _req: Request, res: Response, _next: express.NextFunction) => res.status(400).json({ error: "FIXTURE_INVALID_REQUEST", message: error.message }));
const server = app.listen(8788, "127.0.0.1", () => console.log("OFFLINE FIXTURE ONLY http://127.0.0.1:8788 · no upstream / no persistence / explicit fault controls"));
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
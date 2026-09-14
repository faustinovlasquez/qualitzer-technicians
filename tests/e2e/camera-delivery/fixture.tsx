import "../picker-messages-fixture";
import type { ImagePickerResult, CameraPermissionResponse } from "expo-image-picker";
import type { StatusInput, WorkDetailTab } from "../../../src/domain/models";
import type { OfflineSnapshot, TimerReadAssignmentWork } from "../../../src/domain/offline";

type Case = "camera" | "pending" | "attention" | "offline" | "stale" | "files" | "five-reasons" | "valid";
interface CameraDeliveryFixture {
  kind: Case;
  permission: CameraPermissionResponse;
  permissionReads: number;
  permissionRequests: number;
  settingsCalls: number;
  submitted: StatusInput[];
  holdProtection: boolean;
  protectionPending: boolean;
  render(kind: Case, tab?: WorkDetailTab): void;
  configureWork(work: TimerReadAssignmentWork): TimerReadAssignmentWork;
  configureSnapshot(snapshot: OfflineSnapshot): OfflineSnapshot;
  loadFiles(): Promise<[]>;
  submit(input: StatusInput): Promise<void>;
  setPermission(status: "undetermined" | "denied" | "granted", canAskAgain?: boolean): void;
  requestPermission(): Promise<CameraPermissionResponse>;
  finishPermission(granted: boolean, canAskAgain?: boolean): void;
  finishCamera(cancel?: boolean): void;
  protect(): Promise<void>;
  releaseProtection(): void;
  openSettings(): Promise<void>;
}
declare global { interface Window { cameraDelivery: CameraDeliveryFixture; } }

let permissionResult: ((value: CameraPermissionResponse) => void) | null = null;
let privacyResult: (() => void) | null = null;
let cameraCanceled = false;
const originalLaunch = window.pickerOs.launchCamera.bind(window.pickerOs);
window.pickerOs.launchCamera = async (): Promise<ImagePickerResult> => {
  const result = await originalLaunch();
  return cameraCanceled ? { canceled: true, assets: null } : result;
};

const fixture: CameraDeliveryFixture = {
  kind: "camera", permission: { granted: true, canAskAgain: true, status: "granted" as CameraPermissionResponse["status"], expires: "never" },
  permissionReads: 0, permissionRequests: 0, settingsCalls: 0, submitted: [], holdProtection: false, protectionPending: false,
  render(kind, tab = "work") { fixture.kind = kind; window.pickerMessages.render("percent22", tab); },
  configureWork(work) {
    if (fixture.kind === "camera") return work;
    return { ...work, status: "paused", firstInProgressTime: "08:00", checklists: [], isFilesRequired: fixture.kind === "files" || fixture.kind === "five-reasons", missingRequiredInfo: fixture.kind === "stale" ? ["OFFLINE_AWAITING_SERVER_SNAPSHOT"] : fixture.kind === "five-reasons" ? ["REQUIRED_DATA"] : [] };
  },
  configureSnapshot(snapshot) {
    const hasPending = ["camera", "pending", "attention", "five-reasons"].includes(fixture.kind);
    const offline = fixture.kind === "offline" || fixture.kind === "five-reasons";
    return { ...snapshot, online: !offline, pending: hasPending ? 1 : 0, lastError: null, conflicts: 0,
      operations: hasPending ? snapshot.operations.map(operation => ({ ...operation, status: fixture.kind === "attention" || fixture.kind === "five-reasons" ? "needs_review" : "pending" })) : [],
      connection: { status: offline ? "offline" : "ready", networkConnected: !offline, foreground: true, checkedAt: 1789387200000 } };
  },
  async loadFiles() {
    if (fixture.kind === "files" || fixture.kind === "five-reasons") throw new Error("No se pudieron consultar los archivos. Vuelve a intentarlo.");
    return [];
  },
  async submit(input) { fixture.submitted.push(structuredClone(input)); await new Promise<void>(() => {}); },
  setPermission(status, canAskAgain = true) { fixture.permission = { granted: status === "granted", status: status as CameraPermissionResponse["status"], canAskAgain, expires: "never" }; },
  requestPermission() {
    fixture.permissionRequests++;
    window.pickerOs.events.push("permission-request");
    if (permissionResult) throw new Error("DUPLICATE_PERMISSION_REQUEST");
    return new Promise(resolve => { permissionResult = resolve; });
  },
  finishPermission(granted, canAskAgain = true) {
    if (!permissionResult) throw new Error("NO_PERMISSION_REQUEST");
    fixture.setPermission(granted ? "granted" : "denied", canAskAgain);
    const resolve = permissionResult; permissionResult = null;
    window.pickerOs.events.push("permission-result"); resolve(fixture.permission);
  },
  finishCamera(cancel = false) { cameraCanceled = cancel; window.pickerOs.cameraResult(); },
  async protect() {
    window.pickerOs.privacy.push("prevent"); window.pickerOs.events.push("protect-start");
    if (fixture.holdProtection) { fixture.protectionPending = true; await new Promise<void>(resolve => { privacyResult = resolve; }); }
    fixture.protectionPending = false; window.pickerOs.events.push("protect-ready");
  },
  releaseProtection() { fixture.holdProtection = false; const resolve = privacyResult; privacyResult = null; resolve?.(); },
  async openSettings() { fixture.settingsCalls++; window.pickerOs.events.push("settings-explicit"); },
};
window.cameraDelivery = fixture;
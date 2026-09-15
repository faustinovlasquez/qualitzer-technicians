"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { sha256File, gatewayUrl } = require("./release-policy.cjs");

const requiredSources = [
  "src/infrastructure/tenantChallengeClock.ts",
  "src/infrastructure/HttpTechnicianRepository.ts",
  "src/infrastructure/assignmentReadBatch.ts",
  "src/domain/assignmentRead.ts",
  "src/application/useTechnicianApp.ts",
  "src/screens/TenantSelectionScreen.tsx",
  "src/domain/branding.ts",
  "src/ui/components.tsx",
  "src/ui/time/TimeField.tsx",
  "src/ui/time/NumericSelectField.tsx",
  "src/ui/time/SelectorUi.tsx",
  "src/ui/time/TimePickerPanel.native.tsx",
  "src/ui/time/androidTimeDialog.ts",
  "src/ui/time/useSelectionSession.ts",
  "src/ui/time/timeValues.ts",
  "src/branding/useCompanyBranding.ts",
  "src/branding/CompanyBrandingController.ts",
  "src/branding/companyBranding.ts",
  "src/offline/engine.ts",
  "src/offline/syncScheduling.ts",
  "src/offline/queueIntentions.ts",
  "src/offline/state.ts",
  "src/offline/cacheSchemas.ts",
  "src/offline/contracts.ts",
  "src/offline/connection.ts",
  "src/offline/connectionPresentation.ts",
  "src/offline/connectivity.ts",
  "src/offline/foreground.ts",
  "src/offline/foregroundBinding.ts",
  "src/offline/DurableStore.ts",
  "src/offline/FileStore.ts",
  "src/offline/overlay.ts",
  "src/offline/profiles.ts",
  "src/offline/index.ts",
  "src/domain/offline.ts",
  "src/domain/offlineProtocol.ts",
  "src/domain/checklistAssignment.ts",
  "src/infrastructure/DemoTechnicianRepository.ts",
  "src/infrastructure/offlineDemo.ts",
  "src/infrastructure/checklistAssignmentDemo.ts",
  "src/screens/schedule/MobileAgenda.tsx",
  "src/screens/schedule/WeeklySchedule.tsx",
  "src/domain/weeklySchedule.ts",
  "src/screens/DashboardScreen.tsx",
  "src/screens/WorkDetailScreen.tsx",
  "src/screens/OrderDetailScreen.tsx",
  "src/screens/creation/CreationScreen.tsx",
  "src/screens/orders/lifecycle/MaintenanceDeliveryDialog.tsx",
  "src/screens/workDetail/CompletionDialog.tsx",
  "src/screens/workDetail/DeliverySuccess.tsx",
  "src/screens/workDetail/WorkActivities.tsx",
  "src/screens/workDetail/WorkInformation.tsx",
  "src/screens/workDetail/detailStyles.ts",
  "src/domain/workActivities.ts",
  "src/screens/workDetail/completionTiming.ts",
  "src/screens/workDetail/DetailUi.tsx",
  "src/screens/offline/OfflineFileCard.tsx",
  "src/screens/workDetail/detailRules.ts",
  "src/domain/workExecution.ts",
  "src/domain/checklistProgress.ts",
  "src/domain/cameraErrors.ts",
  "src/screens/workDetail/localPhotos.ts",
  "src/screens/workDetail/useWorkDraft.ts",
  "src/screens/workDetail/useAttachmentFiles.ts",
  "src/infrastructure/photos.ts",
  "src/screens/workDetail/ChecklistTab.tsx",
  "src/screens/workDetail/checklist/StepEditor.tsx",
  "src/screens/workDetail/checklist/ChecklistCatalog.tsx",
  "src/screens/workDetail/checklist/styles.ts",
  "src/domain/assignmentChecklistProgress.ts",
  "src/domain/assignmentSchedule.ts",
  "src/domain/assignmentCodes.ts",
  "src/domain/notifications.ts",
  "src/screens/orders/AssignmentOrderCard.tsx",
  "src/offline/OfflineTechnicianRepository.ts",
  "src/branding/companyBrandingContext.ts",
  "src/screens/LoginScreen.tsx",
  "src/screens/workDetail/FileWorkspace.tsx",
  "src/screens/workDetail/files/filePicker.ts",
  "src/screens/workDetail/files/CameraPermissionGuide.tsx",
  "src/screens/workDetail/files/useCameraPermissionGuide.ts",
  "src/screens/workDetail/files/fileRules.ts",
  "src/screens/workDetail/files/saveFileBatch.ts",
  "src/screens/workDetail/files/WorkspaceDraftStore.ts",
  "src/screens/workDetail/files/WorkspaceFileList.tsx",
  "src/screens/workDetail/files/workspaceStyles.ts",
  "src/screens/workDetail/checklist/useChecklistNavigation.ts",
  "src/domain/checklistResume.ts",
  "src/screens/offline/offlineUi.ts",
  "src/screens/offline/syncUserPresentation.ts",
  "src/screens/offline/syncAttemptPresentation.ts",
  "src/screens/offline/OfflineCenterScreen.tsx",
  "src/screens/offline/OfflineStatusBar.tsx",
  "src/screens/orders/AssignmentWorkCard.tsx",
  "src/screens/workDetail/CommentsTab.tsx",
  "src/screens/workDetail/checklist/ChecklistAssociationPanel.tsx",
  "src/notifications/notificationAdapter.ts",
  "src/notifications/MobileNotificationClient.ts",
  "src/notifications/notificationPresentationDedupe.ts",
  "src/notifications/notificationSafety.ts",
  "src/notifications/useMobileNotifications.ts",
  "src/screens/notifications/NotificationCenterScreen.tsx",
  "src/screens/notifications/NotificationSettingsScreen.tsx",
  "src/screens/notifications/notificationPresentation.ts",
  "src/screens/notifications/NotificationStatusCard.tsx",
  "src/screens/ProfileScreen.tsx",
  "src/security/DeviceLockController.ts",
  "src/security/trustedNativeInteraction.ts",
  "src/security/useTrustedNativePicker.ts",
  "src/security/deviceSecurityAdapter.ts",
  "src/security/DeviceSecurityProvider.tsx",
  "src/security/DeviceSecurityContext.tsx",
  "src/security/DeviceLockScreen.tsx",
  "src/security/DeviceSecurityCard.tsx",
  "App.tsx",
];

function captureSources(root) {
  return requiredSources.map(file => ({ file, sha256: sha256File(path.join(root, file)) }));
}

function protectedSnapshot(root) {
  const result = {};
  function visit(relative) {
    if (/^modules\/[^/]+\/android\/(?:build|\.gradle|\.cxx)$/.test(relative)) return;
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) return;
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error("PROTECTED_SOURCE_LINK_NOT_ALLOWED");
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(`${relative}/${name}`);
    } else result[relative] = sha256File(full);
  }
  for (const relative of ["src", "server", "tests", "config", "docs", "modules", "assets", "App.tsx", "app.json", "app.config.ts", "eas.json", "package.json", "package-lock.json", ".env"]) visit(relative);
  return result;
}

function verifySources(root, captured, bundleSha256) {
  const mapFile = path.join(root, "android/app/build/generated/sourcemaps/react/release/index.android.bundle.map");
  const bundleFile = path.join(root, "android/app/build/generated/assets/react/release/index.android.bundle");
  if (sha256File(bundleFile) !== bundleSha256) throw new Error("APK_BUNDLE_DIFFERS_FROM_GRADLE_OUTPUT");
  const map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  const sources = captured.map(source => {
    const indexes = map.sources.flatMap((name, index) => {
      const normalized = name.replaceAll("\\", "/");
      return normalized === source.file || normalized.endsWith(`/${source.file}`) ? [index] : [];
    });
    if (indexes.length !== 1 || typeof map.sourcesContent?.[indexes[0]] !== "string") throw new Error("RELEASE_SOURCE_MAP_CONTENT_MISSING");
    const content = map.sourcesContent[indexes[0]];
    const embeddedSha256 = createHash("sha256").update(content).digest("hex");
    if (embeddedSha256 !== source.sha256 || sha256File(path.join(root, source.file)) !== source.sha256) throw new Error("RELEASE_SOURCE_CHANGED_OR_STALE_BUNDLE");
    return { ...source, embeddedSha256, matches: true };
  });
  return { sources, sourceMapSha256: sha256File(mapFile), generatedBundleSha256: sha256File(bundleFile), sourceCount: map.sources.length };
}

async function checkHealth() {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(`${gatewayUrl}/health`, { redirect: "error", signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    return { checkedAt, status: response.status, ok: body?.ok === true, backendReachable: body?.backendReachable === true };
  } catch {
    return { checkedAt, status: null, ok: false, backendReachable: false };
  }
}

module.exports = { captureSources, protectedSnapshot, verifySources, checkHealth };
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/native-release-1.0.4/smoke");
const actions = fs.readdirSync(output).filter(name => /^\d\d-.+\.json$/.test(name)).sort().map(name => JSON.parse(fs.readFileSync(path.join(output, name), "utf8")));
const last = actions.at(-1);
async function main() {
  let pngValidation;
  try {
    const image = await require("sharp")(path.join(output, "fixtures/qz-native-104-smoke.png")).raw().toBuffer({ resolveWithObject: true });
    pngValidation = { decoded: true, width: image.info.width, height: image.info.height };
  } catch (error) {
    pngValidation = { decoded: false, error: error.message };
  }
  const report = {
    status: "PARTIAL_WITH_NATIVE_DEMO_LIMITS",
    at: new Date().toISOString(),
    version: last.version, versionCode: last.versionCode, nativeApkSha256: last.installedSha,
    serial: last.serial, avd: last.avd, api: last.api, currentPid: last.pid,
    baselineSince: last.since, pidReset: false,
    newFatal: actions.flatMap(item => item.newFatal ?? []),
    actionRecords: actions.length,
    uiActions: actions.filter(item => ["tap", "swipe", "back", "text"].includes(item.action)).length,
    identityVerifiedEveryRecordedAction: actions.every(item => item.installedSha === last.installedSha && item.pid === last.pid && item.stable),
    checks: {
      loginTopBottomNoTechnicalGatewayCheckOrQr: "PASS_VISUAL",
      independentDemoButton: "PASS",
      actualDocumentsUiMixedTwoSelection: "PASS",
      twoUnsavedFilesAndSaveTwo: "PASS",
      fixedCameraGalleryFilesAndSaveWhileOverflowScroll: "PASS_VISUAL",
      filesReturnExactChecklistStepOne: "PASS",
      confirmedDemoFileSave: "NOT_PASSED_TWO_REQUIRE_REVIEW",
      twoConfirmedAnswersThenCatalogResumeNextPending: "NOT_COMPLETED_EXISTING_DEMO_ANSWER_MARKED_QUEUED_ZERO_OF_FOUR",
      galleryPicker: "NOT_TESTED",
      camera: "NOT_TESTED"
    },
    actualFinalState: { work: "TR-01001", checklist: "Inspeccion hidraulica", step: 1, steps: 5, requiredConfirmed: 0, requiredTotal: 4, filesUnsaved: 0, filesPending: 2, filesRequireReview: 2, checklistConfirmedFiles: 0 },
    observedIssue: "File workspace heading says 2 confirmados / 2 en cola, but save notice says 0 confirmed and both individual files require review. Checklist correctly says 0 confirmed, 2 pending. Cause not investigated; no runtime fix. PNG fixture failed independent decoder validation, so unavailable PNG preview is NOT evidence of an application defect; valid-image end-to-end save remains untested.",
    priorDemo: "After pre-existing update, login appeared normally. Existing demo answer Si is marked En cola with 0/4 confirmed; old in-memory demo confirmations may reset across updates. No session migration loss inferred, no storage cleared or logout performed.",
    pngValidation,
    limits: ["Stopped at bounded smoke scope; no claim of two confirmed answers or native 20/47 resume", "No confirmed demo attachment receipt claimed", "No gallery/camera/physical OEM validation", "No source, APK, version, provenance or delivery documentation changes", "No real login, credentials, business API mutations, storage inspection or deletion", "Existing JS/type suites not rerun", "Two unique synthetic Downloads files and new demo queue entries retained"],
    screens: actions.map(item => ({ label: item.label, file: item.screen })),
    keyScreens: ["01-current.png", "02-login-bottom.png", "09-checklist.png", "14-two-selected.png", "16-batch-ready.png", "19-save-result.png", "20-saved-scroll.png", "21-return-same-step.png"]
  };
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  const summary = `# Native APK 1.0.4 / code 5 - validacion parcial\n\n` +
    `- APK instalado SHA-256: ${report.nativeApkSha256}\n- AVD: ${report.avd}; ${report.serial}; API ${report.api}\n- PID ${report.currentPid}, sin reinicio. Nuevos fatales: ${report.newFatal.length}.\n- ${report.actionRecords} registros con identidad comprobada; ${report.uiActions} acciones UI.\n\n` +
    `## Confirmado visualmente\n\nLogin superior/inferior sin pasarela tecnica, Comprobar ni QR; boton Explorar demostracion presente y funcional. DocumentsUI real: seleccion conjunta de PNG+PDF, 2 selected, regreso con 2 sin guardar y Guardar 2. Camara/Galeria/Archivos y Guardar permanecen fijos mientras la lista guardada desborda y se desplaza. Regreso a Checklist conserva paso 1 de 5, TR-01001.\n\n` +
    `## Limites y resultado real\n\nGuardar transfirio dos archivos a la cola demo: 0 sin guardar, 2 pendientes / 2 por revisar, NO dos confirmaciones exitosas. Inconsistencia visible: encabezado de Archivos dice 2 confirmados y 2 en cola, aviso dice 0 confirmado(s), y cada archivo indica Requiere revision. Checklist correctamente muestra 0 confirmados y 2 sin confirmar. No se repitio envio ni se elimino copia.\n\n` +
    `La respuesta demo previa Si ya estaba En cola, con 0/4 requisitos confirmados. No se completo el escenario dos respuestas confirmadas -> Catalogo -> siguiente pendiente. Estado demo transitorio tras actualizacion NO prueba perdida de sesion ni migracion defectuosa. No se borraron datos, no logout, no reinicio necesario. Galeria y camara no ejecutadas. PNG decodificado por sharp: ${pngValidation.decoded}; revisar report.json para detalle. El PNG sintetico fallo la decodificacion independiente: su vista previa no disponible NO demuestra defecto de la app. Falta repetir con PNG valido; no se reemplaza la evidencia ya capturada ni el archivo en cola.\n\n` +
    `## Evidencia\n\n${report.keyScreens.map(name => `- [${name}](${name})`).join("\n")}\n\n[Reporte JSON](report.json). Solo scripts de testing y artifacts nuevos; sin build, runtime, APK, provenance, documentacion de entrega, credenciales o escrituras de negocio reales. Suites previas no repetidas.\n`;
  fs.writeFileSync(path.join(output, "SUMMARY.md"), summary);
  console.log(JSON.stringify({ report: path.join(output, "report.json"), actions: report.actionRecords, uiActions: report.uiActions, newFatal: report.newFatal, pngValidation }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");

const directGroupReview = process.argv.includes("--direct-group-review");
const legacyReview = directGroupReview || process.argv.includes("--legacy-document-review");
const legacyError = directGroupReview ? "OFFLINE_DOCUMENT_UNEXPECTED_ERROR" : "OFFLINE_SYNC_UNEXPECTED_RESPONSE";
const legacyAttempts = directGroupReview ? 2 : 1;
const artifacts = mkdtempSync(path.join(tmpdir(), directGroupReview ? "qualitzer-direct-group-review-" : legacyReview ? "qualitzer-legacy-review-" : "qualitzer-offline-smoke-"));
const resultPath = path.join(artifacts, "results.json");
const trace = [];
function report(label, value) { trace.push({ label, value }); console.log(label, JSON.stringify(value ?? {})); }

const root = path.resolve(__dirname, "../..");
const playwright = require(process.env.OFFLINE_SMOKE_PLAYWRIGHT || require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const gateway = "http://localhost:8788";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=", "base64");
const photoHash = createHash("sha256").update(png).digest("hex");
const title = "OFFLINE SMOKE nuevo trabajo";
const comment = "OFFLINE SMOKE comentario durable sin producción";
async function control(value) {
  const response = await fetch(`${gateway}/__offline_test__/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), redirect: "error", signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
}
async function metrics() {
  const result = await (await fetch(`${gateway}/__offline_test__/state`, { redirect: "error", signal: AbortSignal.timeout(5000) })).json();
  assert.equal(result.fixture, "isolated-offline-smoke-v1");
  return result;
}
async function database(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("qualitzer-offline-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const read = (name) => new Promise((resolve, reject) => { const request = db.transaction(name, "readonly").objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const states = (await read("states")).map((item) => JSON.parse(item));
    const blobs = await Promise.all((await read("blobs")).map(async (item) => ({ namespace: item.namespace, bytes: item.blob.size, sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await item.blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("") })));
    db.close();
    return { states, blobs };
  });
}
async function until(read, predicate, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
async function verifyPhoto(page) {
  await page.getByRole("button", { name: "Abrir copia local", exact: true }).first().click();
  await page.getByRole("button", { name: "Cerrar imagen", exact: true }).waitFor();
  await until(() => page.locator("img").evaluateAll((images) => images.some((image) => image.src.startsWith("blob:") && image.complete && image.naturalWidth > 0)), Boolean, "restored local PNG decodes");
  await page.getByRole("button", { name: "Cerrar imagen", exact: true }).click();
  await page.getByRole("button", { name: "Cerrar imagen", exact: true }).waitFor({ state: "hidden" });
}
async function selectAssignmentView(page, name) {
  const viewTab = page.getByRole("tab", { name });
  const agendaListTab = page.getByRole("tab", { name: "Lista de agenda", exact: true });
  await viewTab.or(agendaListTab).first().waitFor();
  if (!await viewTab.isVisible()) await agendaListTab.click();
  await viewTab.click();
}
async function openDocumentFiles(page) {
  if (directGroupReview) {
    await selectAssignmentView(page, /^OTs(?:,|$)/);
    await page.getByRole("textbox", { name: "Buscar tareas", exact: true }).fill(title);
    await page.getByRole("button", { name: "Archivos de la asignación", exact: true }).click();
    await page.getByText("Detalle de asignación", { exact: true }).waitFor();
  } else {
    await page.getByText(title, { exact: true }).last().click();
    await page.getByRole("tab", { name: "Archivos", exact: true }).click();
  }
}
async function closeDocumentFiles(page) {
  if (directGroupReview) {
    await page.getByRole("button", { name: "Volver a mis asignaciones", exact: true }).click();
    await selectAssignmentView(page, /^Trabajos(?:,|$)/);
    await page.getByRole("textbox", { name: "Buscar tareas", exact: true }).fill("");
  } else await page.getByRole("button", { name: "Volver conservando el borrador", exact: true }).click();
}
async function seedLegacyReview(page, queued) {
  const original = queued.states.flatMap((state) => state.operations).find((op) => op.kind === "document");
  assert.ok(original && original.status === "pending" && !original.receipt);
  assert.equal((await metrics()).receipts.length, 0);
  assert.equal((await metrics()).requests.filter((req) => req.method === "POST" && req.path === "/api/offline/documents").length, 0);
  if (directGroupReview) {
    assert.ok(original.scope.groupId.startsWith("local-"));
    assert.equal(Object.hasOwn(original.scope, "workId"), false, "Real group-level UI must enqueue root scope");
    assert.equal(original.stepId, undefined);
  }
  await page.goto("http://localhost:8081/__offline_fixture_seed");
  await page.evaluate(async ({ operationId, errorCode, attempts }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("qualitzer-offline-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("states", "readwrite");
        let changed = 0;
        tx.oncomplete = () => changed === 1 ? resolve() : reject(new Error("Expected exactly one isolated document"));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error("Legacy fixture mutation refused"));
        const cursor = tx.objectStore("states").openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          const state = JSON.parse(item.value);
          const op = state.operations.find((entry) => entry.id === operationId);
          if (op) {
            if (op.kind !== "document" || op.status !== "pending" || op.receipt || !state.passports.every((passport) => passport.user.tenant?.id === "offline-smoke")) { tx.abort(); return; }
            op.status = "needs_review"; op.lastError = errorCode; op.attempts = attempts;
            state.revision++; state.lease = null; item.update(JSON.stringify(state)); changed++;
          }
          item.continue();
        };
      });
    } finally { db.close(); }
  }, { operationId: original.id, errorCode: legacyError, attempts: legacyAttempts });
  const seeded = await database(page);
  const document = seeded.states.flatMap((state) => state.operations).find((op) => op.id === original.id);
  assert.deepEqual(document, { ...original, status: "needs_review", lastError: legacyError, attempts: legacyAttempts });
  assert.deepEqual(seeded.blobs, queued.blobs);
  assert.deepEqual(seeded.states.flatMap((state) => state.operations).filter((op) => op.id !== original.id), queued.states.flatMap((state) => state.operations).filter((op) => op.id !== original.id));
  report("LEGACY_DOCUMENT_REVIEW_SEEDED", { directGroupReview, syntheticErrorOnly: true, id: document.id, status: document.status, lastError: document.lastError, attempts: document.attempts, scope: document.scope, receipt: document.receipt ?? null, file: document.file });
  await page.goto("http://localhost:8081");
  await page.getByRole("button", { name: "Crear trabajo, mantenimiento o tiempo no productivo", exact: true }).waitFor();
  await openDocumentFiles(page);
  await page.getByText("offline-smoke.png", { exact: true }).first().waitFor();
  await verifyPhoto(page);
  await page.screenshot({ path: path.join(artifacts, "legacy-reloaded-offline.png") });
  await closeDocumentFiles(page);
  if (directGroupReview) {
    await page.getByTestId("connection-status-bar").getByRole("button").first().click();
    await page.getByText(new RegExp(legacyError)).waitFor();
    for (const details of await page.getByRole("button", { name: "Ver detalles técnicos", exact: true }).all()) await details.click();
    await page.getByText(/2 intento\(s\)/).waitFor();
    await page.screenshot({ path: path.join(artifacts, "direct-group-legacy-two-attempts.png"), fullPage: true });
    await page.getByRole("button", { name: "Volver", exact: true }).click();
  }
  assert.equal((await metrics()).effects.documents, 0);
}
async function main() {
  assert.equal(Number(process.versions.node.split(".")[0]), 22, "Use project-local Node 22");
  assert.deepEqual((await metrics()).effects, { creations: 0, comments: 0, answers: 0, documents: 0 }, "Start a fresh isolated fixture before each run");
  await control({ offline: false, loseNext: null });
  const browser = await playwright.chromium.launch({ channel: process.env.OFFLINE_SMOKE_BROWSER_CHANNEL || "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CL", serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const blocked = new Set();
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://localhost:8081" && url.pathname === "/__offline_fixture_seed") return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Isolated legacy fixture seed</title>" });
    if (["blob:", "data:"].includes(url.protocol) || ["http://localhost:8081", gateway].includes(url.origin)) return route.continue();
    blocked.add(url.origin);
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (new URL(socket.url()).origin === "ws://localhost:8081") socket.connectToServer();
    else { blocked.add(new URL(socket.url()).origin); socket.close(); }
  });
  try {
    await page.goto("http://localhost:8081");
    await page.getByRole("button", { name: "Conexión avanzada. Configurar pasarela móvil" }).click();
    await page.getByRole("textbox", { name: "URL de la pasarela" }).fill(gateway);
    await page.getByRole("textbox", { name: "Correo o usuario", exact: true }).fill("offline-fixture");
    await page.getByRole("textbox", { name: "Contraseña", exact: true }).fill("fictional-offline-only");
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await page.getByText("Inspección del sistema hidráulico", { exact: true }).first().waitFor();
    report("LOGIN_AND_ASSIGNMENTS_OK", { visibility: await page.evaluate(() => document.visibilityState) });
    await page.getByRole("button", { name: /^Conectado a Qualitzer ·/ }).click();
    await page.getByRole("button", { name: "Preparar este período", exact: true }).click();
    await until(() => database(page), (db) => db.states.some((state) => state.cache.some((entry) => entry.key.startsWith("options:")) && state.cache.filter((entry) => entry.coverage).length >= 7), "cache seven days + options");
    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await control({ offline: true });
    await page.reload();
    await page.getByRole("button", { name: "Crear trabajo, mantenimiento o tiempo no productivo", exact: true }).waitFor();
    report("COLD_RESTORE_OFFLINE_OK");
    await page.getByRole("button", { name: "Crear trabajo, mantenimiento o tiempo no productivo", exact: true }).click();
    await page.getByRole("button", { name: "Nuevo trabajo", exact: true }).click();
    await page.getByRole("textbox", { name: "Título *", exact: true }).fill(title);
    await page.getByRole("textbox", { name: "Resumen del trabajo *", exact: true }).fill("Fixture seguro: crear, guardar foto, reiniciar y reconciliar sin pérdidas.");
    await page.getByRole("button", { name: "Continuar a horario", exact: true }).click();
    await page.getByRole("textbox", { name: "Hora de inicio *", exact: true }).fill("17:00");
    await page.getByRole("textbox", { name: "Hora de fin *", exact: true }).fill("18:00");
    await page.getByRole("button", { name: "Revisar creación", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar y crear", exact: true }).click();
    await page.getByRole("button", { name: "Ver trabajo local", exact: true }).waitFor();
    assert.equal((await metrics()).effects.creations, 0);
    await page.getByRole("button", { name: "Ver trabajo local", exact: true }).click();
    await page.getByRole("tab", { name: "Archivos", exact: true }).waitFor();
    const localBody = await page.locator("body").innerText();
    assert.doesNotMatch(localBody, /TR-local-|Creación confirmada|Tu planificación está lista/);
    assert.equal(await page.getByRole("button", { name: "Iniciar trabajo", exact: true }).count(), 0);
    report("OFFLINE_CREATION_OK");
    if (directGroupReview) {
      await page.getByRole("button", { name: "Volver conservando el borrador", exact: true }).click();
      await openDocumentFiles(page);
    } else await page.getByRole("tab", { name: "Archivos", exact: true }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Galería", exact: true }).click();
    await (await chooserPromise).setFiles({ name: "offline-smoke.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Guardar archivos · 1", exact: true }).click();
    const withPhoto = await until(() => database(page), (db) => db.states.flatMap((state) => state.operations).some((operation) => operation.kind === "document"), "photo queued");
    assert.equal(withPhoto.blobs.length, 1);
    assert.equal(withPhoto.blobs[0].sha256, photoHash);
    assert.equal((await metrics()).effects.documents, 0);
    report("PHOTO_DURABLE_OK", withPhoto.blobs);
    await closeDocumentFiles(page);
    await page.getByText("Inspección del sistema hidráulico", { exact: true }).last().click();
    await page.getByRole("tab", { name: "Comentarios", exact: true }).click();
    await page.getByRole("textbox", { name: "Comentario", exact: true }).fill(comment);
    await page.getByRole("button", { name: "Guardar comentario · sincronizar", exact: true }).click();
    await until(() => database(page), (db) => db.states.flatMap((state) => state.operations).some((operation) => operation.kind === "comment" && operation.text === comment), "comment queued");
    assert.equal(await page.getByText("Comentario publicado.", { exact: true }).count(), 0);
    await page.getByRole("tab", { name: "Checklist", exact: true }).click();
    await page.getByRole("button", { name: "Abrir CHK-HID-01: Inspección hidráulica", exact: true }).click();
    await page.getByRole("radio", { name: "Sí", exact: true }).click();
    await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).fill("OFFLINE SMOKE respuesta durable");
    await page.getByRole("button", { name: "Guardar respuesta", exact: true }).click();
    const queued = await until(() => database(page), (db) => db.states.flatMap((state) => state.operations).length === 4, "four offline operations");
    assert.ok(queued.states.flatMap((state) => state.operations).every((operation) => operation.status === "pending"));
    assert.equal(await page.getByText("Envío confirmado. El progreso se calcula con la ficha recibida, no con el borrador.", { exact: true }).count(), 0);
    await page.getByText("Procesando… Espera la confirmación antes de realizar otra acción.", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByText("0 de 4 respuestas obligatorias con requisitos confirmados · 0%", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Pausar trabajo", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Entregar trabajo", exact: true }).isEnabled(), true);
    await page.getByRole("button", { name: "Entregar trabajo", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Confirmar y entregar", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Seguir trabajando", exact: true }).click();
    report("FOUR_PENDING_OK", queued.states.flatMap((state) => state.operations).map(({ id, kind, status }) => ({ id, kind, status })));
    await page.getByRole("button", { name: "Volver conservando el borrador", exact: true }).click();
    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await page.getByRole("button", { name: "Comprobar pendientes y cerrar sesión", exact: true }).click();
    await page.getByText(/pendientes.*sincroniz|sincroniz.*pendientes/i).first().waitFor();
    assert.equal((await metrics()).logoutCalls, 0);
    await page.reload();
    await openDocumentFiles(page);
    await page.getByText("offline-smoke.png", { exact: true }).first().waitFor();
    const restored = await database(page);
    assert.deepEqual(restored.blobs, queued.blobs);
    assert.deepEqual(restored.states.flatMap((state) => state.operations).map((op) => [op.id, op.kind, op.status]), queued.states.flatMap((state) => state.operations).map((op) => [op.id, op.kind, op.status]));
    await verifyPhoto(page);
    await closeDocumentFiles(page);
    await page.getByText("Inspección del sistema hidráulico", { exact: true }).last().click();
    await page.getByRole("tab", { name: "Comentarios", exact: true }).click();
    await page.getByText(comment, { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Checklist", exact: true }).click();
    if (await page.getByRole("button", { name: "Abrir CHK-HID-01: Inspección hidráulica", exact: true }).count()) await page.getByRole("button", { name: "Abrir CHK-HID-01: Inspección hidráulica", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Comentario del paso (opcional)", exact: true }).inputValue(), "OFFLINE SMOKE respuesta durable");
    report("RELOAD_PENDING_BLOB_OK");
    await page.getByRole("button", { name: "Volver conservando el borrador", exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, "queued-restored.png") });
    if (legacyReview) await seedLegacyReview(page, queued);
    await page.getByText(title, { exact: true }).last().click();
    await control({ offline: false, loseNext: "document" });
    await page.bringToFront();
    assert.equal(await page.evaluate(() => document.visibilityState), "visible");
    const lost = await until(metrics, (state) => state.lostResponses === 1, "automatic foreground sync commits document then loses response", 45000);
    if (directGroupReview) {
      assert.equal(lost.effects.creations, 1); assert.equal(lost.effects.documents, 1);
      assert.ok([0, 1].includes(lost.effects.comments) && [0, 1].includes(lost.effects.answers), "Independent operations may finish while the document waits for its confirmed parent");
    } else assert.deepEqual(lost.effects, { creations: 1, comments: 0, answers: 0, documents: 1 });
    const uncertain = await until(() => database(page), (db) => db.states.flatMap((state) => state.operations).some((op) => op.kind === "document" && op.status === "pending" && op.attempts === (legacyReview ? legacyAttempts + 1 : 1)), "ambiguous document remains pending");
    assert.deepEqual(uncertain.blobs, queued.blobs);
    const startButton = page.getByRole("button", { name: "Iniciar trabajo", exact: true });
    assert.ok(await startButton.count() === 0 || await startButton.isDisabled(), "No execution without fresh canonical work after creation receipt");
    await page.reload();
    await page.getByRole("button", { name: "Crear trabajo, mantenimiento o tiempo no productivo", exact: true }).waitFor();
    assert.deepEqual((await database(page)).blobs, queued.blobs);
    report("LOST_RESPONSE_RELOAD_OK", { effects: lost.effects, upload: lost.uploads[0] });
    await control({ offline: false });
    const finalDb = await until(() => database(page), (db) => { const ops = db.states.flatMap((state) => state.operations); return ops.length === 4 && ops.every((op) => op.status === "applied"); }, "automatic recovery applies exactly four operations", 45000);
    const finalMetrics = await metrics();
    assert.deepEqual(finalMetrics.effects, { creations: 1, comments: 1, answers: 1, documents: 1 });
    assert.deepEqual(finalDb.blobs, queued.blobs);
    assert.equal(finalMetrics.uploads[0].sha256, photoHash);
    assert.equal(finalMetrics.uploads[0].bytes, png.length);
    assert.equal(finalMetrics.uploads[0].workId, 20001);
    assert.equal(finalMetrics.uploads[0].groupId, "direct-20001");
    const operations = finalDb.states.flatMap((state) => state.operations);
    const document = operations.find((op) => op.kind === "document");
    const originalDocument = queued.states.flatMap((state) => state.operations).find((op) => op.kind === "document");
    assert.equal(document.id, originalDocument.id);
    assert.deepEqual(document.file, originalDocument.file, "Immutable file ID, namespace, name, MIME, size and SHA survive recovery");
    assert.deepEqual(document.scope, originalDocument.scope);
    assert.equal(document.dependencyId, originalDocument.dependencyId);
    assert.equal(document.sourceDraftId, originalDocument.sourceDraftId);
    assert.equal(document.receipt.fileId, finalMetrics.uploads[0].fileId);
    assert.ok(finalDb.states.some((state) => state.attachments.some((attachment) => attachment.attachmentId === String(document.receipt.fileId))));
    if (directGroupReview) {
      assert.equal(Object.hasOwn(document.scope, "workId"), false);
      const binding = finalDb.states.flatMap((state) => state.attachments).find((attachment) => attachment.attachmentId === String(document.receipt.fileId));
      assert.equal(binding.scope.groupId, "direct-20001");
      assert.equal(Object.hasOwn(binding.scope, "workId"), false, "UI attachment binding remains group-level");
    }
    const documentPosts = finalMetrics.requests.filter((req) => req.method === "POST" && req.path === "/api/offline/documents");
    assert.equal(documentPosts.length, 2, "Lost response requires same-payload POST confirmation, not GET-only acknowledgement");
    assert.ok(documentPosts.every((req) => req.operationId === document.id));
    assert.ok(finalMetrics.requests.some((req) => req.path === `/api/offline/receipts/${document.id}`));
    assert.deepEqual(finalMetrics.receipts.find((receipt) => receipt.operationId === document.id), document.receipt);
    const firstDocumentPost = finalMetrics.requests.findIndex((req) => req.path === "/api/offline/documents");
    assert.ok(finalMetrics.requests.slice(0, firstDocumentPost).some((req) => req.method === "GET" && req.path === `/api/offline/receipts/${document.id}`), "Receipt GET precedes first same-UUID POST");
    for (let round = 1; round <= 2; round++) {
      await control({ offline: true });
      await page.reload();
      await page.getByRole("button", { name: "Crear trabajo, mantenimiento o tiempo no productivo", exact: true }).waitFor();
      await control({ offline: false });
      await page.reload();
      await page.getByText(title, { exact: true }).last().waitFor();
      await until(() => page.getByRole("button", { name: /^Conectado a Qualitzer ·/ }).count(), (count) => count > 0, "online after repeated cold restore");
      assert.deepEqual((await metrics()).effects, finalMetrics.effects);
      assert.deepEqual((await database(page)).blobs, queued.blobs);
      report(`RECONNECT_ROUND_${round}_NO_DUPLICATES_OK`);
    }
    await openDocumentFiles(page);
    await page.getByText("offline-smoke.png", { exact: true }).first().waitFor();
    await verifyPhoto(page);
    await page.screenshot({ path: path.join(artifacts, "recovered-file.png") });
    const afterReloads = await metrics();
    assert.equal(afterReloads.requests.filter((req) => req.path === "/api/creation" && req.method === "POST").length, 1);
    assert.equal(afterReloads.requests.filter((req) => req.path === "/api/offline/commands" && req.method === "POST").length, 2);
    assert.equal(afterReloads.requests.filter((req) => req.path === "/api/offline/documents" && req.method === "POST").length, 2);
    assert.equal(afterReloads.logoutCalls, 0);
    assert.deepEqual(errors, []);
    report("OFFLINE_SMOKE_PASS", { legacyReview, directGroupReview, browser: browser.version(), effects: afterReloads.effects, lostResponses: afterReloads.lostResponses, logoutCalls: afterReloads.logoutCalls, operations: operations.map(({ id, kind, status, receipt, result }) => ({ id, kind, status, receipt, result })), uploads: afterReloads.uploads, photoHash, photoBytes: png.length, blobsRetained: finalDb.blobs.length, blockedOrigins: [...blocked] });
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, "failure.png") }).catch(() => undefined);
    report("OFFLINE_SMOKE_FAIL", { error: error.stack, ui: await page.locator("body").innerText(), browserErrors: errors });
    console.error("OFFLINE_SMOKE_FAIL", error.stack);
    console.error("UI_SNAPSHOT", await page.locator("body").innerText());
    console.error("BROWSER_ERRORS", JSON.stringify(errors));
    throw error;
  } finally {
    writeFileSync(resultPath, JSON.stringify(trace, null, 2));
    console.log("RESULT_FILE", resultPath);
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
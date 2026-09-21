const assert = require("node:assert/strict");
const { test } = require("node:test");
const { fileHarness } = require("./helpers/compact-files.cjs");

for (const platform of ["web", "android"]) {
  test(`${platform}: mixed batch + second batch append with independent IDs; cancel preserves files`, async () => {
    const f = fileHarness(platform); const store = await f.store();
    await store.addFiles([f.asset("one.png"), f.asset("manual.pdf"), f.asset("camera.jpg", 120, "image/jpeg")]);
    const original = store.getSnapshot().files.map((file) => ({ ...file }));
    await store.addFiles([f.asset("two.png"), f.asset("three.pdf"), f.asset("one.png")]);
    assert.equal(store.getSnapshot().files.length, 6);
    assert.deepEqual(store.getSnapshot().files.slice(0, 3), original);
    assert.equal(new Set(store.getSnapshot().files.map((file) => file.id)).size, 6);
    assert.deepEqual(await f.pickWorkspaceFiles("document", 94), []);
    assert.equal(store.getSnapshot().files.length, 6);
  });
  test(`${platform}: per-file, aggregate and count limits reject entire new batch without losing previous files`, async () => {
    const f = fileHarness(platform); const store = await f.store();
    await store.addFiles([f.asset("existing.png")]);
    const original = store.getSnapshot().files;
    await assert.rejects(store.addFiles([f.asset("valid.png"), f.asset("oversize.pdf", f.MAX_FILE_BYTES + 1)]), /25/);
    assert.equal(store.getSnapshot().files, original);
    await assert.rejects(store.addFiles([f.asset("a.pdf", f.MAX_FILE_BYTES), f.asset("b.pdf", f.MAX_FILE_BYTES)]), /40/);
    await assert.rejects(store.addFiles(Array.from({ length: 100 }, () => f.asset("tiny.png"))), /100/);
    await assert.rejects(store.addFiles([f.asset("bad.svg", 10, "image/svg+xml")]), /formato no admitido/);
    assert.equal(store.getSnapshot().files, original);
  });
  test(`${platform}: sequential partial success, stable retry and no resubmit after confirmation`, async () => {
    const f = fileHarness(platform); const store = await f.store();
    await store.addFiles([f.asset("one.png"), f.asset("two.pdf"), f.asset("three.jpg", 100, "image/jpeg")]);
    const selected = [...store.getSnapshot().files]; const calls = [];
    const result = await f.save(store, async (files) => { assert.equal(files.length, 1); calls.push(files[0]); if (files[0].id === selected[1].id) throw new Error("fixture failure"); });
    assert.equal(result.saved, 1); assert.match(result.failure, /fixture failure/);
    assert.deepEqual(store.getSnapshot().files, selected.slice(1));
    assert.equal(f.revoked.includes(selected[1].uri), false);
    const retry = await f.save(store, async (files) => { calls.push(files[0]); });
    assert.equal(retry.saved, 2); assert.equal(retry.failure, null);
    assert.deepEqual(calls.map((file) => file.id), [selected[0].id, selected[1].id, selected[1].id, selected[2].id]);
    await f.save(store, async () => { throw new Error("MUST_NOT_RESUBMIT"); });
    assert.equal(store.getSnapshot().files.length, 0);
  });
  test(`${platform}: automatic save targets only the newly selected batch and retains older uncertain drafts`, async () => {
    const f = fileHarness(platform); const store = await f.store();
    await store.addFiles([f.asset("older-uncertain.png")]);
    const original = store.getSnapshot().files[0];
    await store.addFiles([f.asset("new.png"), f.asset("new.pdf")]);
    const added = store.getSnapshot().files.filter(file => file.id !== original.id);
    const sent = [];
    const result = await f.save(store, async files => { sent.push(files[0].id); }, { fileIds: added.map(file => file.id) });
    assert.deepEqual(sent, added.map(file => file.id));
    assert.equal(result.saved, 2); assert.equal(result.queued, 0); assert.equal(result.failure, null);
    assert.deepEqual(store.getSnapshot().files, [original]);
    await f.save(store, async () => assert.fail("NO_REPLAY"), { fileIds: added.map(file => file.id) });
    assert.deepEqual(store.getSnapshot().files, [original]);
  });
  test(`${platform}: queued ownership differs from confirmed; plain failure never permits cleanup`, async () => {
    const f = fileHarness(platform); const store = await f.store();
    await store.addFiles([f.asset("queued.pdf"), f.asset("confirmed.png"), f.asset("remain.pdf")]);
    let index = 0;
    const result = await f.save(store, async () => {
      index++;
      if (index === 1) throw new f.OfflineQueuedError({ operationId: "11111111-1111-4111-8111-111111111111", operationIds: ["11111111-1111-4111-8111-111111111111"], kind: "document", date: "2026-09-11", ownsFiles: true });
      if (index === 3) throw new Error("AUTH_REQUIRED");
    });
    assert.equal(result.saved, 1); assert.equal(result.queued, 1);
    assert.equal(store.getSnapshot().files[0].name, "remain.pdf");
  });
  test(`${platform}: destination change stops batch and observers cannot roll back durable selection`, async () => {
    const f = fileHarness(platform); const store = await f.store();
    store.subscribe(() => { throw new Error("OBSERVER"); });
    await store.addFiles([f.asset("first.png"), f.asset("second.pdf")]);
    let sameScope = true;
    const result = await f.save(store, async () => { sameScope = false; }, { canContinue: () => sameScope });
    assert.equal(result.saved, 1); assert.match(result.failure, /detenido/);
    assert.equal(store.getSnapshot().files[0].name, "second.pdf");
    const other = await f.store("other:branch:work:step");
    assert.equal(other.getSnapshot().files.length, 0);
  });
}

test("native durable batch rollback, restore and sent marker protect against cleanup failure", async () => {
  const f = fileHarness("android"); const store = await f.store();
  await store.addFiles([f.asset("original.pdf")]);
  f.control.failCopy = true;
  await assert.rejects(store.addFiles([f.asset("broken.png")]), /COPY_FAILED/);
  f.control.failCopy = false;
  const restored = await f.store();
  assert.deepEqual(restored.getSnapshot().files, store.getSnapshot().files);
  const result = await f.save(store, async () => { f.control.failWrite = true; });
  assert.equal(result.saved, 1); assert.ok(result.failure);
  assert.equal(store.getSnapshot().files[0].uploaded, true);
  f.control.failWrite = false;
  const reopened = await f.store();
  assert.equal(reopened.getSnapshot().files[0].uploaded, true);
  assert.equal((await f.save(reopened, async () => { throw new Error("NO_REPLAY"); })).saved, 0);
});

test("Expo selectors request multi-image/mixed files without base64; repeated camera remains single", async () => {
  const f = fileHarness();
  const photo = f.asset("photo.png");
  f.control.result = { canceled: false, assets: [{ uri: photo.uri, fileName: photo.name, fileSize: photo.size, mimeType: photo.mimeType, file: photo.blob }] };
  assert.equal((await f.pickWorkspaceFiles("library", 90)).length, 1);
  await f.pickWorkspaceFiles("camera", 90); await f.pickWorkspaceFiles("camera", 89);
  f.control.result = { canceled: false, assets: [f.asset("a.png"), f.asset("a.pdf"), f.asset("b.png")].map((file) => ({ ...file, file: file.blob })) };
  assert.equal((await f.pickWorkspaceFiles("document", 90)).length, 3);
  const library = f.pickerCalls[0].options;
  assert.equal(library.allowsMultipleSelection, true); assert.equal(library.selectionLimit, 90); assert.equal(library.allowsEditing, false); assert.notEqual(library.base64, true);
  assert.equal(f.pickerCalls[1].options.allowsMultipleSelection, undefined);
  const documents = f.pickerCalls[3].options;
  assert.equal(documents.multiple, true); assert.equal(documents.base64, false); assert.equal(documents.copyToCacheDirectory, true);
  assert.ok(documents.type.includes("application/pdf") && documents.type.includes("image/png"));
});

test("exact byte boundaries are accepted; one extra byte is refused without eviction", async () => {
  const f = fileHarness(); const store = await f.store();
  await store.addFiles([f.asset("max.pdf", f.MAX_FILE_BYTES), f.asset("rest.pdf", f.MAX_FILES_BYTES - f.MAX_FILE_BYTES)]);
  assert.equal(store.getSnapshot().files.reduce((total, file) => total + file.size, 0), 40 * 1024 * 1024);
  await assert.rejects(store.addFiles([f.asset("one-byte.png", 1)]), /40/);
  assert.equal(store.getSnapshot().files.length, 2);
});
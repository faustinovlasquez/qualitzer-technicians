import test from "node:test";
import assert from "node:assert/strict";
import { materialReceiptInputSchema, materialReceiptsSchema, verifyMaterialReceiptResult, type MaterialReceiptInput, type MaterialReceiptResult } from "../src/domain/materialReceipts";
import { notificationDataSchema } from "../src/domain/notifications";
import { prepareReceipt, settleReceipt } from "../src/receipts/receiptJournal";
import * as receiptDomain from "../src/domain/materialReceipts";
import * as receiptJournal from "../src/receipts/receiptJournal";
import * as errors from "../src/infrastructure/errors";
import { loadSource } from "./helpers/tenant-challenge";
import { agendaReactFixture } from "./helpers/agenda-load-lifecycle";
import { deferred } from "./helpers/durable-ui";

const input: MaterialReceiptInput = { companyBranchId: 1, requestId: "f14191fb-e73a-4d92-91b9-bf3fa38a2df1", deliveries: [{ id: 5, version: 2 }], client: "MOBILE", location: { status: "UNAVAILABLE", reason: "PERMISSION_DENIED" } };
const result: MaterialReceiptResult = { companyBranchId: 1, requestId: input.requestId, receipts: [{ id: 5, version: 3, acknowledgement: { requestId: input.requestId, userId: 9, confirmedAt: "2026-09-29T12:00:00.000Z", method: "AUTHENTICATED_RECIPIENT", client: "MOBILE", location: input.location } }] };

test("acceptance verifies actor, branch, exact targets and version", () => {
  verifyMaterialReceiptResult(input, result, 9);
  assert.throws(() => verifyMaterialReceiptResult(input, result, 10));
  assert.throws(() => verifyMaterialReceiptResult(input, { ...result, companyBranchId: 2 }, 9));
  assert.throws(() => verifyMaterialReceiptResult(input, { ...result, receipts: [] }, 9));
  assert.throws(() => verifyMaterialReceiptResult(input, { ...result, receipts: [{ ...result.receipts[0], version: 9 }] }, 9));
});
test("location absence is explicit; duplicates and forged actors are rejected", () => {
  assert.deepEqual(materialReceiptInputSchema.parse(input), input);
  assert.equal(materialReceiptInputSchema.safeParse({ ...input, userId: 10 }).success, false);
  assert.equal(materialReceiptInputSchema.safeParse({ ...input, deliveries: [...input.deliveries, ...input.deliveries] }).success, false);
  assert.equal(materialReceiptInputSchema.safeParse({ ...input, location: { status: "AVAILABLE", latitude: 0, longitude: 181, accuracy: 1, capturedAt: "2026-09-29T12:00:00Z" } }).success, false);
});
test("own receipt projection contains no commercial costs", () => {
  const receipt = { id: 5, version: 2, code: "CE-00000005", sourceLabel: "Mantenimiento", destination: "Taller", deliveredAt: null, receiptStatus: "PENDING", products: [{ id: 10, productId: 88, name: "Perno sustituto", code: "VC4898-B", quantity: 1, unit: "UN" }] };
  assert.equal(materialReceiptsSchema.parse({ items: [receipt], hasMore: false }).items[0].products[0].productId, 88);
  assert.equal(materialReceiptsSchema.safeParse({ items: [{ ...receipt, netCost: 100 }], hasMore: false }).success, false);
});
test("material notifications are owned neutral inbox links, not fake assignments", () => {
  const value = { tenantOrigin: "https://tenant.example", companyBranchId: 1, eventId: input.requestId, kind: "MATERIAL_RECEIPT_AVAILABLE", groupType: null, groupId: null, workId: null, date: null, recipient: { userId: 9, workerId: 15 } };
  assert.equal(notificationDataSchema.safeParse(value).success, true);
  assert.equal(notificationDataSchema.safeParse({ ...value, kind: "MATERIAL_RECEIPT_REMINDER" }).success, true);
  assert.equal(notificationDataSchema.safeParse({ ...value, workId: 12 }).success, false);
});

test("concurrent sessions recover one durable command and a late reply never deletes a newer command", async () => {
  let stored: string | null = null;
  const storage = { getItem: async () => stored, setItem: async (_key: string, value: string) => { stored = value; }, removeItem: async () => { stored = null; } };
  let creations = 0;
  const create = async () => { creations++; return input; };
  const [first, second] = await Promise.all([prepareReceipt(storage, "race", 1, create), prepareReceipt(storage, "race", 1, create)]);
  assert.equal(creations, 1);
  assert.deepEqual(first, second);
  const newer = { ...input, requestId: "a14191fb-e73a-4d92-91b9-bf3fa38a2df1" };
  stored = JSON.stringify(newer);
  assert.equal(await settleReceipt(storage, "race", input), false);
  assert.equal(stored, JSON.stringify(newer));
  assert.equal(await settleReceipt(storage, "race", newer), true);
  assert.equal(stored, null);
});

test("journal failures retain the previous intent and fail closed for corrupt or foreign data", async () => {
  let stored: string | null = JSON.stringify(input);
  const storage = { getItem: async () => stored, setItem: async () => { throw new Error("FULL"); }, removeItem: async () => { throw new Error("FULL"); } };
  assert.deepEqual(await prepareReceipt(storage, "recovery", 1, async () => { throw new Error("MUST_REPLAY"); }), input);
  await assert.rejects(settleReceipt(storage, "recovery", input), /FULL/);
  await assert.rejects(prepareReceipt(storage, "recovery", 2, async () => input), /SCOPE_MISMATCH/);
  stored = "invalid";
  await assert.rejects(prepareReceipt(storage, "recovery", 1, async () => input));
  stored = null;
  await assert.rejects(prepareReceipt(storage, "recovery", 1, async () => input), /FULL/);
});

let fixtureId = 0;
function receiptHookFixture() {
  const hooks = agendaReactFixture();
  const state = { allowed: true, token: "first", appState: "active" };
  const key = `hook-${++fixtureId}`;
  let stored: string | null = null;
  let data = receiptDomain.materialReceiptsSchema.parse({ hasMore: false, items: [{ id: 5, version: 2, code: "CE-5", sourceLabel: "Maintenance", destination: "Workshop", deliveredAt: null, receiptStatus: "PENDING", products: [] }] });
  const sends: receiptDomain.MaterialReceiptInput[] = [];
  let read = async () => data;
  let send = async (command: receiptDomain.MaterialReceiptInput) => {
    data = { items: [], hasMore: false };
    return { ...result, requestId: command.requestId, receipts: result.receipts.map(receipt => ({ ...receipt, acknowledgement: { ...receipt.acknowledgement, requestId: command.requestId } })) };
  };
  let capture = async () => input.location;
  const storage = { getItem: async () => stored, setItem: async (_key: string, value: string) => { stored = value; }, removeItem: async () => { stored = null; } };
  const port = { materialReceipts: () => read(), confirmMaterialReceipts: (command: receiptDomain.MaterialReceiptInput) => { sends.push(command); return send(command); } };
  const module = loadSource<typeof import("../src/receipts/useMaterialReceipts")>("receipts/useMaterialReceipts.ts", name => {
    if (name === "react") return hooks.react;
    if (name === "@react-native-async-storage/async-storage") return storage;
    if (name === "expo-crypto") return { randomUUID: () => input.requestId };
    if (name === "react-native") return { AppState: { get currentState() { return state.appState; }, addEventListener: () => ({ remove() {} }) } };
    if (name === "../domain/materialReceipts") return receiptDomain;
    if (name === "./receiptLocation") return { captureMaterialReceiptLocation: () => capture(), waitForActiveApp: async () => state.appState === "active" };
    if (name === "./receiptJournal") return receiptJournal;
    if (name === "../infrastructure/errors") return errors;
    throw new Error(name);
  }, { setInterval, clearInterval });
  const isAllowed = () => state.allowed;
  const render = () => hooks.render(() => module.useMaterialReceipts(port, 9, 1, key, state.token, state.allowed, isAllowed));
  async function flush() {
    let value = render(); hooks.commit();
    for (let turn = 0; turn < 5; turn++) { await new Promise<void>(resolve => setImmediate(resolve)); value = render(); hooks.commit(); }
    return value;
  }
  return { state, sends, render, flush, dispose: hooks.unmount, stored: () => stored, setRead: (next: typeof read) => { read = next; }, setSend: (next: typeof send) => { send = next; }, setCapture: (next: typeof capture) => { capture = next; } };
}

test("actual hook rejects double taps and ignores a pre-confirmation response", async context => {
  const fixture = receiptHookFixture(); context.after(fixture.dispose);
  const loaded = await fixture.flush();
  const stale = deferred<receiptDomain.MaterialReceipts>();
  fixture.setRead(() => stale.promise);
  const reading = loaded.refresh();
  const accepted = deferred<receiptDomain.MaterialReceiptResult>();
  fixture.setSend(() => accepted.promise);
  const confirming = loaded.confirm(loaded.data!.items);
  await fixture.flush();
  await loaded.confirm(loaded.data!.items);
  assert.equal(fixture.sends.length, 1);
  fixture.setRead(async () => ({ items: [], hasMore: false }));
  accepted.resolve(result); await confirming;
  stale.resolve(loaded.data!); await reading;
  assert.equal((await fixture.flush()).data!.items.length, 0);
  assert.equal(fixture.stored(), null);
});

test("actual hook retains ambiguous intent, replays it unchanged, and unlocks definitive conflicts", async context => {
  const fixture = receiptHookFixture(); context.after(fixture.dispose);
  let current = await fixture.flush();
  fixture.setSend(async () => { throw new Error("NETWORK_LOST"); });
  await current.confirm(current.data!.items); current = await fixture.flush();
  const stored = fixture.stored(); assert.ok(stored); assert.ok(current.pending);
  fixture.setSend(async () => { throw new errors.ApiError(409, "CONSUMPTION_VERSION_CONFLICT", "changed"); });
  await current.confirm([]); current = await fixture.flush();
  assert.equal(JSON.stringify(fixture.sends[0]), JSON.stringify(fixture.sends[1]));
  assert.equal(current.pending, null); assert.equal(fixture.stored(), null); assert.equal(current.busy, false);
});

test("actual hook cannot send after location resolves into a locked or changed session", async context => {
  const fixture = receiptHookFixture(); context.after(fixture.dispose);
  let current = await fixture.flush();
  const location = deferred<receiptDomain.MaterialReceiptLocation>(); fixture.setCapture(() => location.promise);
  const confirmation = current.confirm(current.data!.items);
  await fixture.flush(); fixture.state.allowed = false; current = await fixture.flush();
  location.resolve(input.location); await confirmation;
  assert.equal(fixture.sends.length, 0); assert.equal(fixture.stored(), null);
  const retained = current.confirm;
  fixture.state.allowed = true; fixture.state.token = "second"; current = await fixture.flush();
  await retained(current.data!.items);
  assert.equal(fixture.sends.length, 0);
});
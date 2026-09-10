import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { HttpTechnicianRepository } from "../../infrastructure/HttpTechnicianRepository";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { OfflineUnavailableError } from "../../domain/offline";
import type { OfflineDocumentMetadata } from "../../domain/offline";
import { uuid } from "./fakes";

const metadata: OfflineDocumentMetadata = { operationId: uuid(1), scope: { companyBranchId: 1, groupId: "direct-10", workId: "10", startDate: "2026-09-08", endDate: "2026-09-08" }, sha256: "a".repeat(64) };
const photo = { id: "draft", uri: "file:///private/offline/owned", name: "proof.pdf", mimeType: "application/pdf", size: 1 };

function repository(reply: () => Promise<{ status: number; ok: boolean; text(): Promise<string> }>) {
  const path = resolve(__dirname, "../../infrastructure/HttpTechnicianRepository.ts");
  const requireSource = createRequire(path);
  const exports: { HttpTechnicianRepository?: new (baseUrl: string) => HttpTechnicianRepository } = {};
  const module = { exports };
  let requests = 0;
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, {
    module, exports, FormData, Blob, AbortController, Error, TypeError, setTimeout, clearTimeout, URLSearchParams,
    require: (id: string): unknown => {
      if (id === "react-native") return { Platform: { OS: "android" } };
      if (id === "./photos") return {
        appendPhoto: async (body: FormData) => { body.append("files", new Blob([new Uint8Array([1])], { type: photo.mimeType }), photo.name); },
        uploadFetch: async () => { requests++; return reply(); },
      };
      return requireSource(id);
    },
  });
  assert.ok(module.exports.HttpTechnicianRepository);
  return { client: new module.exports.HttpTechnicianRepository("https://fixture.invalid"), requests: () => requests };
}

for (const message of ["Unsupported FormData implementation", "Unsupported FormDataPart implementation"]) test(`Expo ${message} receives a specific non-transport diagnosis`, async () => {
  const f = repository(async () => { throw new Error(message); });
  await assert.rejects(f.client.offlineDocument(metadata, photo), (error: unknown) => error instanceof OfflineUnavailableError && error.code === "OFFLINE_DOCUMENT_MULTIPART_UNSUPPORTED");
  assert.equal(f.requests(), 1);
});

test("native fetch transport failure remains typed and does not expose the original detail", async () => {
  const f = repository(async () => { throw new Error("fetch failed: private secret"); });
  await assert.rejects(f.client.offlineDocument(metadata, photo), (error: unknown) => error instanceof NetworkError && error.kind === "network" && !error.message.includes("secret"));
});

test("HTTP malformed receipt is not inferred from an envelope or reported as transport failure", async () => {
  const f = repository(async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ data: { operationId: uuid(1), state: "applied", fileId: 77 }, secret: "private" }) }));
  await assert.rejects(f.client.offlineDocument(metadata, photo), (error: unknown) => error instanceof ApiError && error.code === "OFFLINE_INVALID_RECEIPT" && !error.message.includes("private"));
});

test("HTTP receipt mismatch, in_progress and operation reuse remain distinct", async () => {
  const mismatched = repository(async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ operationId: uuid(2), state: "applied", fileId: 1 }) }));
  await assert.rejects(mismatched.client.offlineReceipt(uuid(1), 1), (error: unknown) => error instanceof ApiError && error.code === "OFFLINE_INVALID_RECEIPT");
  const processing = repository(async () => ({ status: 409, ok: false, text: async () => JSON.stringify({ operationId: uuid(1), state: "in_progress", error: "MOBILE_SYNC_IN_PROGRESS" }) }));
  await assert.rejects(processing.client.offlineReceipt(uuid(1), 1), (error: unknown) => error instanceof ApiError && error.code === "MOBILE_SYNC_IN_PROGRESS");
  const collision = repository(async () => ({ status: 409, ok: false, text: async () => JSON.stringify({ operationId: uuid(1), state: "conflict", error: "MOBILE_SYNC_OPERATION_REUSED" }) }));
  assert.equal((await collision.client.offlineDocument(metadata, photo)).state, "needs_review");
});
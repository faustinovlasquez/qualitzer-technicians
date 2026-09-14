/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { HttpTechnicianRepository } from "../../infrastructure/HttpTechnicianRepository";
import { ApiError, NetworkError } from "../../infrastructure/errors";
import { isServiceFailure } from "../connection";
import { canUseCache } from "../engine";
import { assignmentsWithStep, user } from "./fakes";

const range = { startDate: "2026-09-08", endDate: "2026-09-08" };
function repository(reply: () => Promise<Response>) {
  const path = resolve(__dirname, "../../infrastructure/HttpTechnicianRepository.ts");
  const requireSource = createRequire(path);
  const exports: { HttpTechnicianRepository?: new (baseUrl: string) => HttpTechnicianRepository } = {};
  const module = { exports }; let requests = 0;
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports, FormData, Blob, AbortController, Error, TypeError, setTimeout, clearTimeout, URLSearchParams,
    require: (id: string): unknown => id === "react-native" ? { Platform: { OS: "android" } }
      : id === "./photos" ? { uploadFetch: async () => { requests++; return reply(); } } : requireSource(id),
  });
  assert.ok(module.exports.HttpTechnicianRepository);
  const client = new module.exports.HttpTechnicianRepository("https://fixture.invalid"); client.tenant = user.tenant;
  return { client, requests: () => requests };
}

const serviceError = (error: unknown): boolean => error instanceof ApiError && error.code === "UPSTREAM_INVALID_RESPONSE"
  && isServiceFailure(error) && !canUseCache(error) && !error.message.includes("secret");

for (const payload of [null, {}, { groups: [] }, { ...assignmentsWithStep(), groups: null }]) test("invalid assignment shape fails as service error before merge", async () => {
  const f = repository(async () => Response.json(payload));
  await assert.rejects(f.client.assignments(range, 1), serviceError); assert.equal(f.requests(), 1);
});

test("unsupported checklist type is not rendered or silently normalized", async () => {
  const data = assignmentsWithStep(); const payload: unknown = JSON.parse(JSON.stringify(data).replace('"type":"text"', '"type":"future_secret"'));
  const f = repository(async () => Response.json(payload));
  await assert.rejects(f.client.assignments(range, 1), serviceError); assert.equal(f.requests(), 1);
});

test("malformed JSON has a safe service diagnosis rather than a parsing crash", async () => {
  const f = repository(async () => new Response("<html>secret</html>", { status: 200 }));
  await assert.rejects(f.client.assignments(range, 1), serviceError); assert.equal(f.requests(), 1);
});

test("valid assignments preserve server fields and permissions", async () => {
  const data = assignmentsWithStep(); data.groups[0]!.works[0]!.canExecute = false;
  const f = repository(async () => Response.json(data)); const result = await f.client.assignments(range, 1);
  assert.equal(result.groups[0]?.works[0]?.canExecute, false);
  assert.deepEqual(structuredClone(result.groups[0]?.works[0]?.checklists), data.groups[0]?.works[0]?.checklists);
  assert.equal(f.requests(), 1);
});

for (const status of [401, 403, 429, 503]) test(`HTTP ${status} is not cached or retried as transport`, async () => {
  const f = repository(async () => Response.json({ error: "TEST_DENIED" }, { status })); let invalidated = 0;
  f.client.onUnauthorized = () => { invalidated++; };
  await assert.rejects(f.client.assignments(range, 1), (error: unknown) => error instanceof ApiError && error.status === status && !canUseCache(error));
  assert.equal(f.requests(), 1); assert.equal(invalidated, status === 401 ? 1 : 0);
});

test("native transport keeps its network-only cache eligibility", async () => {
  const f = repository(async () => { throw new Error("fetch failed: secret"); });
  await assert.rejects(f.client.assignments(range, 1), (error: unknown) => error instanceof NetworkError && canUseCache(error));
  assert.equal(f.requests(), 1);
});
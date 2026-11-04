import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/infrastructure/errors";
import { retryWhenRateLimited, singleFlight } from "../src/workshop/requestPacing";

const limited = () => new ApiError(429, "RATE_LIMITED", "Se alcanzó el límite de solicitudes.");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("rate limit: retries until the gateway answers", async () => {
  let calls = 0;
  const result = await retryWhenRateLimited(async () => { if (++calls < 3) throw limited(); return "ok"; }, () => true, 0);
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("rate limit: gives up after the allowed retries and shows the error", async () => {
  let calls = 0;
  await assert.rejects(retryWhenRateLimited(async () => { calls++; throw limited(); }, () => true, 0, 2), /límite/);
  assert.equal(calls, 3);
});

test("rate limit: other errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(retryWhenRateLimited(async () => { calls++; throw new ApiError(403, "FORBIDDEN", "No autorizado"); }, () => true, 0), /No autorizado/);
  assert.equal(calls, 1);
});

test("rate limit: a closed sheet stops retrying", async () => {
  let calls = 0;
  await assert.rejects(retryWhenRateLimited(async () => { calls++; throw limited(); }, () => false, 0));
  assert.equal(calls, 1);
});

test("single flight: requests during a load collapse into one repeat", async () => {
  let calls = 0;
  const finishers: Array<() => void> = [];
  const start = singleFlight(() => { calls++; return new Promise<void>((resolve) => { finishers.push(resolve); }); });
  start(); start(); start(); start();
  assert.equal(calls, 1);
  finishers[0]();
  await tick();
  assert.equal(calls, 2);
  finishers[1]();
  await tick();
  assert.equal(calls, 2);
});

test("single flight: a failed load does not block the next one", async () => {
  let calls = 0;
  const start = singleFlight(async () => { calls++; throw new Error("sin conexión"); });
  start();
  await tick();
  start();
  await tick();
  assert.equal(calls, 2);
});

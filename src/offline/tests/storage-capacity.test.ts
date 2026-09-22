import assert from "node:assert/strict";
import { test } from "node:test";
import { storageCapacity, storageBytesLabel } from "../storageCapacity";
import { validateQuota } from "../state";
const mebibyte = 1024 * 1024;

test("native offline files can exceed 500 MiB without consuming the phone reserve", () => {
  const capacity = storageCapacity(800 * mebibyte, 4000 * mebibyte, 32000 * mebibyte);
  assert.equal(capacity.reserveBytes, 1600 * mebibyte);
  assert.equal(capacity.availableBytes, 2400 * mebibyte);
  assert.equal(capacity.capacityBytes, 3200 * mebibyte);
  assert.equal(capacity.capacitySource, "device");
  assert.doesNotThrow(() => validateQuota(25 * mebibyte, capacity.usedBytes, capacity.capacityBytes));
  assert.throws(() => validateQuota(25 * mebibyte + 1, 0, capacity.capacityBytes), /FILE_LIMIT/);
});

test("low disk blocks only new files and never makes existing usage negative", () => {
  for (const free of [0, 1, 128 * mebibyte]) {
    const capacity = storageCapacity(800 * mebibyte, free);
    assert.equal(capacity.usedBytes, 800 * mebibyte);
    assert.equal(capacity.availableBytes, 0);
    assert.throws(() => validateQuota(1, capacity.usedBytes, capacity.capacityBytes), /STORAGE_FULL/);
  }
  assert.equal(storageCapacity(0, 10000 * mebibyte, 1000000 * mebibyte).reserveBytes, 50000 * mebibyte);
});

test("unknown capacity retains a labeled fallback, not invented device free space", () => {
  for (const free of [undefined, NaN, -1, Infinity]) {
    const capacity = storageCapacity(20 * mebibyte, free);
    assert.equal(capacity.capacitySource, "application");
    assert.equal(capacity.deviceAvailableBytes, null);
    assert.equal(capacity.availableBytes, 480 * mebibyte);
  }
  assert.equal(storageBytesLabel(0), "0 B");
  assert.equal(storageBytesLabel(mebibyte), "1.0 MiB");
  assert.equal(storageBytesLabel(2048 * mebibyte), "2.0 GiB");
});
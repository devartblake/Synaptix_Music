import assert from "node:assert/strict";
import test from "node:test";

import { assessStorage, describeSaveError, estimateStorage, formatBytes, isQuotaError } from "./storage-health.ts";

const MB = 1024 * 1024;

test("storage is ok, nearly full, or critical by share and by free space", () => {
  assert.equal(assessStorage(100 * MB, 1000 * MB).level, "ok");
  assert.equal(assessStorage(850 * MB, 1000 * MB).level, "warning");
  assert.equal(assessStorage(960 * MB, 1000 * MB).level, "critical");
  assert.equal(assessStorage(40 * MB, 60 * MB).level, "critical", "under 25 MB free is critical");
  assert.equal(assessStorage(undefined, undefined).level, "unknown");
  assert.equal(assessStorage(5, 0).level, "unknown");
});

test("estimates never throw when the browser API is missing or fails", async () => {
  assert.equal((await estimateStorage(undefined)).level, "unknown");
  assert.equal(
    (await estimateStorage({ estimate: () => Promise.reject(new Error("blocked")) })).level,
    "unknown"
  );
  const ok = await estimateStorage({ estimate: async () => ({ usage: 10 * MB, quota: 1000 * MB }) });
  assert.equal(ok.level, "ok");
  assert.equal(ok.ratio, 0.01);
});

test("full storage is explained in plain words", () => {
  const quota = new DOMException("The quota has been exceeded.", "QuotaExceededError");
  assert.equal(isQuotaError(quota), true);
  assert.match(describeSaveError(quota), /storage is full/);
  assert.equal(describeSaveError(new Error("Disk on fire")), "Disk on fire");
  assert.equal(describeSaveError(null), "Browser storage refused the save.");
  assert.equal(formatBytes(1536 * MB), "1.50 GB");
  assert.equal(formatBytes(12.34 * MB), "12.3 MB");
});

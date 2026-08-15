import assert from "node:assert/strict";
import test from "node:test";

import { computeRetryDelayMs, DEFAULT_RETRY_MAX_DELAY_MS } from "./render-job.ts";

test("retry delay grows exponentially with attempt number", () => {
  assert.equal(computeRetryDelayMs(1, 1000, 60_000), 1000);
  assert.equal(computeRetryDelayMs(2, 1000, 60_000), 2000);
  assert.equal(computeRetryDelayMs(3, 1000, 60_000), 4000);
});

test("retry delay is capped at the configured maximum", () => {
  assert.equal(computeRetryDelayMs(10, 1000, 5000), 5000);
  assert.ok(computeRetryDelayMs(20) <= DEFAULT_RETRY_MAX_DELAY_MS);
});

test("retry delay rejects non-positive attempt numbers", () => {
  assert.throws(() => computeRetryDelayMs(0), /positive integer/);
  assert.throws(() => computeRetryDelayMs(-1), /positive integer/);
});

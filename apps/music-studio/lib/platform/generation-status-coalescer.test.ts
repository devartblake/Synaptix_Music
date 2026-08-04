import assert from "node:assert/strict";
import test from "node:test";

import {
  AppliedGenerationJobSet,
  coalesceGenerationStatuses,
  selectNewestMeaningfulStatus
} from "./generation-status-coalescer.ts";

test("selectNewestMeaningfulStatus prefers the newest transition", () => {
  const running = {
    jobId: "job-1",
    status: "running",
    updatedAt: "2026-08-04T13:00:00.000Z",
    attemptCount: 1
  };
  const completed = {
    ...running,
    status: "completed",
    updatedAt: "2026-08-04T13:00:01.000Z"
  };

  assert.equal(selectNewestMeaningfulStatus(running, completed), completed);
});

test("coalesceGenerationStatuses keeps one meaningful state per concurrent job", () => {
  const statuses = coalesceGenerationStatuses([
    { jobId: "job-b", status: "queued", updatedAt: "2026-08-04T13:00:00.000Z", attemptCount: 0 },
    { jobId: "job-a", status: "running", updatedAt: "2026-08-04T13:00:01.000Z", attemptCount: 1 },
    { jobId: "job-a", status: "completed", updatedAt: "2026-08-04T13:00:02.000Z", attemptCount: 1 },
    { jobId: "job-b", status: "retryScheduled", updatedAt: "2026-08-04T13:00:03.000Z", attemptCount: 1 }
  ]);

  assert.deepEqual(statuses.map(({ jobId, status }) => ({ jobId, status })), [
    { jobId: "job-a", status: "completed" },
    { jobId: "job-b", status: "retryScheduled" }
  ]);
});

test("AppliedGenerationJobSet prevents duplicate completed proposal application", () => {
  const registry = new AppliedGenerationJobSet();
  let applications = 0;

  const first = registry.applyOnce("job-1", () => ++applications);
  const duplicate = registry.applyOnce("job-1", () => ++applications);

  assert.equal(first, 1);
  assert.equal(duplicate, undefined);
  assert.equal(applications, 1);
  assert.equal(registry.has("job-1"), true);
});

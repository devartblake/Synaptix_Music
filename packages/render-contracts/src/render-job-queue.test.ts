import assert from "node:assert/strict";
import test from "node:test";

import { RENDER_CONTRACT_VERSION, type RenderManifest, type RenderResult } from "./render-manifest.ts";
import { RenderJobQueue } from "./render-job-queue.ts";

function manifest(renderId: string): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId,
    projectId: "project-a",
    revisionId: "revision-a",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: "1.0.0",
    seed: 42,
    scope: { kind: "master" },
    range: { startTick: 0, endTick: 3840 },
    output: { format: "wav", sampleRate: 48000, bitDepth: 24, normalizePeakDbfs: null, includeTailSeconds: 2 },
    requestedAt: "2026-08-15T00:00:00.000Z"
  };
}

function completedResult(renderId: string): RenderResult {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId,
    status: "completed",
    artifacts: [{
      artifactId: "b".repeat(8) + "-0000-4000-8000-000000000000",
      renderId,
      trackId: null,
      fileName: "master.wav",
      mediaType: "audio/wav",
      byteLength: 1024,
      checksumSha256: "c".repeat(64),
      durationSeconds: 4
    }],
    warnings: [],
    errorCode: null,
    errorMessage: null,
    completedAt: "2026-08-15T00:00:05.000Z"
  };
}

function failedResult(renderId: string): RenderResult {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId,
    status: "failed",
    artifacts: [],
    warnings: [],
    errorCode: "render_worker_crashed",
    errorMessage: "Worker process exited unexpectedly.",
    completedAt: "2026-08-15T00:00:05.000Z"
  };
}

function clockQueue(overrides: { maxAttempts?: number; leaseDurationMs?: number } = {}) {
  let current = new Date("2026-08-15T00:00:00.000Z");
  let idCounter = 0;
  const queue = new RenderJobQueue({
    now: () => current,
    idFactory: () => `00000000-0000-4000-8000-${String(idCounter++).padStart(12, "0")}`,
    ...overrides
  });
  return {
    queue,
    advance(ms: number) { current = new Date(current.getTime() + ms); }
  };
}

test("submitting the same idempotency key and render twice returns the same job", () => {
  const { queue } = clockQueue();
  const renderId = "10000000-0000-4000-8000-000000000000";
  const first = queue.submit(manifest(renderId), "key-1");
  const second = queue.submit(manifest(renderId), "key-1");
  assert.equal(first.jobId, second.jobId);
  assert.equal(queue.list().length, 1);
});

test("reusing an idempotency key for a different render is rejected", () => {
  const { queue } = clockQueue();
  queue.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
  assert.throws(
    () => queue.submit(manifest("20000000-0000-4000-8000-000000000000"), "key-1"),
    /already used for a different render/
  );
});

test("newly submitted jobs are queued and unleased", () => {
  const { queue } = clockQueue();
  const job = queue.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
  assert.equal(job.status, "queued");
  assert.equal(job.attempt, 0);
  assert.equal(job.leaseOwnerId, null);
});

test("lease assigns the oldest eligible job in submission order and increments the attempt", () => {
  const { queue, advance } = clockQueue();
  const first = queue.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
  advance(10);
  queue.submit(manifest("20000000-0000-4000-8000-000000000000"), "key-2");

  const leased = queue.lease("worker-1");
  assert.equal(leased?.jobId, first.jobId);
  assert.equal(leased?.status, "running");
  assert.equal(leased?.attempt, 1);
  assert.equal(leased?.leaseOwnerId, "worker-1");
  assert.ok(leased?.leaseExpiresAt);
});

test("lease returns null when no job is eligible", () => {
  const { queue } = clockQueue();
  assert.equal(queue.lease("worker-1"), null);
});

test("heartbeat extends the lease only for the owning worker on a running job", () => {
  const { queue, advance } = clockQueue();
  const job = queue.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
  queue.lease("worker-1");
  const expiresBefore = queue.get(job.jobId)?.leaseExpiresAt;
  advance(30_000);
  const heartbeat = queue.heartbeat(job.jobId, "worker-1");
  assert.ok(heartbeat.leaseExpiresAt && heartbeat.leaseExpiresAt > (expiresBefore ?? ""));

  assert.throws(() => queue.heartbeat(job.jobId, "worker-2"), /not leased by worker/);
});

test("reporting a completed result finishes the job and releases the lease", () => {
  const { queue } = clockQueue();
  const renderId = "10000000-0000-4000-8000-000000000000";
  const job = queue.submit(manifest(renderId), "key-1");
  queue.lease("worker-1");
  const updated = queue.reportResult(job.jobId, "worker-1", completedResult(renderId));
  assert.equal(updated.status, "completed");
  assert.equal(updated.leaseOwnerId, null);
  assert.equal(updated.result?.status, "completed");
});

test("reporting a result with a mismatched renderId is rejected", () => {
  const { queue } = clockQueue();
  const job = queue.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
  queue.lease("worker-1");
  assert.throws(
    () => queue.reportResult(job.jobId, "worker-1", completedResult("99999999-0000-4000-8000-000000000000")),
    /does not match job manifest renderId/
  );
});

test("a failed result is retried with exponential backoff until attempts are exhausted", () => {
  const { queue, advance } = clockQueue({ maxAttempts: 2 });
  const renderId = "10000000-0000-4000-8000-000000000000";
  const job = queue.submit(manifest(renderId), "key-1");

  queue.lease("worker-1");
  const afterFirstFailure = queue.reportResult(job.jobId, "worker-1", failedResult(renderId));
  assert.equal(afterFirstFailure.status, "queued");
  assert.equal(afterFirstFailure.attempt, 1);
  assert.ok(afterFirstFailure.nextAttemptAt);

  advance(10 * 60_000);
  queue.lease("worker-2");
  const afterSecondFailure = queue.reportResult(job.jobId, "worker-2", failedResult(renderId));
  assert.equal(afterSecondFailure.status, "dead_letter");
  assert.equal(afterSecondFailure.attempt, 2);
});

test("lease skips jobs scheduled for a future retry", () => {
  const { queue, advance } = clockQueue({ maxAttempts: 3 });
  const renderId = "10000000-0000-4000-8000-000000000000";
  const job = queue.submit(manifest(renderId), "key-1");
  queue.lease("worker-1");
  queue.fail(job.jobId, "worker-1", "transient failure");

  assert.equal(queue.lease("worker-2"), null, "retry is not due yet");

  advance(10 * 60_000);
  const leased = queue.lease("worker-2");
  assert.equal(leased?.jobId, job.jobId);
});

test("cancel stops a queued or running job but not a terminal one", () => {
  const { queue } = clockQueue();
  const queuedJob = queue.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
  const cancelled = queue.cancel(queuedJob.jobId);
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => queue.cancel(queuedJob.jobId), /already terminal/);
});

test("expired leases are reclaimed and rescheduled for retry", () => {
  const { queue, advance } = clockQueue({ leaseDurationMs: 5000, maxAttempts: 3 });
  const renderId = "10000000-0000-4000-8000-000000000000";
  const job = queue.submit(manifest(renderId), "key-1");
  queue.lease("worker-1");

  advance(10_000);
  const reclaimed = queue.reclaimExpiredLeases();
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0]?.jobId, job.jobId);
  assert.equal(reclaimed[0]?.status, "queued");
  assert.equal(reclaimed[0]?.leaseOwnerId, null);

  const events = queue.events(job.jobId).map((event) => event.type);
  assert.ok(events.includes("lease_expired"));
  assert.ok(events.includes("retry_scheduled"));
});

test("operations on an unknown job id fail closed", () => {
  const { queue } = clockQueue();
  assert.throws(() => queue.heartbeat("missing", "worker-1"), /was not found/);
  assert.throws(() => queue.cancel("missing"), /was not found/);
});

test("list filters by status and events records the full job lifecycle", () => {
  const { queue } = clockQueue();
  const renderId = "10000000-0000-4000-8000-000000000000";
  const job = queue.submit(manifest(renderId), "key-1");
  queue.lease("worker-1");
  queue.reportResult(job.jobId, "worker-1", completedResult(renderId));

  assert.equal(queue.list("completed").length, 1);
  assert.equal(queue.list("queued").length, 0);
  const eventTypes = queue.events(job.jobId).map((event) => event.type);
  assert.deepEqual(eventTypes, ["submitted", "leased", "completed"]);
});

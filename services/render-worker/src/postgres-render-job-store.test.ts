import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { Pool } from "pg";

import { RENDER_CONTRACT_VERSION, type RenderManifest, type RenderResult } from "@synaptix/render-contracts";

import { applyMigrations } from "./migrate.ts";
import { PostgresRenderJobStore } from "./postgres-render-job-store.ts";

// This suite exercises the durable, concurrency-safe behavior (SKIP LOCKED
// leasing, transactional retry/dead-letter, lease reclamation) that the
// in-memory RenderJobQueue tests cannot prove. It requires a real,
// disposable Postgres database and is skipped otherwise so it never blocks
// CI/local runs that don't have one configured.
const connectionString = process.env.RENDER_WORKER_TEST_DATABASE_URL;

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
      artifactId: "b0000000-0000-4000-8000-000000000000",
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

if (!connectionString) {
  test("PostgresRenderJobStore (skipped: set RENDER_WORKER_TEST_DATABASE_URL to run against a real database)", () => {});
} else {
  const pool = new Pool({ connectionString });
  const store = new PostgresRenderJobStore(pool);

  before(async () => {
    await applyMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE render_job_events, render_jobs");
  });

  after(async () => {
    await pool.end();
  });

  test("submitting the same idempotency key and render twice returns the same job", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const first = await store.submit(manifest(renderId), "key-1");
    const second = await store.submit(manifest(renderId), "key-1");
    assert.equal(first.jobId, second.jobId);
    assert.equal((await store.list()).length, 1);
  });

  test("reusing an idempotency key for a different render is rejected", async () => {
    await store.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
    await assert.rejects(
      () => store.submit(manifest("20000000-0000-4000-8000-000000000000"), "key-1"),
      /already used for a different render/
    );
  });

  test("lease assigns the oldest eligible job and increments the attempt", async () => {
    const first = await store.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
    await sleep(5);
    await store.submit(manifest("20000000-0000-4000-8000-000000000000"), "key-2");

    const leased = await store.lease("worker-1");
    assert.equal(leased?.jobId, first.jobId);
    assert.equal(leased?.status, "running");
    assert.equal(leased?.attempt, 1);
    assert.equal(leased?.leaseOwnerId, "worker-1");
  });

  test("lease returns null when no job is eligible", async () => {
    assert.equal(await store.lease("worker-1"), null);
  });

  test("concurrent leasing never double-claims a job", async () => {
    await store.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
    await store.submit(manifest("20000000-0000-4000-8000-000000000000"), "key-2");

    const [first, second] = await Promise.all([store.lease("worker-a"), store.lease("worker-b")]);
    assert.ok(first && second);
    assert.notEqual(first.jobId, second.jobId);
    assert.equal(await store.lease("worker-c"), null);
  });

  test("heartbeat extends the lease only for the owning worker on a running job", async () => {
    const job = await store.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
    await store.lease("worker-1");
    const before = (await store.get(job.jobId))?.leaseExpiresAt;

    const heartbeat = await store.heartbeat(job.jobId, "worker-1");
    assert.ok(heartbeat.leaseExpiresAt && heartbeat.leaseExpiresAt >= (before ?? ""));

    await assert.rejects(() => store.heartbeat(job.jobId, "worker-2"), /not leased by worker/);
  });

  test("reporting a completed result finishes the job and releases the lease", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const job = await store.submit(manifest(renderId), "key-1");
    await store.lease("worker-1");
    const updated = await store.reportResult(job.jobId, "worker-1", completedResult(renderId));
    assert.equal(updated.status, "completed");
    assert.equal(updated.leaseOwnerId, null);
    assert.equal(updated.result?.status, "completed");
  });

  test("reporting a result with a mismatched renderId is rejected", async () => {
    const job = await store.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
    await store.lease("worker-1");
    await assert.rejects(
      () => store.reportResult(job.jobId, "worker-1", completedResult("99999999-0000-4000-8000-000000000000")),
      /does not match job manifest renderId/
    );
  });

  test("a failed result schedules a future retry and is not immediately leasable", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const job = await store.submit(manifest(renderId), "key-1", 3);
    await store.lease("worker-1");
    const afterFailure = await store.reportResult(job.jobId, "worker-1", failedResult(renderId));
    assert.equal(afterFailure.status, "queued");
    assert.equal(afterFailure.attempt, 1);
    assert.ok(afterFailure.nextAttemptAt && afterFailure.nextAttemptAt > new Date().toISOString());
    assert.equal(await store.lease("worker-2"), null);
  });

  test("a job is dead-lettered once attempts are exhausted", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const job = await store.submit(manifest(renderId), "key-1", 1);
    await store.lease("worker-1");
    const afterFailure = await store.reportResult(job.jobId, "worker-1", failedResult(renderId));
    assert.equal(afterFailure.status, "dead_letter");
    assert.equal(afterFailure.attempt, 1);
  });

  test("cancel stops a queued or running job but not a terminal one", async () => {
    const job = await store.submit(manifest("10000000-0000-4000-8000-000000000000"), "key-1");
    const cancelled = await store.cancel(job.jobId);
    assert.equal(cancelled.status, "cancelled");
    await assert.rejects(() => store.cancel(job.jobId), /already terminal/);
  });

  test("expired leases are reclaimed and rescheduled for retry", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const job = await store.submit(manifest(renderId), "key-1", 3);
    await store.lease("worker-1", 50);

    await sleep(80);
    const reclaimed = await store.reclaimExpiredLeases();
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0]?.jobId, job.jobId);
    assert.equal(reclaimed[0]?.status, "queued");
    assert.equal(reclaimed[0]?.leaseOwnerId, null);

    const events = (await store.events(job.jobId)).map((event) => event.type);
    assert.ok(events.includes("lease_expired"));
    assert.ok(events.includes("retry_scheduled"));
  });

  test("operations on an unknown job id fail closed", async () => {
    await assert.rejects(() => store.heartbeat("00000000-0000-4000-8000-000000000000", "worker-1"), /was not found/);
    await assert.rejects(() => store.cancel("00000000-0000-4000-8000-000000000000"), /was not found/);
  });

  test("list filters by status and events records the full job lifecycle", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const job = await store.submit(manifest(renderId), "key-1");
    await store.lease("worker-1");
    await store.reportResult(job.jobId, "worker-1", completedResult(renderId));

    assert.equal((await store.list("completed")).length, 1);
    assert.equal((await store.list("queued")).length, 0);
    const eventTypes = (await store.events(job.jobId)).map((event) => event.type);
    assert.deepEqual(eventTypes, ["submitted", "leased", "completed"]);
  });
}

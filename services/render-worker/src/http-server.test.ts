import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import { RENDER_CONTRACT_VERSION, type RenderManifest } from "@synaptix/render-contracts";
import { Pool } from "pg";

import { createRenderJobHttpServer } from "./http-server.ts";
import { applyMigrations } from "./migrate.ts";
import { PostgresRenderJobStore } from "./postgres-render-job-store.ts";

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

if (!connectionString) {
  test("render-job HTTP API (skipped: set RENDER_WORKER_TEST_DATABASE_URL to run against a real database)", () => {});
} else {
  const pool = new Pool({ connectionString });
  const store = new PostgresRenderJobStore(pool);
  const server = createRenderJobHttpServer(store);
  let baseUrl = "";

  before(async () => {
    await applyMigrations(pool);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE render_job_events, render_jobs");
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await pool.end();
  });

  test("submitting without an Idempotency-Key header fails closed", async () => {
    const response = await fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: manifest("10000000-0000-4000-8000-000000000000") })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "idempotency_key_required");
  });

  test("submitting an invalid manifest fails closed with a 400", async () => {
    const response = await fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ manifest: { not: "a manifest" } })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "invalid_render_job_request");
  });

  test("submit, fetch status, list, and events form a consistent lifecycle", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const submitResponse = await fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ manifest: manifest(renderId) })
    });
    assert.equal(submitResponse.status, 201);
    const job = await submitResponse.json();
    assert.equal(job.status, "queued");
    assert.equal(job.manifest.renderId, renderId);

    const statusResponse = await fetch(`${baseUrl}/render-jobs/${job.jobId}`);
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).jobId, job.jobId);

    const listResponse = await fetch(`${baseUrl}/render-jobs?status=queued`);
    const listBody = await listResponse.json();
    assert.equal(listBody.jobs.length, 1);

    const eventsResponse = await fetch(`${baseUrl}/render-jobs/${job.jobId}/events`);
    const eventsBody = await eventsResponse.json();
    assert.deepEqual(eventsBody.events.map((event: { type: string }) => event.type), ["submitted"]);
  });

  test("resubmitting the same idempotency key and render returns the same job", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const first = await fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ manifest: manifest(renderId) })
    }).then((response) => response.json());
    const second = await fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ manifest: manifest(renderId) })
    }).then((response) => response.json());
    assert.equal(first.jobId, second.jobId);
  });

  test("fetching an unknown job returns a 404 envelope", async () => {
    const response = await fetch(`${baseUrl}/render-jobs/00000000-0000-4000-8000-000000000000`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "render_job_not_found");
  });

  test("cancel stops a queued job and rejects a second cancel with a 409", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const job = await fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ manifest: manifest(renderId) })
    }).then((response) => response.json());

    const cancelResponse = await fetch(`${baseUrl}/render-jobs/${job.jobId}/cancel`, { method: "POST" });
    assert.equal(cancelResponse.status, 200);
    assert.equal((await cancelResponse.json()).status, "cancelled");

    const secondCancel = await fetch(`${baseUrl}/render-jobs/${job.jobId}/cancel`, { method: "POST" });
    assert.equal(secondCancel.status, 409);
    assert.equal((await secondCancel.json()).code, "render_job_conflict");
  });

  test("unknown routes return a 404 envelope", async () => {
    const response = await fetch(`${baseUrl}/nonexistent`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "not_found");
  });
}

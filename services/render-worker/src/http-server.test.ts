import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import {
  RENDER_ENGINE_VERSION,
  RENDER_CONTRACT_VERSION,
  type RenderManifest,
  type RenderResult
} from "@synaptix/render-contracts";
import { Pool } from "pg";

import { createRenderJobHttpServer, maxActiveJobsPerOwnerFromEnv } from "./http-server.ts";
import { applyMigrations } from "./migrate.ts";
import { PostgresRenderJobStore } from "./postgres-render-job-store.ts";

const connectionString = process.env.RENDER_WORKER_TEST_DATABASE_URL;

test("RENDER_MAX_ACTIVE_JOBS_PER_OWNER defaults to 10, 0 turns the limit off, and junk fails at startup", () => {
  assert.equal(maxActiveJobsPerOwnerFromEnv(undefined), 10);
  assert.equal(maxActiveJobsPerOwnerFromEnv(" "), 10);
  assert.equal(maxActiveJobsPerOwnerFromEnv("3"), 3);
  assert.equal(maxActiveJobsPerOwnerFromEnv("0"), undefined);
  assert.throws(() => maxActiveJobsPerOwnerFromEnv("-1"), /whole number/);
  assert.throws(() => maxActiveJobsPerOwnerFromEnv("lots"), /whole number/);
});

function manifest(renderId: string, scope: RenderManifest["scope"] = { kind: "master" }): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId,
    projectId: "project-a",
    revisionId: "revision-a",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: RENDER_ENGINE_VERSION,
    seed: 42,
    scope,
    range: { startTick: 0, endTick: 3840 },
    output: {
      format: "wav",
      sampleRate: 48000,
      bitDepth: 24,
      normalizePeakDbfs: null,
      includeTailSeconds: 2
    },
    requestedAt: "2026-08-15T00:00:00.000Z"
  };
}

if (!connectionString) {
  test("render-job HTTP API (skipped: set RENDER_WORKER_TEST_DATABASE_URL to run against a real database)", () => {});
} else {
  const pool = new Pool({ connectionString });
  const store = new PostgresRenderJobStore(pool);
  const artifactDelivery = {
    async createDownloadUrl(renderId: string, fileName: string): Promise<string> {
      return `https://objects.example/renders/${renderId}/${fileName}?signed=true`;
    }
  };
  const SERVICE_TOKEN = "test-service-token";
  const server = createRenderJobHttpServer(store, artifactDelivery, { serviceToken: SERVICE_TOKEN });
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
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
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

  test("a render asking for another engine is refused with 409 engine_version_mismatch", async () => {
    // e.g. a studio tab loaded before a deploy still asks for the old engine. Rendering it with
    // this worker's engine would label the audio wrongly and fail certification later.
    const response = await fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "old-engine" },
      body: JSON.stringify({ manifest: { ...manifest("10000000-0000-4000-8000-0000000000e1"), engineVersion: "1.0.0" } })
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "engine_version_mismatch");
    assert.match(body.message, /Reload the studio/);
    assert.equal((await store.list()).length, 0, "no job was queued");
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
    assert.deepEqual(
      eventsBody.events.map((event: { type: string }) => event.type),
      ["submitted"]
    );
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

  test("creates a signed delivery URL only for an artifact recorded on the completed job", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const artifactId = "20000000-0000-4000-8000-000000000000";
    const submitted = await store.submit(manifest(renderId), "delivery-key");
    await store.lease("worker-a");
    const result: RenderResult = {
      contractVersion: RENDER_CONTRACT_VERSION,
      renderId,
      status: "completed",
      artifacts: [
        {
          artifactId,
          renderId,
          trackId: null,
          fileName: "master.wav",
          mediaType: "audio/wav",
          byteLength: 44,
          checksumSha256: "b".repeat(64),
          durationSeconds: 1
        }
      ],
      warnings: [],
      errorCode: null,
      errorMessage: null,
      completedAt: new Date().toISOString()
    };
    await store.reportResult(submitted.jobId, "worker-a", result);

    const response = await fetch(
      `${baseUrl}/render-jobs/${submitted.jobId}/artifacts/${artifactId}/download-url`
    );
    assert.equal(response.status, 200);
    assert.match((await response.json()).downloadUrl, /master\.wav\?signed=true$/);

    const missing = await fetch(
      `${baseUrl}/render-jobs/${submitted.jobId}/artifacts/30000000-0000-4000-8000-000000000000/download-url`
    );
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "render_artifact_not_found");
  });

  async function completedRender(
    renderId: string,
    artifactId: string,
    manifestArtifactId: string,
    scope: RenderManifest["scope"] = { kind: "master" }
  ) {
    const submitted = await store.submit(manifest(renderId, scope), `evidence-${renderId}`);
    await store.lease("worker-a");
    const artifact = (id: string, fileName: string, checksum: string) => ({
      artifactId: id, renderId, trackId: null, fileName,
      mediaType: fileName.endsWith(".json") ? "application/vnd.synaptix.render-manifest+json" : "audio/wav",
      byteLength: 44, checksumSha256: checksum, durationSeconds: 1
    });
    await store.reportResult(submitted.jobId, "worker-a", {
      contractVersion: RENDER_CONTRACT_VERSION, renderId, status: "completed",
      artifacts: [artifact(artifactId, "master.wav", "b".repeat(64)), artifact(manifestArtifactId, "artifact-manifest.json", "c".repeat(64))],
      warnings: [], errorCode: null, errorMessage: null, completedAt: new Date().toISOString()
    } as RenderResult);
    return submitted.jobId;
  }

  async function evidence(body: unknown, token: string | null = SERVICE_TOKEN, url = baseUrl) {
    return fetch(`${url}/internal/render-evidence`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-service-token": token } : {}) },
      body: JSON.stringify(body)
    });
  }

  test("render evidence reports the render and artifacts the backend verifies before publication", async () => {
    const renderId = "10000000-0000-4000-8000-00000000000a";
    const artifactId = "20000000-0000-4000-8000-00000000000a";
    const jobId = await completedRender(renderId, artifactId, "20000000-0000-4000-8000-00000000000b");

    const response = await evidence({ renderIds: [renderId], artifactIds: [artifactId, "20000000-0000-4000-8000-0000000000ff"] });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.renders, [{
      renderId, projectId: "project-a", revisionId: "revision-a", projectChecksumSha256: "a".repeat(64),
      scopeKind: "master", jobId, status: "completed", artifactManifestChecksumSha256: "c".repeat(64)
    }]);
    assert.deepEqual(body.artifacts, [{
      renderId, projectId: "project-a", revisionId: "revision-a", projectChecksumSha256: "a".repeat(64),
      scopeKind: "master", jobId, status: "completed", artifactId, fileName: "master.wav", checksumSha256: "b".repeat(64), byteLength: 44
    }], "unknown artifacts are simply absent");
  });

  test("render evidence names a plug-in freeze, so the backend can refuse it as package audio", async () => {
    // A freeze is one track through its plug-ins. The studio keeps freezes out of adaptive
    // states, but only the scope kind lets the backend refuse one published directly.
    const renderId = "10000000-0000-4000-8000-00000000000c";
    const artifactId = "20000000-0000-4000-8000-00000000000c";
    await completedRender(renderId, artifactId, "20000000-0000-4000-8000-00000000000d",
      { kind: "plugin-freeze", trackId: "track-1", deviceId: "device-1" });

    const body = await (await evidence({ renderIds: [renderId], artifactIds: [artifactId] })).json();
    assert.equal(body.renders[0].scopeKind, "plugin-freeze");
    assert.equal(body.artifacts[0].scopeKind, "plugin-freeze");
  });

  test("render evidence requires the service token and valid ids", async () => {
    assert.equal((await evidence({ renderIds: [], artifactIds: [] }, null)).status, 401);
    assert.equal((await evidence({ renderIds: [], artifactIds: [] }, "wrong-token")).status, 401);
    assert.equal((await evidence({ renderIds: ["not-a-uuid"], artifactIds: [] })).status, 400);

    const unconfigured = createRenderJobHttpServer(store);
    await new Promise<void>((resolve) => unconfigured.listen(0, "127.0.0.1", resolve));
    try {
      const address = unconfigured.address() as AddressInfo;
      const response = await evidence({ renderIds: [], artifactIds: [] }, SERVICE_TOKEN, `http://127.0.0.1:${address.port}`);
      assert.equal(response.status, 503);
    } finally {
      await new Promise<void>((resolve) => unconfigured.close(() => resolve()));
    }
  });

  test("cancel stops a queued job and rejects a second cancel with a 409", async () => {
    const renderId = "10000000-0000-4000-8000-000000000000";
    const job = await fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "key-1" },
      body: JSON.stringify({ manifest: manifest(renderId) })
    }).then((response) => response.json());

    const cancelResponse = await fetch(`${baseUrl}/render-jobs/${job.jobId}/cancel`, {
      method: "POST"
    });
    assert.equal(cancelResponse.status, 200);
    assert.equal((await cancelResponse.json()).status, "cancelled");

    const secondCancel = await fetch(`${baseUrl}/render-jobs/${job.jobId}/cancel`, {
      method: "POST"
    });
    assert.equal(secondCancel.status, 409);
    assert.equal((await secondCancel.json()).code, "render_job_conflict");
  });

  test("artifact delivery returns 404 for an unknown job", async () => {
    const response = await fetch(
      `${baseUrl}/render-jobs/00000000-0000-4000-8000-000000000000/artifacts/00000000-0000-4000-8000-000000000000/download-url`
    );
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "render_job_not_found");
  });

  test("artifact delivery returns a retryable 503 when storage is not configured", async () => {
    const serverWithoutStorage = createRenderJobHttpServer(store);
    await new Promise<void>((resolve) => serverWithoutStorage.listen(0, "127.0.0.1", resolve));
    try {
      const address = serverWithoutStorage.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/render-jobs/00000000-0000-4000-8000-000000000000/artifacts/00000000-0000-4000-8000-000000000000/download-url`
      );
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.code, "artifact_delivery_unavailable");
      assert.equal(body.retryable, true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        serverWithoutStorage.close((error) => error ? reject(error) : resolve())
      );
    }
  });

  async function submitAs(owner: string | null, renderId: string, key: string) {
    return fetch(`${baseUrl}/render-jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        ...(owner ? { "x-synaptix-owner": owner } : {})
      },
      body: JSON.stringify({ manifest: manifest(renderId) })
    });
  }

  test("players only see, follow and cancel their own render jobs", async () => {
    const alice = await (await submitAs("alice", "10000000-0000-4000-8000-000000000001", "key-a")).json();
    const bob = await (await submitAs("bob", "10000000-0000-4000-8000-000000000002", "key-b")).json();
    await submitAs(null, "10000000-0000-4000-8000-000000000003", "key-private");
    const asAlice = { headers: { "x-synaptix-owner": "alice" } };

    const listed = await (await fetch(`${baseUrl}/render-jobs`, asAlice)).json();
    assert.deepEqual(listed.jobs.map((job: { jobId: string }) => job.jobId), [alice.jobId]);
    assert.equal((await (await fetch(`${baseUrl}/render-jobs`)).json()).jobs.length, 3, "private callers stay unscoped");

    assert.equal((await fetch(`${baseUrl}/render-jobs/${alice.jobId}`, asAlice)).status, 200);
    for (const path of [`/render-jobs/${bob.jobId}`, `/render-jobs/${bob.jobId}/events`, `/renders/${bob.manifest.renderId}`]) {
      const response = await fetch(`${baseUrl}${path}`, asAlice);
      assert.equal(response.status, 404, path);
    }
    const cancel = await fetch(`${baseUrl}/render-jobs/${bob.jobId}/cancel`, { method: "POST", ...asAlice });
    assert.equal(cancel.status, 404);
    assert.equal((await (await fetch(`${baseUrl}/render-jobs/${bob.jobId}`)).json()).status, "queued");

    // Another player can't claim someone else's idempotency key.
    const reused = await submitAs("bob", "10000000-0000-4000-8000-000000000001", "key-a");
    assert.equal(reused.status, 409);
    assert.equal((await submitAs("alice,bob", "10000000-0000-4000-8000-000000000004", "key-list")).status, 400);
  });

  test("a render can be looked up by its render id", async () => {
    const job = await (await submitAs("alice", "10000000-0000-4000-8000-000000000005", "key-r")).json();
    const response = await fetch(`${baseUrl}/renders/${job.manifest.renderId}`, { headers: { "x-synaptix-owner": "alice" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).jobId, job.jobId);
    const missing = await fetch(`${baseUrl}/renders/10000000-0000-4000-8000-00000000ffff`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "render_not_found");
  });

  test("unknown routes return a 404 envelope", async () => {
    const response = await fetch(`${baseUrl}/nonexistent`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "not_found");
  });

  test("a player over the active-job limit gets 429 render_quota_exceeded", async () => {
    const limited = createRenderJobHttpServer(store, artifactDelivery, { maxActiveJobsPerOwner: 1 });
    await new Promise<void>((resolve) => limited.listen(0, resolve));
    const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}`;
    const submit = (renderId: string, key: string) =>
      fetch(`${url}/render-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key, "x-synaptix-owner": "alice" },
        body: JSON.stringify({ manifest: manifest(renderId) })
      });
    try {
      assert.equal((await submit("10000000-0000-4000-8000-000000000011", "lim-1")).status, 201);
      const refused = await submit("10000000-0000-4000-8000-000000000012", "lim-2");
      assert.equal(refused.status, 429);
      assert.equal((await refused.json()).code, "render_quota_exceeded");
    } finally {
      await new Promise<void>((resolve, reject) => limited.close((error) => error ? reject(error) : resolve()));
    }
  });
}

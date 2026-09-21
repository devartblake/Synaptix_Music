import assert from "node:assert/strict";
import test from "node:test";

import type { RenderJob } from "@synaptix/render-contracts";

import { buildAdaptiveDraft, eligibleAdaptiveRenders } from "./adaptive-authoring-model.ts";

const job = {
  contractVersion: "1.0.0", jobId: "10000000-0000-4000-8000-000000000001", idempotencyKey: "render-1",
  manifest: { contractVersion: "1.0.0", renderId: "10000000-0000-4000-8000-000000000002", projectId: "project-1", revisionId: "revision-1", projectChecksumSha256: "a".repeat(64), engineVersion: "1.0.0", seed: 1, scope: { kind: "master" }, range: { startTick: 0, endTick: 3840 }, output: { format: "wav", sampleRate: 48000, bitDepth: 24, normalizePeakDbfs: null, includeTailSeconds: 2 }, requestedAt: "2026-09-20T00:00:00.000Z" },
  status: "completed", attempt: 1, maxAttempts: 5, submittedAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:01:00.000Z", leaseOwnerId: null, leaseExpiresAt: null, nextAttemptAt: null,
  result: { contractVersion: "1.0.0", renderId: "10000000-0000-4000-8000-000000000002", status: "completed", artifacts: [{ artifactId: "10000000-0000-4000-8000-000000000003", renderId: "10000000-0000-4000-8000-000000000002", trackId: null, fileName: "master.wav", mediaType: "audio/wav", byteLength: 42, checksumSha256: "b".repeat(64), durationSeconds: 8 }], warnings: [], errorCode: null, errorMessage: null, completedAt: "2026-09-20T00:01:00.000Z" }, lastError: null
} satisfies RenderJob;

test("only completed project masters are eligible", () => {
  assert.deepEqual(eligibleAdaptiveRenders([job], "project-1"), [job]);
  assert.deepEqual(eligibleAdaptiveRenders([{ ...job, status: "running" }], "project-1"), []);
});

test("builds a validated draft while keeping publication outside the authoring model", () => {
  const manifest = buildAdaptiveDraft("10000000-0000-4000-8000-000000000004", "project-1", [{ jobId: job.jobId, stateId: "exploration", displayName: "Exploration", intensity: 0.35, tags: ["gameplay"] }], [job]);
  assert.equal(manifest.defaultStateId, "exploration");
  assert.equal(manifest.revisionId, "revision-1");
  assert.equal(manifest.states[0]?.masterArtifactId, job.result?.artifacts[0]?.artifactId);
});

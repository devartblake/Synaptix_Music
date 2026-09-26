import assert from "node:assert/strict";
import test from "node:test";

import type { RenderJob } from "@synaptix/render-contracts";

import {
  adaptiveStateRole,
  buildAdaptiveDraft,
  eligibleAdaptiveRenders,
  tagsForAdaptiveRole,
  type AdaptiveStateDraft
} from "./adaptive-authoring-model.ts";

const job = {
  contractVersion: "1.0.0",
  jobId: "10000000-0000-4000-8000-000000000001",
  idempotencyKey: "render-1",
  manifest: {
    contractVersion: "1.0.0",
    renderId: "10000000-0000-4000-8000-000000000002",
    projectId: "project-1",
    revisionId: "revision-1",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: "1.0.0",
    seed: 1,
    scope: { kind: "master" },
    range: { startTick: 0, endTick: 3840 },
    output: {
      format: "wav",
      sampleRate: 48000,
      bitDepth: 24,
      normalizePeakDbfs: null,
      includeTailSeconds: 2
    },
    requestedAt: "2026-09-20T00:00:00.000Z"
  },
  status: "completed",
  attempt: 1,
  maxAttempts: 5,
  submittedAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:01:00.000Z",
  leaseOwnerId: null,
  leaseExpiresAt: null,
  nextAttemptAt: null,
  result: {
    contractVersion: "1.0.0",
    renderId: "10000000-0000-4000-8000-000000000002",
    status: "completed",
    artifacts: [
      {
        artifactId: "10000000-0000-4000-8000-000000000003",
        renderId: "10000000-0000-4000-8000-000000000002",
        trackId: null,
        fileName: "master.wav",
        mediaType: "audio/wav",
        byteLength: 42,
        checksumSha256: "b".repeat(64),
        durationSeconds: 8
      }
    ],
    warnings: [],
    errorCode: null,
    errorMessage: null,
    completedAt: "2026-09-20T00:01:00.000Z"
  },
  lastError: null
} satisfies RenderJob;

test("only completed project masters are eligible", () => {
  assert.deepEqual(eligibleAdaptiveRenders([job], "project-1"), [job]);
  assert.deepEqual(eligibleAdaptiveRenders([{ ...job, status: "running" }], "project-1"), []);
});

test("builds a validated draft while keeping publication outside the authoring model", () => {
  const manifest = buildAdaptiveDraft(
    "10000000-0000-4000-8000-000000000004",
    "project-1",
    [
      {
        jobId: job.jobId,
        stateId: "exploration",
        displayName: "Exploration",
        intensity: 0.35,
        tags: ["gameplay"]
      }
    ],
    [job]
  );
  assert.equal(manifest.defaultStateId, "exploration");
  assert.equal(manifest.revisionId, "revision-1");
  assert.equal(manifest.states[0]?.masterArtifactId, job.result?.artifacts[0]?.artifactId);
});

function renderJob(n: number): RenderJob {
  const id = (suffix: number) => `10000000-0000-4000-8000-${String(n * 10 + suffix).padStart(12, "0")}`;
  return {
    ...job,
    jobId: id(1),
    manifest: { ...job.manifest, renderId: id(2) },
    result: {
      ...job.result,
      renderId: id(2),
      artifacts: [{ ...job.result.artifacts[0]!, artifactId: id(3), renderId: id(2) }]
    }
  };
}

function draftState(n: number, stateId: string, tags: string[]): AdaptiveStateDraft {
  return { jobId: renderJob(n).jobId, stateId, displayName: stateId, intensity: 0.5, tags };
}

const packageId = "10000000-0000-4000-8000-000000000004";
const jobs = [1, 2, 3, 4].map(renderJob);

test("role tags round-trip and keep the author's own tags", () => {
  assert.deepEqual(adaptiveStateRole(["gameplay"]), { kind: "music" });
  const stinger = tagsForAdaptiveRole({ kind: "stinger", cue: "victory" }, ["gameplay", "boss"]);
  assert.deepEqual(stinger, ["stinger", "victory", "boss"]);
  assert.deepEqual(adaptiveStateRole(stinger), { kind: "stinger", cue: "victory" });
  assert.deepEqual(tagsForAdaptiveRole({ kind: "music" }, stinger), ["boss"]);
  assert.deepEqual(tagsForAdaptiveRole({ kind: "music" }, ["stinger", "wrong"]), ["gameplay"]);
});

test("stingers stay out of the default state and the transition chain", () => {
  const manifest = buildAdaptiveDraft(
    packageId,
    "project-1",
    [
      draftState(1, "hit", ["stinger", "correct"]),
      draftState(2, "calm", ["gameplay"]),
      draftState(3, "fight", ["gameplay"])
    ],
    jobs
  );
  assert.equal(manifest.defaultStateId, "calm");
  assert.deepEqual(
    manifest.transitions.map((item) => [item.fromStateId, item.toStateId]),
    [["calm", "fight"]]
  );
  assert.deepEqual(manifest.states.find((item) => item.stateId === "hit")?.tags, ["correct", "stinger"]);
});

test("stinger drafts reject missing music, duplicate cues, and stinger transitions", () => {
  assert.throws(
    () => buildAdaptiveDraft(packageId, "project-1", [draftState(1, "hit", ["stinger", "correct"])], jobs),
    /at least one music state/
  );
  assert.throws(
    () =>
      buildAdaptiveDraft(
        packageId,
        "project-1",
        [
          draftState(1, "calm", ["gameplay"]),
          draftState(2, "hit-a", ["stinger", "victory"]),
          draftState(3, "hit-b", ["stinger", "victory"])
        ],
        jobs
      ),
    /one state/
  );
  assert.throws(
    () =>
      buildAdaptiveDraft(
        packageId,
        "project-1",
        [draftState(1, "calm", ["gameplay"]), draftState(2, "hit", ["stinger", "wrong"])],
        jobs,
        {
          transitions: [
            {
              transitionId: "calm-to-hit",
              fromStateId: "calm",
              toStateId: "hit",
              trigger: "immediate",
              crossfadeMilliseconds: 0,
              cuePointId: null,
              minimumSourcePlaybackSeconds: 0
            }
          ],
          cuePoints: []
        }
      ),
    /cannot be part of transitions/
  );
});

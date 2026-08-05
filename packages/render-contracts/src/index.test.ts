import assert from "node:assert/strict";
import test from "node:test";

import { RENDER_CONTRACT_VERSION, RenderManifestSchema, RenderResultSchema } from "./index.ts";

const manifest = {
  contractVersion: RENDER_CONTRACT_VERSION,
  renderId: "5bcdd06a-6c61-4f30-8e7e-9a2d876d0bc0",
  projectId: "project-a",
  revisionId: "revision-a",
  projectChecksumSha256: "a".repeat(64),
  engineVersion: "1.0.0",
  seed: 42,
  scope: { kind: "master" as const },
  range: { startTick: 0, endTick: 3840 },
  output: { format: "wav" as const, sampleRate: 48000 as const, bitDepth: 24 as const },
  requestedAt: "2026-08-05T07:30:00.000Z"
};

test("render manifest applies deterministic output defaults", () => {
  const parsed = RenderManifestSchema.parse(manifest);
  assert.equal(parsed.output.includeTailSeconds, 2);
  assert.equal(parsed.output.normalizePeakDbfs, null);
});

test("render range and completed-result evidence fail closed", () => {
  assert.throws(() => RenderManifestSchema.parse({
    ...manifest,
    range: { startTick: 100, endTick: 100 }
  }));

  assert.throws(() => RenderResultSchema.parse({
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId: manifest.renderId,
    status: "completed",
    artifacts: [],
    warnings: [],
    errorCode: null,
    errorMessage: null,
    completedAt: manifest.requestedAt
  }));
});

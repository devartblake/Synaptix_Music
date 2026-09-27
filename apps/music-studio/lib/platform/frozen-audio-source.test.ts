import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { FrozenPluginArtifactReference } from "@synaptix/project-model/v2";

import { createPlatformFrozenAudioSource } from "./frozen-audio-source.ts";

const audio = new Uint8Array([1, 2, 3, 4]);
const checksum = createHash("sha256").update(audio).digest("hex");
const reference = {
  renderId: "10000000-0000-4000-8000-000000000000", artifactId: "30000000-0000-4000-8000-000000000000",
  sourceProjectId: "project-1", artifactChecksumSha256: checksum
} as FrozenPluginArtifactReference;

function job(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "20000000-0000-4000-8000-000000000000", status: "completed",
    manifest: { renderId: reference.renderId, projectId: "project-1", range: { startTick: 960, endTick: 7680 } },
    result: { artifacts: [{ artifactId: reference.artifactId, checksumSha256: checksum }] },
    ...overrides
  };
}

function source(renderJob: unknown, bytes: Uint8Array = audio) {
  const urls: string[] = [];
  const fake = (async (url: string) => {
    urls.push(url);
    return url.startsWith("/api/platform/renders/") ? Response.json(renderJob) : new Response(bytes);
  }) as typeof fetch;
  return { load: createPlatformFrozenAudioSource(fake).load, urls };
}

test("frozen audio comes from the player's completed freeze render, checksum-verified", async () => {
  const { load, urls } = source(job());
  const loaded = await load(reference);
  assert.deepEqual(new Uint8Array(loaded.audio), audio);
  assert.equal(loaded.startTick, 960);
  assert.deepEqual(urls, [
    `/api/platform/renders/${reference.renderId}`,
    `/api/platform/render-jobs/20000000-0000-4000-8000-000000000000/artifacts/${reference.artifactId}/content`
  ]);
});

test("anything that doesn't match the freeze reference is refused", async () => {
  await assert.rejects(source(job({ status: "running" })).load(reference), /doesn't match this project/);
  await assert.rejects(source(job({ manifest: { ...job().manifest, projectId: "other" } })).load(reference), /doesn't match this project/);
  await assert.rejects(source(job({ result: { artifacts: [] } })).load(reference), /isn't part of that render/);
  await assert.rejects(source(job(), new Uint8Array([9])).load(reference), /doesn't match its checksum/);
});

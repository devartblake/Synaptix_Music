import assert from "node:assert/strict";
import test from "node:test";

import { cacheVerifiedRender, InMemoryMediaStore, RenderIntegrityError, sha256Blob } from "./media.ts";

async function metadata(blob: Blob, overrides: Record<string, unknown> = {}) {
  return {
    artifactId: "artifact-1", renderId: "render-1", jobId: "job-1", projectId: "project-1", revisionId: "revision-1",
    fileName: "master.wav", mediaType: "audio/wav", byteLength: blob.size, checksumSha256: await sha256Blob(blob),
    durationSeconds: 12.5,
    ...overrides
  };
}

test("verified renders are cached, listed per project, and removable", async () => {
  const store = new InMemoryMediaStore();
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });
  const cached = await cacheVerifiedRender(store, await metadata(blob), blob, () => "2026-09-26T10:00:00.000Z");
  assert.equal(cached.cachedAt, "2026-09-26T10:00:00.000Z");
  assert.equal("blob" in cached, false, "summaries never carry the audio bytes");

  const stored = await store.getRender("artifact-1");
  assert.equal(await sha256Blob(stored!.blob), cached.checksumSha256);
  assert.deepEqual((await store.listRenders("project-1")).map((render) => render.artifactId), ["artifact-1"]);
  assert.deepEqual(await store.listRenders("other"), []);

  await store.deleteRender("artifact-1");
  assert.equal(await store.getRender("artifact-1"), null);
});

test("truncated or tampered downloads are rejected and never stored", async () => {
  const store = new InMemoryMediaStore();
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
  await assert.rejects(cacheVerifiedRender(store, await metadata(blob, { byteLength: 5 }), blob), RenderIntegrityError);
  await assert.rejects(cacheVerifiedRender(store, await metadata(blob, { checksumSha256: "0".repeat(64) }), blob), RenderIntegrityError);
  assert.deepEqual(await store.listRenders(), []);
});

test("cover artwork is stored and replaced per project", async () => {
  const store = new InMemoryMediaStore();
  const record = { projectId: "project-1", blob: new Blob(["png"]), mediaType: "image/png", width: 1024, height: 1024, updatedAt: "2026-09-26T10:00:00.000Z" };
  await store.putArtwork(record);
  await store.putArtwork({ ...record, mediaType: "image/webp" });
  assert.equal((await store.getArtwork("project-1"))!.mediaType, "image/webp");
  await store.deleteArtwork("project-1");
  assert.equal(await store.getArtwork("project-1"), null);
});

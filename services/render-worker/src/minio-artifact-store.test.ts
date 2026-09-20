import assert from "node:assert/strict";
import test from "node:test";

import type { RenderedArtifact } from "./offline-renderer.ts";
import {
  MinioArtifactStore,
  minioArtifactStoreFromEnv,
  renderArtifactObjectName,
  type MinioClientLike
} from "./minio-artifact-store.ts";

class FakeMinioClient implements MinioClientLike {
  uploads: Array<{
    bucket: string;
    objectName: string;
    bytes: Buffer;
    metadata?: Record<string, string>;
  }> = [];

  async putObject(
    bucket: string,
    objectName: string,
    bytes: Buffer,
    _size: number,
    metadata?: Record<string, string>
  ) {
    this.uploads.push({ bucket, objectName, bytes, metadata });
    return {};
  }

  async presignedGetObject(bucket: string, objectName: string, expires = 0): Promise<string> {
    return `https://objects.example/${bucket}/${objectName}?expires=${expires}`;
  }
}

function artifact(): RenderedArtifact {
  return {
    metadata: {
      artifactId: "20000000-0000-4000-8000-000000000000",
      renderId: "10000000-0000-4000-8000-000000000000",
      trackId: null,
      fileName: "master.wav",
      mediaType: "audio/wav",
      byteLength: 4,
      checksumSha256: "a".repeat(64),
      durationSeconds: 1
    },
    bytes: Buffer.from([1, 2, 3, 4])
  };
}

test("stores render artifacts under a deterministic least-privilege prefix", async () => {
  const client = new FakeMinioClient();
  const store = new MinioArtifactStore(
    {
      endpoint: "localhost",
      accessKey: "access",
      secretKey: "secret",
      bucket: "synaptix-assets"
    },
    client
  );
  await store.store(artifact().metadata.renderId, artifact());

  assert.equal(client.uploads[0]?.bucket, "synaptix-assets");
  assert.equal(
    client.uploads[0]?.objectName,
    "renders/10000000-0000-4000-8000-000000000000/master.wav"
  );
  assert.equal(client.uploads[0]?.metadata?.["Content-Type"], "audio/wav");
  assert.equal(client.uploads[0]?.metadata?.["X-Amz-Meta-Sha256"], "a".repeat(64));
});

test("creates a bounded short-lived download URL", async () => {
  const store = new MinioArtifactStore(
    {
      endpoint: "localhost",
      accessKey: "access",
      secretKey: "secret",
      bucket: "synaptix-assets",
      downloadExpirySeconds: 600
    },
    new FakeMinioClient()
  );
  assert.match(await store.createDownloadUrl("render-a", "master.wav", 300), /expires=300$/);
  await assert.rejects(
    () => store.createDownloadUrl("render-a", "master.wav", 601),
    /between 1 and 600/
  );
});

test("rejects path traversal and mismatched render metadata", async () => {
  assert.throws(() => renderArtifactObjectName("../render", "master.wav"), /safe path segment/);
  const store = new MinioArtifactStore(
    {
      endpoint: "localhost",
      accessKey: "access",
      secretKey: "secret",
      bucket: "synaptix-assets"
    },
    new FakeMinioClient()
  );
  await assert.rejects(() => store.store("different-render", artifact()), /does not match/);
});

test("environment configuration is opt-in and complete", () => {
  assert.equal(minioArtifactStoreFromEnv({}), null);
  assert.throws(
    () => minioArtifactStoreFromEnv({ RENDER_WORKER_MINIO_ENDPOINT: "minio" }),
    /must be configured together/
  );
  assert.ok(
    minioArtifactStoreFromEnv({
      RENDER_WORKER_MINIO_ENDPOINT: "minio",
      RENDER_WORKER_MINIO_ACCESS_KEY: "access",
      RENDER_WORKER_MINIO_SECRET_KEY: "secret"
    })
  );
});

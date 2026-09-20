import assert from "node:assert/strict";
import test from "node:test";

import {
  RENDER_ARTIFACT_MANIFEST_VERSION,
  RENDER_CONTRACT_VERSION,
  RenderArtifactManifestSchema,
  type RenderManifest
} from "@synaptix/render-contracts";

import { packageRenderArtifacts } from "./artifact-packager.ts";
import type { AudioTranscodeRequest, AudioTranscoder } from "./ffmpeg-transcoder.ts";
import type { OfflineRenderOutcome } from "./offline-renderer.ts";

const renderId = "10000000-0000-4000-8000-000000000000";

function manifest(format: "wav" | "mp3" | "ogg", preview = false): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId,
    projectId: "project-a",
    revisionId: "revision-a",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: "1.0.0",
    seed: 1,
    scope: { kind: "master" },
    range: { startTick: 0, endTick: 3840 },
    output: {
      format,
      sampleRate: 44100,
      bitDepth: 16,
      normalizePeakDbfs: null,
      includeTailSeconds: 0,
      lossyBitrateKbps: 192,
      ...(preview
        ? { preview: { format: "mp3", bitrateKbps: 96, maxDurationSeconds: 30 } as const }
        : {})
    },
    requestedAt: "2026-09-20T00:00:00.000Z"
  };
}

function outcome(): OfflineRenderOutcome {
  const bytes = Buffer.from("wav-source");
  const metadata = {
    artifactId: "10000000-0000-4000-8000-000000000001",
    renderId,
    trackId: null,
    fileName: "master.wav",
    mediaType: "audio/wav",
    byteLength: bytes.length,
    checksumSha256: "b".repeat(64),
    durationSeconds: 45
  };
  return {
    artifacts: [{ metadata, bytes }],
    result: {
      contractVersion: RENDER_CONTRACT_VERSION,
      renderId,
      status: "completed",
      artifacts: [metadata],
      warnings: [],
      errorCode: null,
      errorMessage: null,
      completedAt: "2026-09-20T00:01:00.000Z"
    }
  };
}

class RecordingTranscoder implements AudioTranscoder {
  readonly requests: AudioTranscodeRequest[] = [];
  async transcodeWav(_bytes: Buffer, request: AudioTranscodeRequest): Promise<Buffer> {
    this.requests.push(request);
    return Buffer.from(
      `${request.format}:${request.bitrateKbps}:${request.maxDurationSeconds ?? "full"}`
    );
  }
}

test("packages a requested lossy master, preview, and validated artifact manifest", async () => {
  const transcoder = new RecordingTranscoder();
  const packaged = await packageRenderArtifacts(outcome(), manifest("ogg", true), transcoder);

  assert.deepEqual(
    packaged.artifacts.map((item) => item.metadata.fileName),
    ["master.ogg", "preview.mp3", "artifact-manifest.json"]
  );
  assert.deepEqual(transcoder.requests, [
    { format: "ogg", bitrateKbps: 192 },
    { format: "mp3", bitrateKbps: 96, maxDurationSeconds: 30 }
  ]);
  assert.equal(packaged.artifacts[1]?.metadata.durationSeconds, 30);

  const artifactManifest = RenderArtifactManifestSchema.parse(
    JSON.parse(packaged.artifacts[2]!.bytes.toString("utf8"))
  );
  assert.equal(artifactManifest.contractVersion, RENDER_ARTIFACT_MANIFEST_VERSION);
  assert.equal(artifactManifest.outputFormat, "ogg");
  assert.equal(artifactManifest.artifacts.length, 2);
  assert.equal(artifactManifest.previewArtifactId, packaged.artifacts[1]?.metadata.artifactId);
});

test("keeps certified WAV bytes and still emits an artifact manifest", async () => {
  const transcoder = new RecordingTranscoder();
  const source = outcome();
  const packaged = await packageRenderArtifacts(source, manifest("wav"), transcoder);

  assert.equal(transcoder.requests.length, 0);
  assert.ok(packaged.artifacts[0]!.bytes.equals(source.artifacts[0]!.bytes));
  assert.equal(packaged.artifacts[1]?.metadata.fileName, "artifact-manifest.json");
});

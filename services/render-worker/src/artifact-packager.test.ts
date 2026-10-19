import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  RENDER_ENGINE_VERSION,
  RENDER_ARTIFACT_MANIFEST_VERSION,
  RENDER_CONTRACT_VERSION,
  RenderArtifactManifestSchema,
  type RenderManifest
} from "@synaptix/render-contracts";

import { packageRenderArtifacts } from "./artifact-packager.ts";
import type { AudioTranscodeRequest, AudioTranscoder } from "./ffmpeg-transcoder.ts";
import type { OfflineRenderOutcome } from "./offline-renderer.ts";
import type { AudioWatermarker } from "./watermark-client.ts";

const renderId = "10000000-0000-4000-8000-000000000000";

function manifest(format: "wav" | "mp3" | "ogg", preview = false): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId,
    projectId: "project-a",
    revisionId: "revision-a",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: RENDER_ENGINE_VERSION,
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

test("the artifact manifest names the engine that rendered it, not the one the request named", async () => {
  // The worker refuses mismatched requests before rendering (engine-version.ts); this is the
  // second half: what it writes comes from its own engine constant.
  const request = { ...manifest("wav"), engineVersion: "0.9.0" };
  const packaged = await packageRenderArtifacts(outcome(), request, new RecordingTranscoder());
  const artifactManifest = RenderArtifactManifestSchema.parse(
    JSON.parse(packaged.artifacts[1]!.bytes.toString("utf8"))
  );
  assert.equal(artifactManifest.engineVersion, RENDER_ENGINE_VERSION);
});

test("keeps certified WAV bytes and still emits an artifact manifest", async () => {
  const transcoder = new RecordingTranscoder();
  const source = outcome();
  const packaged = await packageRenderArtifacts(source, manifest("wav"), transcoder);

  assert.equal(transcoder.requests.length, 0);
  assert.ok(packaged.artifacts[0]!.bytes.equals(source.artifacts[0]!.bytes));
  assert.equal(packaged.artifacts[1]?.metadata.fileName, "artifact-manifest.json");
});

// Publication rules phase 2: exported music carries an inaudible watermark (EU AI Act Art. 50).
class FakeWatermarker implements AudioWatermarker {
  calls = 0;
  async markWav(wav: Buffer): Promise<Buffer> {
    this.calls += 1;
    return Buffer.concat([wav, Buffer.from("+mark")]);
  }
}

class InputRecordingTranscoder implements AudioTranscoder {
  readonly inputs: string[] = [];
  async transcodeWav(bytes: Buffer, request: AudioTranscodeRequest): Promise<Buffer> {
    this.inputs.push(bytes.toString());
    return Buffer.from(request.format);
  }
}

test("a delivered WAV is the marked audio, with its size and checksum recomputed", async () => {
  const packaged = await packageRenderArtifacts(outcome(), manifest("wav"), new RecordingTranscoder(), new FakeWatermarker());
  const master = packaged.artifacts[0]!;
  assert.equal(master.bytes.toString(), "wav-source+mark");
  assert.equal(master.metadata.byteLength, master.bytes.length);
  assert.equal(master.metadata.checksumSha256, createHash("sha256").update(master.bytes).digest("hex"));
  // The manifest lists the marked file, so delivery verification checks what was actually stored.
  const listed = RenderArtifactManifestSchema.parse(JSON.parse(packaged.artifacts[1]!.bytes.toString("utf8")));
  assert.equal(listed.artifacts[0]!.checksumSha256, master.metadata.checksumSha256);
});

test("lossy files and previews are transcoded from the marked WAV, so every format carries the mark", async () => {
  const transcoder = new InputRecordingTranscoder();
  await packageRenderArtifacts(outcome(), manifest("mp3", true), transcoder, new FakeWatermarker());
  assert.deepEqual(transcoder.inputs, ["wav-source+mark", "wav-source+mark"]);
});

test("plug-in freezes aren't marked: the master that plays them back is", async () => {
  const watermarker = new FakeWatermarker();
  const freeze = { ...manifest("wav"), scope: { kind: "plugin-freeze", trackId: "t", deviceId: "d" } } as RenderManifest;
  const packaged = await packageRenderArtifacts(outcome(), freeze, new RecordingTranscoder(), watermarker);
  assert.equal(watermarker.calls, 0);
  assert.equal(packaged.artifacts[0]!.bytes.toString(), "wav-source");
});

test("a watermark failure fails the render rather than delivering unmarked audio", async () => {
  const failing: AudioWatermarker = { markWav: async () => { throw new Error("Watermarking failed with 503."); } };
  await assert.rejects(
    packageRenderArtifacts(outcome(), manifest("mp3"), new RecordingTranscoder(), failing),
    /Watermarking failed with 503/
  );
});

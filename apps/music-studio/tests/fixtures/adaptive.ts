import { createHash } from "node:crypto";
import { createEmptyProject } from "@synaptix/project-model";
import type { RenderJob } from "@synaptix/render-contracts";

export const fixtureId = (value: number) =>
  `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const fixtureHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function adaptiveFixture() {
  const project = createEmptyProject(fixtureId(1), {
    revisionId: "adaptive-revision",
    now: "2026-09-23T00:00:00.000Z"
  });
  const audio = Buffer.alloc(44 + 16000 * 2 * 2);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  for (let index = 0; index < 32000; index++)
    audio.writeInt16LE(
      Math.round(Math.sin((index / 16000) * Math.PI * 2 * 220) * 500),
      44 + index * 2
    );
  const fixtures = [10, 20].map((base) => {
    const renderId = fixtureId(base);
    const master = {
      artifactId: fixtureId(base + 1),
      renderId,
      trackId: null,
      fileName: "master.wav",
      mediaType: "audio/wav",
      byteLength: audio.length,
      checksumSha256: fixtureHash(audio),
      durationSeconds: 2
    };
    const preview = {
      ...master,
      artifactId: fixtureId(base + 2),
      fileName: "preview.mp3",
      mediaType: "audio/mpeg"
    };
    const manifest = {
      contractVersion: "1.0.0" as const,
      renderId,
      projectId: project.projectId,
      revisionId: project.revisionId,
      projectChecksumSha256: "a".repeat(64),
      engineVersion: "1.0.0",
      seed: 1,
      scope: { kind: "master" as const },
      range: { startTick: 0, endTick: 3840 },
      output: {
        format: "wav" as const,
        sampleRate: 48000 as const,
        bitDepth: 24 as const,
        normalizePeakDbfs: null,
        includeTailSeconds: 0
      },
      requestedAt: project.metadata.createdAt
    };
    const artifactBytes = Buffer.from(
      JSON.stringify({
        contractVersion: "1.0.0",
        renderId,
        projectId: project.projectId,
        revisionId: project.revisionId,
        projectChecksumSha256: manifest.projectChecksumSha256,
        engineVersion: "1.0.0",
        outputFormat: "wav",
        scope: manifest.scope,
        range: manifest.range,
        artifacts: [master, preview],
        previewArtifactId: preview.artifactId,
        createdAt: manifest.requestedAt
      })
    );
    const manifestArtifact = {
      ...master,
      artifactId: fixtureId(base + 3),
      fileName: "artifact-manifest.json",
      mediaType: "application/vnd.synaptix.render-manifest+json",
      checksumSha256: fixtureHash(artifactBytes),
      byteLength: artifactBytes.length
    };
    const artifacts = [master, preview, manifestArtifact];
    const job: RenderJob = {
      contractVersion: "1.0.0",
      jobId: fixtureId(base + 4),
      idempotencyKey: `adaptive-${base}`,
      manifest,
      status: "completed",
      attempt: 1,
      maxAttempts: 5,
      submittedAt: manifest.requestedAt,
      updatedAt: manifest.requestedAt,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      lastError: null,
      result: {
        contractVersion: "1.0.0",
        renderId,
        status: "completed",
        artifacts,
        warnings: [],
        errorCode: null,
        errorMessage: null,
        completedAt: manifest.requestedAt
      }
    };
    const report = {
      certificationVersion: "1.0.0",
      passed: true,
      certifiedAt: manifest.requestedAt,
      renderWorkerApiUrl: "https://staging.example.test",
      jobId: job.jobId,
      renderId,
      projectId: project.projectId,
      revisionId: project.revisionId,
      outputFormat: "wav",
      artifactManifestChecksumSha256: manifestArtifact.checksumSha256,
      artifacts: artifacts.map(
        ({ artifactId, fileName, mediaType, byteLength, checksumSha256 }) => ({
          artifactId,
          fileName,
          mediaType,
          byteLength,
          checksumSha256
        })
      )
    };
    const location = {
      artifactId: master.artifactId,
      storageKey: `test/${renderId}/master.wav`,
      mediaType: master.mediaType,
      checksumSha256: master.checksumSha256,
      byteLength: master.byteLength
    };
    return { job, report, artifactBytes, location };
  });
  return {
    project,
    audio,
    fixtures,
    jobs: fixtures.map((value) => value.job),
    locations: fixtures.map((value) => value.location)
  };
}

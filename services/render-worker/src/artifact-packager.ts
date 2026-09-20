import { createHash } from "node:crypto";

import {
  RENDER_ARTIFACT_MANIFEST_VERSION,
  RenderArtifactManifestSchema,
  type RenderArtifact,
  type RenderManifest,
  type RenderResult
} from "@synaptix/render-contracts";

import type { AudioTranscoder, LossyAudioFormat } from "./ffmpeg-transcoder.ts";
import type { OfflineRenderOutcome, RenderedArtifact } from "./offline-renderer.ts";

const MEDIA_TYPES: Record<LossyAudioFormat, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg"
};

function replaceExtension(fileName: string, format: LossyAudioFormat): string {
  return `${fileName.replace(/\.[^.]+$/, "")}.${format}`;
}

function metadataFor(
  source: RenderArtifact,
  fileName: string,
  mediaType: string,
  bytes: Buffer,
  durationSeconds = source.durationSeconds
): RenderArtifact {
  return {
    ...source,
    artifactId: crypto.randomUUID(),
    fileName,
    mediaType,
    byteLength: bytes.length,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    durationSeconds
  };
}

async function requestedArtifacts(
  outcome: OfflineRenderOutcome,
  manifest: RenderManifest,
  transcoder: AudioTranscoder
): Promise<RenderedArtifact[]> {
  if (manifest.output.format === "wav") return outcome.artifacts;
  const format = manifest.output.format;
  const bitrateKbps = manifest.output.lossyBitrateKbps ?? (format === "mp3" ? 192 : 160);
  return Promise.all(
    outcome.artifacts.map(async (source) => {
      const bytes = await transcoder.transcodeWav(source.bytes, { format, bitrateKbps });
      return {
        bytes,
        metadata: metadataFor(
          source.metadata,
          replaceExtension(source.metadata.fileName, format),
          MEDIA_TYPES[format],
          bytes
        )
      };
    })
  );
}

async function previewArtifact(
  outcome: OfflineRenderOutcome,
  manifest: RenderManifest,
  transcoder: AudioTranscoder
): Promise<RenderedArtifact | null> {
  const preview = manifest.output.preview;
  if (!preview || manifest.scope.kind !== "master") return null;
  const source = outcome.artifacts.find((artifact) => artifact.metadata.trackId === null);
  if (!source) throw new Error("A master preview requires a rendered master artifact.");
  const bytes = await transcoder.transcodeWav(source.bytes, {
    format: preview.format,
    bitrateKbps: preview.bitrateKbps,
    maxDurationSeconds: preview.maxDurationSeconds
  });
  return {
    bytes,
    metadata: metadataFor(
      source.metadata,
      `preview.${preview.format}`,
      MEDIA_TYPES[preview.format],
      bytes,
      Math.min(source.metadata.durationSeconds, preview.maxDurationSeconds)
    )
  };
}

function manifestArtifact(
  manifest: RenderManifest,
  artifacts: RenderedArtifact[],
  preview: RenderedArtifact | null,
  completedAt: string
): RenderedArtifact {
  const payload = RenderArtifactManifestSchema.parse({
    contractVersion: RENDER_ARTIFACT_MANIFEST_VERSION,
    renderId: manifest.renderId,
    projectId: manifest.projectId,
    revisionId: manifest.revisionId,
    projectChecksumSha256: manifest.projectChecksumSha256,
    engineVersion: manifest.engineVersion,
    outputFormat: manifest.output.format,
    scope: manifest.scope,
    range: manifest.range,
    artifacts: artifacts.map((artifact) => artifact.metadata),
    previewArtifactId: preview?.metadata.artifactId ?? null,
    createdAt: completedAt
  });
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const durationSeconds = Math.max(
    ...artifacts.map((artifact) => artifact.metadata.durationSeconds)
  );
  return {
    bytes,
    metadata: {
      artifactId: crypto.randomUUID(),
      renderId: manifest.renderId,
      trackId: null,
      fileName: "artifact-manifest.json",
      mediaType: "application/vnd.synaptix.render-manifest+json",
      byteLength: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      durationSeconds
    }
  };
}

/** Converts the deterministic WAV intermediate into delivery artifacts and a signed-delivery manifest. */
export async function packageRenderArtifacts(
  outcome: OfflineRenderOutcome,
  manifest: RenderManifest,
  transcoder: AudioTranscoder
): Promise<OfflineRenderOutcome> {
  const audio = await requestedArtifacts(outcome, manifest, transcoder);
  const preview = await previewArtifact(outcome, manifest, transcoder);
  const deliverables = preview ? [...audio, preview] : audio;
  const packageManifest = manifestArtifact(
    manifest,
    deliverables,
    preview,
    outcome.result.completedAt
  );
  const artifacts = [...deliverables, packageManifest];
  const result: RenderResult = {
    ...outcome.result,
    artifacts: artifacts.map((item) => item.metadata)
  };
  return { result, artifacts };
}

import { createHash } from "node:crypto";

import {
  RENDER_ARTIFACT_MANIFEST_VERSION,
  RENDER_ENGINE_VERSION,
  RenderArtifactManifestSchema,
  type RenderArtifact,
  type RenderManifest,
  type RenderResult
} from "@synaptix/render-contracts";

import type { AudioTranscoder, LossyAudioFormat } from "./ffmpeg-transcoder.ts";
import type { OfflineRenderOutcome, RenderedArtifact } from "./offline-renderer.ts";
import { withWavInfo, type AiTags } from "./ai-marking.ts";
import type { AudioWatermarker, ContentCredentialSigner } from "./watermark-client.ts";

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

/** How exports are marked as AI-involved (publication-rules-v1, phase 2); all parts optional. */
export interface AiMarking {
  watermarker?: AudioWatermarker | null;
  signer?: ContentCredentialSigner | null;
  tags?: AiTags | null;
}

const tagRequest = (tags: AiTags | null | undefined) => (tags ? { tags } : {});

async function requestedArtifacts(
  outcome: OfflineRenderOutcome,
  manifest: RenderManifest,
  transcoder: AudioTranscoder,
  tags: AiTags | null | undefined
): Promise<RenderedArtifact[]> {
  if (manifest.output.format === "wav") {
    if (!tags) return outcome.artifacts;
    return outcome.artifacts.map((source) => {
      const bytes = withWavInfo(source.bytes, tags);
      return { bytes, metadata: { ...source.metadata, byteLength: bytes.length, checksumSha256: sha256(bytes) } };
    });
  }
  const format = manifest.output.format;
  const bitrateKbps = manifest.output.lossyBitrateKbps ?? (format === "mp3" ? 192 : 160);
  return Promise.all(
    outcome.artifacts.map(async (source) => {
      const bytes = await transcoder.transcodeWav(source.bytes, { format, bitrateKbps, ...tagRequest(tags) });
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
  transcoder: AudioTranscoder,
  tags: AiTags | null | undefined
): Promise<RenderedArtifact | null> {
  const preview = manifest.output.preview;
  if (!preview || manifest.scope.kind !== "master") return null;
  const source = outcome.artifacts.find((artifact) => artifact.metadata.trackId === null);
  if (!source) throw new Error("A master preview requires a rendered master artifact.");
  const bytes = await transcoder.transcodeWav(source.bytes, {
    format: preview.format,
    bitrateKbps: preview.bitrateKbps,
    maxDurationSeconds: preview.maxDurationSeconds,
    ...tagRequest(tags)
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
    // Stamped by the worker, not copied from the request (assertWorkerEngine keeps them equal).
    engineVersion: RENDER_ENGINE_VERSION,
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

/**
 * Marks each rendered WAV before anything is derived from it, so every delivered format carries the
 * watermark. Plug-in freezes are intermediates that a later master or stem render plays back, and
 * that render is marked, so they are left alone (marking twice would stack two marks).
 */
async function watermarked(
  outcome: OfflineRenderOutcome,
  manifest: RenderManifest,
  watermarker: AudioWatermarker | null
): Promise<OfflineRenderOutcome> {
  if (!watermarker || manifest.scope.kind === "plugin-freeze") return outcome;
  const artifacts = await Promise.all(
    outcome.artifacts.map(async (artifact) => {
      const bytes = await watermarker.markWav(artifact.bytes);
      return { bytes, metadata: { ...artifact.metadata, byteLength: bytes.length, checksumSha256: sha256(bytes) } };
    })
  );
  return { ...outcome, artifacts };
}

const SIGNABLE: Record<string, "audio/wav" | "audio/mpeg"> = { "audio/wav": "audio/wav", "audio/mpeg": "audio/mpeg" };

/**
 * Signs C2PA content credentials into each WAV and MP3 deliverable, last, since the signature covers
 * the final bytes (tags included). Every render is signed: hand-composed music is stated as human work.
 * The C2PA SDK can't bind to OGG, so OGG files keep the watermark and tags only.
 */
async function signed(
  deliverables: RenderedArtifact[],
  manifest: RenderManifest,
  signer: ContentCredentialSigner | null | undefined
): Promise<RenderedArtifact[]> {
  if (!signer || manifest.scope.kind === "plugin-freeze") return deliverables;
  return Promise.all(
    deliverables.map(async (artifact) => {
      const mediaType = SIGNABLE[artifact.metadata.mediaType];
      if (!mediaType) return artifact;
      const bytes = await signer.sign(artifact.bytes, mediaType, manifest.projectId, manifest.revisionId);
      return { bytes, metadata: { ...artifact.metadata, byteLength: bytes.length, checksumSha256: sha256(bytes) } };
    })
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Converts the deterministic WAV intermediate into delivery artifacts and a signed-delivery manifest. */
export async function packageRenderArtifacts(
  rendered: OfflineRenderOutcome,
  manifest: RenderManifest,
  transcoder: AudioTranscoder,
  marking: AiMarking = {}
): Promise<OfflineRenderOutcome> {
  // A plug-in freeze is an intermediate, never delivered; the render that plays it back is marked.
  const tags = manifest.scope.kind === "plugin-freeze" ? null : marking.tags;
  const outcome = await watermarked(rendered, manifest, marking.watermarker ?? null);
  const audio = await requestedArtifacts(outcome, manifest, transcoder, tags);
  const preview = await previewArtifact(outcome, manifest, transcoder, tags);
  const deliverables = await signed(preview ? [...audio, preview] : audio, manifest, marking.signer);
  const previewArtifactSigned = preview ? deliverables[deliverables.length - 1]! : null;
  const packageManifest = manifestArtifact(
    manifest,
    deliverables,
    previewArtifactSigned,
    outcome.result.completedAt
  );
  const artifacts = [...deliverables, packageManifest];
  const result: RenderResult = {
    ...outcome.result,
    artifacts: artifacts.map((item) => item.metadata)
  };
  return { result, artifacts };
}

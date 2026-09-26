import { computeProjectChecksum } from "@synaptix/command-system";
import { MusicProjectSchema, type MusicProject } from "@synaptix/project-model";
import { RenderManifestSchema, type RenderManifest } from "@synaptix/render-contracts";
import { arrangementBars, barTicks } from "../editor/timeline-model.ts";

export interface ExportOptions {
  scope: "master" | "stems";
  format: "wav" | "mp3" | "ogg";
  sampleRate: 44100 | 48000 | 96000;
  bitDepth: 16 | 24 | 32;
  tail: number;
  normalize: boolean;
  trackIds: string[];
}
export async function createExportManifest(
  project: MusicProject,
  options: ExportOptions
): Promise<RenderManifest> {
  const canonical = MusicProjectSchema.parse(project);
  if (canonical.tracks.some((track) => track.kind === "audio" && track.clips.length)) {
    throw new Error(
      "This renderer supports instrument tracks. Audio clips must be rendered separately."
    );
  }
  if (!canonical.tracks.some((track) => track.kind === "instrument"))
    throw new Error("Add an instrument track before exporting.");
  if (
    options.scope === "stems" &&
    options.trackIds.some(
      (id) => !canonical.tracks.some((track) => track.id === id && track.kind === "instrument")
    )
  ) {
    throw new Error("Choose existing instrument tracks for stems.");
  }
  return RenderManifestSchema.parse({
    contractVersion: "1.0.0",
    renderId: crypto.randomUUID(),
    projectId: canonical.projectId,
    revisionId: canonical.revisionId,
    projectChecksumSha256: await computeProjectChecksum(canonical),
    engineVersion: "1.0.0",
    seed: Math.abs(canonical.generationMetadata?.seed ?? 0),
    scope:
      options.scope === "master"
        ? { kind: "master" }
        : { kind: "stems", trackIds: options.trackIds },
    range: { startTick: 0, endTick: arrangementBars(canonical) * barTicks(canonical) },
    output: {
      format: options.format,
      sampleRate: options.sampleRate,
      bitDepth: options.bitDepth,
      normalizePeakDbfs: options.normalize ? -1 : null,
      includeTailSeconds: options.tail
    },
    requestedAt: new Date().toISOString()
  });
}

export function safeDownloadUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("The download link is missing.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("The download link is invalid.");
  return url.href;
}

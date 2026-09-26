import { z } from "zod";
import { canonicalizeProject, computeProjectChecksum } from "@synaptix/command-system";
import { MusicProjectSchema, type MusicProject } from "@synaptix/project-model";
import { MusicProjectV2Schema, projectV2BuiltinView, type AnyMusicProject } from "@synaptix/project-model/v2";
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

export const SYNC_BEFORE_RENDER_MESSAGE =
  "Save and sync this exact project revision before rendering. Resolve any cloud conflict, then retry.";

type RenderScope = RenderManifest["scope"];

/**
 * Enabled plug-ins (not built-in instruments) on the tracks a render covers. The render worker
 * cannot run them yet and fails such jobs closed, so the studio says so before submitting.
 */
export function livePluginsInScope(
  project: AnyMusicProject,
  scope: RenderScope
): { trackName: string; pluginId: string }[] {
  if (project.schemaVersion === 1) return [];
  const inScope = scope.kind === "stems" ? new Set(scope.trackIds) : null;
  return project.tracks.flatMap((track) =>
    inScope && !inScope.has(track.id)
      ? []
      : track.devices
          .filter((device) => device.enabled && device.plugin.runtimeKind !== "builtin")
          .map((device) => ({ trackName: track.name, pluginId: device.plugin.pluginId }))
  );
}

export function describeLivePlugins(plugins: { trackName: string; pluginId: string }[]): string {
  const list = plugins.map((plugin) => `${plugin.pluginId} on ${plugin.trackName}`).join(", ");
  return `The renderer can't play plug-ins yet (${list}). Turn them off for this export, or render the other tracks as stems.`;
}

const PlatformSnapshotSchema = z.object({
  project: z.discriminatedUnion("schemaVersion", [MusicProjectSchema, MusicProjectV2Schema]),
  checksumSha256: z.string().optional(),
  revision: z.object({ checksumSha256: z.string() }).partial().passthrough().optional()
});

function playableContent(project: AnyMusicProject): string {
  // The parent can differ when an upload was rebased onto the last revision the platform knows.
  return canonicalizeProject({ ...projectV2BuiltinView(project), parentRevisionId: null });
}

/**
 * Pins a render to the snapshot the platform stored for this revision, in whichever schema
 * version it was uploaded. Publication later requires this exact checksum, so it must describe
 * the stored bytes, not the editor's view of them.
 */
export async function pinManifestToPlatformRevision(
  manifest: RenderManifest,
  local: AnyMusicProject,
  platformResponse: unknown
): Promise<RenderManifest> {
  const parsed = PlatformSnapshotSchema.safeParse(platformResponse);
  if (!parsed.success) throw new Error(SYNC_BEFORE_RENDER_MESSAGE);
  const remote = parsed.data.project;
  if (remote.projectId !== manifest.projectId || remote.revisionId !== manifest.revisionId)
    throw new Error(SYNC_BEFORE_RENDER_MESSAGE);

  const checksum = await computeProjectChecksum(remote);
  const stored = parsed.data.revision?.checksumSha256 ?? parsed.data.checksumSha256;
  if (stored !== undefined && stored !== checksum)
    throw new Error("The cloud copy of this revision doesn't match its checksum. Save a new revision, sync, then retry.");
  if (playableContent(remote) !== playableContent(local)) throw new Error(SYNC_BEFORE_RENDER_MESSAGE);

  const plugins = livePluginsInScope(remote, manifest.scope);
  if (plugins.length) throw new Error(describeLivePlugins(plugins));
  return RenderManifestSchema.parse({ ...manifest, projectChecksumSha256: checksum });
}

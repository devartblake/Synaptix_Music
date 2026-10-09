import { computeProjectChecksum } from "@synaptix/command-system";
import { computePluginStateChecksum, computeSignalChainChecksum } from "@synaptix/project-model/plugin";
import {
  MusicProjectV2Schema,
  projectV2BuiltinView,
  type DeviceV2,
  type FrozenPluginArtifactReference,
  type MusicProjectV2
} from "@synaptix/project-model/v2";
import { RENDER_CONTRACT_VERSION, RENDER_ENGINE_VERSION, RenderManifestSchema, type RenderJob, type RenderManifest } from "@synaptix/render-contracts";

import { arrangementBars, barTicks } from "../editor/timeline-model.ts";

/**
 * Plug-ins the render worker can freeze (first-party, with a deterministic offline processor).
 * Must match services/render-worker/src/plugin-processors.ts.
 */
const FREEZABLE = new Set(["synaptix.reference-drive@1.0.0"]);

export function canFreeze(device: DeviceV2): boolean {
  return FREEZABLE.has(`${device.plugin.pluginId}@${device.plugin.version}`) && device.automation.length === 0;
}

export class FreezeError extends Error {}

/** The platform's stored copy of this revision, which the freeze must render from. */
export async function storedRevision(response: unknown, local: MusicProjectV2): Promise<MusicProjectV2> {
  const body = response as { project?: unknown; revision?: { checksumSha256?: unknown }; checksumSha256?: unknown } | null;
  const parsed = MusicProjectV2Schema.safeParse(body?.project);
  if (!parsed.success) {
    throw new FreezeError("The cloud copy isn't a plug-in (v2) project yet. Sync with Project Schema v2 enabled, then try again.");
  }
  if (parsed.data.projectId !== local.projectId || parsed.data.revisionId !== local.revisionId) {
    throw new FreezeError("Save and sync this exact revision before freezing, then try again.");
  }
  const stored = body?.revision?.checksumSha256 ?? body?.checksumSha256;
  if (typeof stored === "string" && stored !== (await computeProjectChecksum(parsed.data))) {
    throw new FreezeError("The cloud copy of this revision doesn't match its checksum. Save again, sync, then retry.");
  }
  return parsed.data;
}

export async function createFreezeManifest(
  stored: MusicProjectV2,
  trackId: string,
  deviceId: string,
  renderId: string = crypto.randomUUID(),
  requestedAt: string = new Date().toISOString()
): Promise<RenderManifest> {
  const device = stored.tracks.find((track) => track.id === trackId)?.devices.find((candidate) => candidate.id === deviceId);
  if (!device) throw new FreezeError("That plug-in isn't in the synced revision yet. Sync, then try again.");
  if (!canFreeze(device)) {
    throw new FreezeError(
      device.automation.length > 0
        ? "Automated plug-in parameters can't be frozen yet."
        : "Only first-party plug-ins can be frozen for now."
    );
  }
  const builtin = projectV2BuiltinView(stored);
  return RenderManifestSchema.parse({
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId,
    projectId: stored.projectId,
    revisionId: stored.revisionId,
    projectChecksumSha256: await computeProjectChecksum(stored),
    engineVersion: RENDER_ENGINE_VERSION,
    seed: 0,
    scope: { kind: "plugin-freeze", trackId, deviceId },
    range: { startTick: 0, endTick: arrangementBars(builtin) * barTicks(builtin) },
    output: { format: "wav", sampleRate: 48000, bitDepth: 24, normalizePeakDbfs: null, includeTailSeconds: 2 },
    requestedAt
  });
}

/** The evidence to attach to the device once the freeze render has completed. */
export async function freezeReference(
  stored: MusicProjectV2,
  manifest: RenderManifest,
  job: RenderJob,
  frozenAt: string = new Date().toISOString()
): Promise<FrozenPluginArtifactReference> {
  if (manifest.scope.kind !== "plugin-freeze") throw new FreezeError("Not a freeze render.");
  const { trackId, deviceId } = manifest.scope;
  if (job.status !== "completed" || !job.result) throw new FreezeError(job.lastError ?? `The freeze render ended as ${job.status}.`);
  const artifact = job.result.artifacts.find((candidate) => candidate.fileName.startsWith("freeze-"));
  if (!artifact) throw new FreezeError("The freeze render produced no audio.");
  const device = stored.tracks.find((track) => track.id === trackId)!.devices.find((candidate) => candidate.id === deviceId)!;
  return {
    renderId: manifest.renderId,
    artifactId: artifact.artifactId,
    sourceProjectId: stored.projectId,
    sourceRevisionId: stored.revisionId,
    sourceProjectChecksumSha256: manifest.projectChecksumSha256,
    sourceDeviceId: deviceId,
    sourcePluginStateChecksumSha256: await computePluginStateChecksum(device),
    sourceSignalChainChecksumSha256: await computeSignalChainChecksum(stored, deviceId, trackId),
    artifactChecksumSha256: artifact.checksumSha256,
    engineVersion: manifest.engineVersion,
    frozenAt
  };
}

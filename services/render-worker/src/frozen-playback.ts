import { createHash } from "node:crypto";

import { evaluateFrozenPluginEvidence } from "@synaptix/project-model/plugin";
import type { FrozenPluginArtifactReference, MusicProjectV2 } from "@synaptix/project-model/v2";
import {
  RenderArtifactManifestSchema,
  verifyFrozenArtifactAgainstManifest,
  type RenderManifest
} from "@synaptix/render-contracts";

import { renderLengthSamples, ticksToSeconds } from "./offline-renderer.ts";
import { offlineProcessorFor, type OfflinePluginProcessor } from "./plugin-processors.ts";
import type { PluginRenderBlocker } from "./plugin-render-error.ts";
import { decodeWav, type StereoBuffer } from "./wav-encoder.ts";

/** Reads artifacts of earlier renders back from storage (MinioArtifactStore in production). */
export interface FrozenArtifactSource {
  load(renderId: string, fileName: string): Promise<Buffer>;
}

export const ARTIFACT_MANIFEST_FILE_NAME = "artifact-manifest.json";

type TrackV2 = MusicProjectV2["tracks"][number];
type DeviceV2 = TrackV2["devices"][number];

function isLivePlugin(device: DeviceV2): boolean {
  return device.enabled && device.plugin.runtimeKind !== "builtin";
}

function blocker(track: TrackV2, device: DeviceV2, reason: string): PluginRenderBlocker {
  return { trackId: track.id, deviceId: device.id, pluginId: device.plugin.pluginId, reason };
}

async function loadFrozenAudio(
  reference: FrozenPluginArtifactReference,
  source: FrozenArtifactSource
): Promise<{ buffer: StereoBuffer; sampleRate: number; startTick: number } | string> {
  let manifestInput: unknown;
  try {
    manifestInput = JSON.parse((await source.load(reference.renderId, ARTIFACT_MANIFEST_FILE_NAME)).toString("utf8"));
  } catch (error) {
    return `the freeze render's manifest couldn't be loaded (${error instanceof Error ? error.message : "unknown error"})`;
  }
  const parsed = RenderArtifactManifestSchema.safeParse(manifestInput);
  if (!parsed.success) return "the freeze render's manifest is invalid";
  const issues = verifyFrozenArtifactAgainstManifest(reference, parsed.data);
  if (issues.length > 0) return `frozen artifact doesn't match its render manifest: ${issues.join(" ")}`;
  const artifact = parsed.data.artifacts.find((candidate) => candidate.artifactId === reference.artifactId)!;
  if (!artifact.fileName.endsWith(".wav")) return "frozen artifact is not a WAV file";

  let bytes: Buffer;
  try {
    bytes = await source.load(reference.renderId, artifact.fileName);
  } catch (error) {
    return `frozen audio couldn't be loaded (${error instanceof Error ? error.message : "unknown error"})`;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== reference.artifactChecksumSha256) {
    return "frozen audio doesn't match its checksum";
  }
  try {
    return { ...decodeWav(bytes), startTick: parsed.data.range.startTick };
  } catch (error) {
    return `frozen audio couldn't be decoded (${error instanceof Error ? error.message : "unknown error"})`;
  }
}

/**
 * Frozen plug-in playback in the worker (Project Schema v2 cutover step F). For every rendered
 * track whose live plug-ins are covered by a current freeze, returns the track's pre-fader
 * signal: the verified frozen WAV lined up with the render range, then any later first-party
 * plug-ins run through their deterministic processors. Anything that can't be verified is
 * returned as a blocker, never rendered around.
 */
export async function resolveFrozenTracks(
  project: MusicProjectV2,
  manifest: Pick<RenderManifest, "scope" | "range" | "output">,
  source: FrozenArtifactSource | undefined
): Promise<{ preFader: Map<string, StereoBuffer>; blockers: PluginRenderBlocker[] }> {
  const inScope = manifest.scope.kind === "stems" ? new Set(manifest.scope.trackIds) : null;
  const preFader = new Map<string, StereoBuffer>();
  const blockers: PluginRenderBlocker[] = [];

  for (const track of project.tracks) {
    if (inScope && !inScope.has(track.id)) continue;
    const live = track.devices.map((device, index) => ({ device, index })).filter(({ device }) => isLivePlugin(device));
    if (live.length === 0) continue;

    // The last current freeze covers every device before it (its signal chain checksum does).
    let frozenAt = -1;
    let reference: FrozenPluginArtifactReference | null = null;
    const evidence = new Map<string, string>();
    for (const { device, index } of live) {
      const result = await evaluateFrozenPluginEvidence(project, device.id, track.id);
      if (result.status === "current") {
        frozenAt = index;
        reference = result.reference;
      } else {
        evidence.set(device.id, result.status === "absent" ? "no frozen artifact" : "frozen artifact is stale");
      }
    }
    if (!reference) {
      blockers.push(...live.map(({ device }) => blocker(track, device, evidence.get(device.id)!)));
      continue;
    }

    const after: { device: DeviceV2; processor: OfflinePluginProcessor }[] = [];
    const trackBlockers: PluginRenderBlocker[] = [];
    for (const device of track.devices.slice(frozenAt + 1)) {
      if (!device.enabled) continue;
      if (device.plugin.runtimeKind === "builtin") {
        trackBlockers.push(blocker(track, device, "built-in devices after a frozen plug-in aren't supported"));
        continue;
      }
      const processor = offlineProcessorFor(device);
      if (typeof processor === "string") trackBlockers.push(blocker(track, device, `${evidence.get(device.id) ?? "no frozen artifact"}, and after a frozen plug-in ${processor}`));
      else after.push({ device, processor });
    }
    const frozenDevice = track.devices[frozenAt]!;
    if (!source) trackBlockers.push(blocker(track, frozenDevice, "frozen artifact playback is not configured on this worker"));
    if (trackBlockers.length > 0) {
      blockers.push(...trackBlockers);
      continue;
    }

    const loaded = await loadFrozenAudio(reference, source!);
    if (typeof loaded === "string") {
      blockers.push(blocker(track, frozenDevice, loaded));
      continue;
    }
    if (loaded.sampleRate !== manifest.output.sampleRate) {
      blockers.push(blocker(track, frozenDevice,
        `frozen audio is ${loaded.sampleRate} Hz but this render is ${manifest.output.sampleRate} Hz; render at ${loaded.sampleRate} Hz or refreeze`));
      continue;
    }

    // The freeze's tempo matches this revision (its signal chain checksum covers the tempo map).
    const bpm = project.tempoMap[0]?.bpm ?? 120;
    const offsetTicks = manifest.range.startTick - loaded.startTick;
    const offset = Math.round(
      Math.sign(offsetTicks) * ticksToSeconds(Math.abs(offsetTicks), project.transport.ticksPerQuarterNote, bpm) * loaded.sampleRate
    );
    const totalSamples = renderLengthSamples(project, manifest);
    const aligned: StereoBuffer = { left: new Float64Array(totalSamples), right: new Float64Array(totalSamples) };
    for (let index = 0; index < totalSamples; index++) {
      const from = index + offset;
      if (from < 0 || from >= loaded.buffer.left.length) continue;
      aligned.left[index] = loaded.buffer.left[from]!;
      aligned.right[index] = loaded.buffer.right[from]!;
    }
    for (const { device, processor } of after) processor.process(aligned, device, manifest.output.sampleRate);
    preFader.set(track.id, aligned);
  }
  return { preFader, blockers };
}

import assert from "node:assert/strict";
import test from "node:test";

import { createReferenceDriveDevice } from "@synaptix/daw-engine";
import { createEmptyProject } from "@synaptix/project-model";
import { computePluginStateChecksum, computeSignalChainChecksum } from "@synaptix/project-model/plugin";
import { toProjectV2, type DeviceV2, type MusicProjectV2 } from "@synaptix/project-model/v2";
import { RENDER_CONTRACT_VERSION, RENDER_ENGINE_VERSION, type RenderManifest } from "@synaptix/render-contracts";

import { packageRenderArtifacts } from "./artifact-packager.ts";
import type { AudioTranscoder } from "./ffmpeg-transcoder.ts";
import { ARTIFACT_MANIFEST_FILE_NAME, type FrozenArtifactSource } from "./frozen-playback.ts";
import { renderPluginFreeze, renderProjectOffline } from "./offline-renderer.ts";
import { PluginRenderUnsupportedError, resolveRenderableProject } from "./plugin-render-gate.ts";
import { decodeWav, encodeWav } from "./wav-encoder.ts";

const PPQ = 960;
const FREEZE_RENDER_ID = "10000000-0000-4000-8000-000000000000";
const noTranscoder: AudioTranscoder = { transcodeWav: async () => { throw new Error("not used"); } };

function project(extraDevices: DeviceV2[] = []): MusicProjectV2 {
  const v1 = createEmptyProject("project-a", { revisionId: "revision-a" });
  v1.tracks = [{
    id: "bass", name: "Bass", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0,
    devices: [{ id: "bass-synth", deviceType: "synaptix-bass-synth", deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: [{
      id: "bass-clip", kind: "midi", name: "Bass", loop: false,
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * 4 },
      notes: [{ id: "n1", pitch: 45, velocity: 110, startTick: 0, durationTicks: PPQ * 3 }]
    }]
  }];
  const value = toProjectV2(v1);
  const drive = createReferenceDriveDevice("drive");
  drive.parameters = [{ id: "drive", value: 10 }];
  value.tracks[0]!.devices.push(drive, ...extraDevices);
  return value;
}

function manifest(overrides: Partial<RenderManifest> = {}): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId: "20000000-0000-4000-8000-000000000000",
    projectId: "project-a",
    revisionId: "revision-a",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: RENDER_ENGINE_VERSION,
    seed: 1,
    scope: { kind: "stems", trackIds: ["bass"] },
    range: { startTick: 0, endTick: PPQ * 4 },
    output: { format: "wav", sampleRate: 44100, bitDepth: 24, normalizePeakDbfs: null, includeTailSeconds: 0 },
    requestedAt: "2026-09-27T00:00:00.000Z",
    ...overrides
  };
}

class MemorySource implements FrozenArtifactSource {
  files = new Map<string, Buffer>();
  async load(renderId: string, fileName: string): Promise<Buffer> {
    const bytes = this.files.get(`${renderId}/${fileName}`);
    if (!bytes) throw new Error(`NoSuchKey ${fileName}`);
    return bytes;
  }
}

/** Freeze the drive the way the worker does (render + package), store it, and attach the reference. */
async function frozenProject(extraDevices: DeviceV2[] = []) {
  const value = project(extraDevices);
  const freezeManifest = manifest({
    renderId: FREEZE_RENDER_ID,
    scope: { kind: "plugin-freeze", trackId: "bass", deviceId: "drive" },
    output: { format: "wav", sampleRate: 44100, bitDepth: 24, normalizePeakDbfs: null, includeTailSeconds: 0.5 }
  });
  const packaged = await packageRenderArtifacts(renderPluginFreeze(value, freezeManifest), freezeManifest, noTranscoder);
  const source = new MemorySource();
  for (const artifact of packaged.artifacts) source.files.set(`${FREEZE_RENDER_ID}/${artifact.metadata.fileName}`, artifact.bytes);
  const wav = packaged.artifacts.find((artifact) => artifact.metadata.fileName.endsWith(".wav"))!;
  const device = value.tracks[0]!.devices.find((candidate) => candidate.id === "drive")!;
  device.frozen = {
    renderId: FREEZE_RENDER_ID, artifactId: wav.metadata.artifactId,
    sourceProjectId: value.projectId, sourceRevisionId: value.revisionId, sourceProjectChecksumSha256: freezeManifest.projectChecksumSha256,
    sourceDeviceId: device.id, sourcePluginStateChecksumSha256: await computePluginStateChecksum(device),
    sourceSignalChainChecksumSha256: await computeSignalChainChecksum(value, device.id, "bass"),
    artifactChecksumSha256: wav.metadata.checksumSha256, engineVersion: freezeManifest.engineVersion, frozenAt: "2026-09-27T00:00:00Z"
  };
  return { project: value, source, frozen: decodeWav(wav.bytes).buffer, wavFileName: wav.metadata.fileName };
}

async function render(value: MusicProjectV2, source: FrozenArtifactSource | undefined, mix = manifest()) {
  const renderable = await resolveRenderableProject(value, mix, source);
  return decodeWav(renderProjectOffline(renderable.project, mix, renderable.options).artifacts[0]!.bytes).buffer;
}

async function blockedReason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof PluginRenderUnsupportedError, String(error));
    return error.devices.map((device) => device.reason).join(" | ");
  }
  assert.fail("expected the render to be blocked");
}

const center = Math.cos(Math.PI / 4);
const TOLERANCE = 2 / 2 ** 23;

test("a current freeze plays in place of the live plug-in, through the track's channel strip", async () => {
  const { project: value, source, frozen } = await frozenProject();
  const stem = await render(value, source);
  assert.equal(stem.left.length, Math.round(2 * 44100));
  let energy = 0;
  for (let index = 0; index < stem.left.length; index++) {
    assert.ok(Math.abs(stem.left[index]! - frozen.left[index]! * center) <= TOLERANCE, `sample ${index}`);
    energy += Math.abs(stem.left[index]!);
  }
  assert.ok(energy > 100, "the frozen audio is audible");

  // Volume isn't part of the freeze, so it still applies and the freeze stays current.
  value.tracks[0]!.volumeDb = -6;
  const quieter = await render(value, source);
  const peak = (buffer: Float64Array) => buffer.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  assert.ok(Math.abs(peak(quieter.left) / peak(stem.left) - 10 ** (-6 / 20)) < 1e-3);
});

test("the freeze lines up with a render range that starts later, and mute silences it in the mix", async () => {
  const { project: value, source, frozen } = await frozenProject();
  const later = await render(value, source, manifest({ range: { startTick: PPQ, endTick: PPQ * 4 } }));
  const offset = Math.round(0.5 * 44100);
  for (const index of [0, 1000, 20000]) {
    assert.ok(Math.abs(later.left[index]! - frozen.left[index + offset]! * center) <= TOLERANCE);
  }

  value.tracks[0]!.muted = true;
  const master = await render(value, source, manifest({ scope: { kind: "master" } }));
  assert.ok(master.left.every((sample) => sample === 0));
});

test("later first-party plug-ins run on the frozen audio; unsupported ones fail closed", async () => {
  const second = createReferenceDriveDevice("drive-2");
  second.parameters = [{ id: "outputGainDb", value: -12 }];
  const { project: value, source } = await frozenProject([second]);
  const single = await frozenProject();
  const once = await render(single.project, single.source);
  const twice = await render(value, source);
  assert.notDeepEqual(twice.left, once.left);

  const thirdParty = createReferenceDriveDevice("vendor-fx");
  thirdParty.plugin = { ...thirdParty.plugin, pluginId: "vendor.fx", vendorId: "vendor" };
  const blocked = await frozenProject([thirdParty]);
  assert.match(await blockedReason(render(blocked.project, blocked.source)), /no frozen artifact, and after a frozen plug-in only first-party/);
});

test("frozen playback refuses anything it can't verify", async () => {
  const { project: value, source, wavFileName } = await frozenProject();
  assert.match(await blockedReason(render(value, undefined)), /not configured/);
  assert.match(await blockedReason(render(value, new MemorySource())), /manifest couldn't be loaded/);
  assert.match(
    await blockedReason(render(value, source, manifest({ output: { ...manifest().output, sampleRate: 48000 } }))),
    /44100 Hz but this render is 48000 Hz/
  );

  const tampered = new MemorySource();
  tampered.files = new Map(source.files);
  tampered.files.set(`${FREEZE_RENDER_ID}/${wavFileName}`, encodeWav({ left: new Float64Array(10), right: new Float64Array(10) }, 44100, 24));
  assert.match(await blockedReason(render(value, tampered)), /doesn't match its checksum/);

  const wrongRevision = structuredClone(value);
  wrongRevision.tracks[0]!.devices[1]!.frozen!.sourceRevisionId = "revision-other";
  assert.match(await blockedReason(render(wrongRevision, source)), /different source revision/);

  const retuned = structuredClone(value);
  retuned.tracks[0]!.devices[1]!.parameters = [{ id: "drive", value: 3 }];
  assert.match(await blockedReason(render(retuned, source)), /frozen artifact is stale/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createReferenceDriveDevice, REFERENCE_DRIVE_PROCESSOR_SOURCE } from "@synaptix/daw-engine";
import { createEmptyProject, type Track } from "@synaptix/project-model";
import { toProjectV2, type DeviceV2, type MusicProjectV2 } from "@synaptix/project-model/v2";
import { RENDER_CONTRACT_VERSION, type RenderManifest } from "@synaptix/render-contracts";

import { renderPluginFreeze, renderProjectOffline } from "./offline-renderer.ts";
import { offlineProcessorFor, referenceDriveSample } from "./plugin-processors.ts";
import { PluginRenderUnsupportedError } from "./plugin-render-gate.ts";

const PPQ = 960;

/** The browser's `driveSample`, taken from the AudioWorklet source itself. */
function workletDriveSample(): (x: number, inputGain: number, drive: number, mix: number, outputGain: number) => number {
  const helpers = REFERENCE_DRIVE_PROCESSOR_SOURCE.slice(0, REFERENCE_DRIVE_PROCESSOR_SOURCE.indexOf("class "));
  return new Function(`${helpers}\nreturn driveSample;`)() as ReturnType<typeof workletDriveSample>;
}

test("the offline Reference Drive matches the browser AudioWorklet sample for sample", () => {
  const browser = workletDriveSample();
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let index = 0; index < 5000; index++) {
    const args = [random() * 4 - 2, random() * 4, 1 + random() * 19, random(), random() * 2] as const;
    assert.equal(referenceDriveSample(...args), browser(...args));
  }
});

function v2Project(trackOverrides: Partial<Track> = {}, devices: (id: string) => DeviceV2[] = () => []): MusicProjectV2 {
  const v1 = createEmptyProject("project-a", { revisionId: "revision-a" });
  v1.tracks = [{
    id: "bass", name: "Bass", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0,
    devices: [{ id: "bass-synth", deviceType: "synaptix-bass-synth", deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: [{
      id: "bass-clip", kind: "midi", name: "Bass", loop: false,
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * 4 },
      notes: [{ id: "n1", pitch: 45, velocity: 110, startTick: 0, durationTicks: PPQ * 2 }]
    }],
    ...trackOverrides
  }];
  const project = toProjectV2(v1);
  project.tracks[0]!.devices.push(...devices("bass"));
  return project;
}

function drive(parameters: Record<string, number> = { drive: 8 }): DeviceV2 {
  const device = createReferenceDriveDevice("drive");
  device.parameters = Object.entries(parameters).map(([id, value]) => ({ id, value }));
  return device;
}

function freezeManifest(deviceId = "drive"): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId: "10000000-0000-4000-8000-000000000000",
    projectId: "project-a",
    revisionId: "revision-a",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: "1.0.0",
    seed: 1,
    scope: { kind: "plugin-freeze", trackId: "bass", deviceId },
    range: { startTick: 0, endTick: PPQ * 4 },
    output: { format: "wav", sampleRate: 44100, bitDepth: 16, normalizePeakDbfs: null, includeTailSeconds: 0.1 },
    requestedAt: "2026-09-26T00:00:00.000Z"
  };
}

const bytes = (project: MusicProjectV2) => renderPluginFreeze(project, freezeManifest()).artifacts[0]!.bytes;

test("a freeze renders the track through the drive, deterministically, as one named WAV", () => {
  const outcome = renderPluginFreeze(v2Project({}, () => [drive()]), freezeManifest());
  assert.equal(outcome.result.status, "completed");
  assert.equal(outcome.artifacts.length, 1);
  assert.equal(outcome.artifacts[0]!.metadata.fileName, "freeze-bass-synaptix-reference-drive.wav");
  assert.equal(outcome.artifacts[0]!.metadata.trackId, "bass");
  assert.deepEqual(bytes(v2Project({}, () => [drive()])), outcome.artifacts[0]!.bytes);
});

test("the drive changes the sound, and a dry mix leaves it untouched", () => {
  const driven = bytes(v2Project({}, () => [drive({ drive: 12 })]));
  const dry = bytes(v2Project({}, () => [drive({ drive: 12, mix: 0 })]));
  const bypassed = bytes(v2Project({}, () => [{ ...drive({ drive: 12 }), enabled: false }]));
  assert.notDeepEqual(driven, dry);
  assert.deepEqual(dry, bypassed, "mix 0 and bypass both pass the pre-fader signal through");
});

test("freezes are pre-fader: track volume, pan and mute don't change them", () => {
  const plain = bytes(v2Project({}, () => [drive()]));
  assert.deepEqual(bytes(v2Project({ volumeDb: -20, pan: 0.8, muted: true }, () => [drive()])), plain);
});

test("unsupported plug-ins and automation fail closed; other scopes are refused", () => {
  const thirdParty = drive();
  thirdParty.plugin = { ...thirdParty.plugin, pluginId: "vendor.fancy-reverb", vendorId: "vendor" };
  assert.throws(() => renderPluginFreeze(v2Project({}, () => [thirdParty]), freezeManifest()), PluginRenderUnsupportedError);

  const automated = drive();
  automated.automation = [{ parameterId: "drive", points: [{ tick: 0, value: 2, curve: "linear" }] }] as never;
  assert.match(String(offlineProcessorFor(automated)), /automated/);
  assert.throws(() => renderPluginFreeze(v2Project({}, () => [automated]), freezeManifest()), PluginRenderUnsupportedError);

  assert.throws(() => renderPluginFreeze(v2Project({}, () => [drive()]), freezeManifest("missing")), /not found/);
  assert.throws(() => renderPluginFreeze(v2Project(), freezeManifest("bass-synth")), /don't need freezing/);
  const v1 = createEmptyProject("project-a", { revisionId: "revision-a" });
  assert.throws(() => renderProjectOffline(v1, freezeManifest()), /renderPluginFreeze/);
});

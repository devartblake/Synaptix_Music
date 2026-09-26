import assert from "node:assert/strict";
import test from "node:test";

import { createReferenceDriveDevice } from "@synaptix/daw-engine";
import { createEmptyProject, type MusicProject } from "@synaptix/project-model";
import { computePluginStateChecksum, computeSignalChainChecksum } from "@synaptix/project-model/plugin";
import { migrateProjectV1ToV2, type MusicProjectV2 } from "@synaptix/project-model/v2";
import { RENDER_CONTRACT_VERSION, type RenderManifest } from "@synaptix/render-contracts";

import { renderProjectOffline } from "./offline-renderer.ts";
import { PluginRenderUnsupportedError, resolveRenderableProject } from "./plugin-render-gate.ts";

const PPQ = 960;

function v1Project(): MusicProject {
  const value = createEmptyProject("project-a", { revisionId: "revision-a", now: "2026-09-22T00:00:00.000Z" });
  value.tracks = ["lead", "bass"].map((id) => ({
    id, name: id, kind: "instrument" as const, muted: false, solo: false, volumeDb: 0, pan: 0,
    devices: [{ id: `${id}-device`, deviceType: "synaptix-poly-synth", deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: [{
      id: `${id}-clip`, kind: "midi" as const, name: `${id} clip`, loop: false,
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * 4 },
      notes: [{ id: `${id}-note`, pitch: 60, velocity: 100, startTick: 0, durationTicks: PPQ }]
    }]
  }));
  return value;
}

function withDrive(enabled = true): MusicProjectV2 {
  const value = migrateProjectV1ToV2(v1Project());
  value.tracks[0]!.devices.push({ ...createReferenceDriveDevice("lead-drive"), enabled });
  return value;
}

function manifest(scope: RenderManifest["scope"] = { kind: "master" }): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId: "10000000-0000-4000-8000-000000000000",
    projectId: "project-a",
    revisionId: "revision-a",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: "1.0.0",
    seed: 1,
    scope,
    range: { startTick: 0, endTick: PPQ * 4 },
    output: { format: "wav", sampleRate: 44100, bitDepth: 16, normalizePeakDbfs: null, includeTailSeconds: 0 },
    requestedAt: "2026-09-22T00:00:00.000Z"
  };
}

test("v1 projects pass through unchanged", async () => {
  const project = v1Project();
  assert.equal(await resolveRenderableProject(project, manifest()), project);
});

test("a migrated v2 project renders byte-identically to its v1 source", async () => {
  const v1 = v1Project();
  const renderable = await resolveRenderableProject(migrateProjectV1ToV2(v1), manifest());
  const fromV1 = renderProjectOffline(v1, manifest());
  const fromV2 = renderProjectOffline(renderable, manifest());
  assert.deepEqual(
    fromV2.artifacts.map((artifact) => artifact.metadata.checksumSha256),
    fromV1.artifacts.map((artifact) => artifact.metadata.checksumSha256)
  );
});

test("enabled plug-ins on rendered tracks fail closed with the device named", async () => {
  await assert.rejects(resolveRenderableProject(withDrive(), manifest()), (error: unknown) => {
    assert.ok(error instanceof PluginRenderUnsupportedError);
    assert.deepEqual(error.devices, [{ trackId: "lead", deviceId: "lead-drive", pluginId: "synaptix.reference-drive", reason: "no frozen artifact" }]);
    return true;
  });
});

test("bypassed plug-ins and plug-ins outside the requested stems do not block rendering", async () => {
  assert.equal((await resolveRenderableProject(withDrive(false), manifest())).schemaVersion, 1);
  const stems = await resolveRenderableProject(withDrive(), manifest({ kind: "stems", trackIds: ["bass"] }));
  assert.deepEqual(stems.tracks.map((track) => track.devices.map((device) => device.id)), [["lead-device"], ["bass-device"]]);
});

test("current frozen evidence is recognized but still rejected until frozen playback exists", async () => {
  const project = withDrive();
  const device = project.tracks[0]!.devices[1]!;
  device.frozen = {
    renderId: "7f7b8f0e-7f55-4a41-9d4e-3b1f8f3f7a10", artifactId: "0c3f3f0e-1a55-4a41-9d4e-3b1f8f3f7a11",
    sourceProjectId: project.projectId, sourceRevisionId: project.revisionId, sourceProjectChecksumSha256: "c".repeat(64),
    sourceDeviceId: device.id, sourcePluginStateChecksumSha256: await computePluginStateChecksum(device),
    sourceSignalChainChecksumSha256: await computeSignalChainChecksum(project, device.id),
    artifactChecksumSha256: "d".repeat(64), engineVersion: "1.0.0", frozenAt: "2026-09-22T00:00:00Z"
  };
  await assert.rejects(resolveRenderableProject(project, manifest()), /frozen artifact playback is not supported/);
});

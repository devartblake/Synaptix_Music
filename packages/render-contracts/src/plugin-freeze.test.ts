import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";
import {
  AudioPluginDescriptorSchema,
  computePluginStateChecksum,
  computeSignalChainChecksum,
  type AudioPluginDescriptor
} from "@synaptix/project-model/plugin";
import { migrateProjectV1ToV2, type DeviceV2, type MusicProjectV2 } from "@synaptix/project-model/v2";

import type { RenderArtifactManifest } from "./artifact-manifest.ts";
import { assessPluginProductionEligibility, verifyFrozenArtifactAgainstManifest } from "./plugin-freeze.ts";

const RENDER_ID = "7f7b8f0e-7f55-4a41-9d4e-3b1f8f3f7a10";
const ARTIFACT_ID = "0c3f3f0e-1a55-4a41-9d4e-3b1f8f3f7a11";
const PROJECT_CHECKSUM = "c".repeat(64);
const ARTIFACT_CHECKSUM = "d".repeat(64);
const ENGINE = "render-worker@1.0.0";

function descriptor(deterministic = false): AudioPluginDescriptor {
  return AudioPluginDescriptorSchema.parse({
    reference: { pluginId: "test.drive", vendorId: "synaptix", version: "1.0.0", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
    name: "Test Drive",
    category: "effect",
    buses: { audioInputChannels: [2], audioOutputChannels: [2], midiInput: false },
    parameters: [],
    state: { stateVersion: 1, encoding: "json" },
    latency: { latencySamples: 0, tailSeconds: 0 },
    license: {
      licenseId: "LicenseRef-Synaptix-Proprietary", licenseTextUri: null, localUse: true, commercialUse: true,
      redistribution: false, cloudRender: true, multiUser: true, activationRequired: false, trademarkRestrictions: []
    },
    provenance: { publisher: "Synaptix", sourceUri: null, reviewStatus: "first-party", reviewedAt: null, acceptanceEvidence: [] },
    compatibility: { requiresSecureContext: true, requiresCrossOriginIsolation: false, deterministicProductionRender: deterministic }
  });
}

function device(overrides: Partial<DeviceV2> = {}): DeviceV2 {
  return {
    id: "device-drive", deviceType: "test.drive", deviceVersion: "1.0.0", enabled: true,
    parameters: [{ id: "drive", value: 4 }],
    plugin: { pluginId: "test.drive", vendorId: "synaptix", version: "1.0.0", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
    pluginState: null, automation: [], frozen: null,
    ...overrides
  };
}

function project(devices: DeviceV2[]): MusicProjectV2 {
  const value = migrateProjectV1ToV2(createEmptyProject("project-1", { revisionId: "revision-1", now: "2026-09-22T00:00:00.000Z" }));
  value.tracks.push({ id: "track-1", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices, clips: [] });
  return value;
}

async function freeze(value: MusicProjectV2): Promise<MusicProjectV2> {
  const target = value.tracks[0]!.devices.find((candidate) => candidate.id === "device-drive")!;
  target.frozen = {
    renderId: RENDER_ID, artifactId: ARTIFACT_ID, sourceProjectId: value.projectId, sourceRevisionId: value.revisionId,
    sourceProjectChecksumSha256: PROJECT_CHECKSUM, sourceDeviceId: target.id,
    sourcePluginStateChecksumSha256: await computePluginStateChecksum(target),
    sourceSignalChainChecksumSha256: await computeSignalChainChecksum(value, target.id),
    artifactChecksumSha256: ARTIFACT_CHECKSUM, engineVersion: ENGINE, frozenAt: "2026-09-22T00:00:00Z"
  };
  value.parentRevisionId = value.revisionId;
  value.revisionId = "revision-2";
  return value;
}

function manifest(overrides: Partial<RenderArtifactManifest> = {}): RenderArtifactManifest {
  return {
    contractVersion: "1.0.0", renderId: RENDER_ID, projectId: "project-1", revisionId: "revision-1",
    projectChecksumSha256: PROJECT_CHECKSUM, engineVersion: ENGINE, outputFormat: "wav",
    scope: { kind: "stems", trackIds: ["track-1"] }, range: { startTick: 0, endTick: 3840 },
    artifacts: [{
      artifactId: ARTIFACT_ID, renderId: RENDER_ID, trackId: "track-1", fileName: "lead.wav",
      mediaType: "audio/wav", byteLength: 1024, checksumSha256: ARTIFACT_CHECKSUM, durationSeconds: 2
    }],
    previewArtifactId: null, createdAt: "2026-09-22T00:00:00.000Z",
    ...overrides
  };
}

test("frozen references verify against the Stage 12 manifest they point to", async () => {
  const reference = (await freeze(project([device()]))).tracks[0]!.devices[0]!.frozen!;
  assert.deepEqual(verifyFrozenArtifactAgainstManifest(reference, manifest()), []);
  assert.ok(verifyFrozenArtifactAgainstManifest(reference, manifest({ revisionId: "revision-9" })).length > 0);
  assert.ok(verifyFrozenArtifactAgainstManifest(reference, manifest({ projectChecksumSha256: "e".repeat(64) })).length > 0);
  assert.ok(verifyFrozenArtifactAgainstManifest(reference, manifest({ engineVersion: "other" })).length > 0);
  const tampered = manifest();
  tampered.artifacts[0]!.checksumSha256 = "f".repeat(64);
  assert.ok(verifyFrozenArtifactAgainstManifest(reference, tampered).length > 0);
  assert.deepEqual(verifyFrozenArtifactAgainstManifest(reference, { ...manifest(), renderId: "not-a-uuid" }), [
    "Render artifact manifest is invalid."
  ]);
});

test("production certification blocks browser-only plug-ins without frozen evidence", async () => {
  const builtin = device({
    id: "device-synth", deviceType: "synaptix.basic-synth",
    plugin: { pluginId: "synaptix.basic-synth", vendorId: "synaptix", version: "1.0.0", runtimeKind: "builtin", moduleChecksumSha256: null }
  });
  const options = { descriptorFor: () => descriptor(), manifestFor: () => manifest() };

  const live = await assessPluginProductionEligibility(project([builtin, device()]), options);
  assert.equal(live.certifiable, false);
  assert.deepEqual(live.decisions.map((decision) => decision.mode), ["deterministic", "blocked"]);

  const disabled = await assessPluginProductionEligibility(project([builtin, device({ enabled: false })]), options);
  assert.equal(disabled.certifiable, true);

  const deterministic = await assessPluginProductionEligibility(project([device()]), {
    ...options, descriptorFor: () => descriptor(true)
  });
  assert.equal(deterministic.decisions[0]?.mode, "deterministic");
});

test("production certification accepts current verified freezes and rejects stale or unverifiable ones", async () => {
  const options = { descriptorFor: () => descriptor(), manifestFor: () => manifest() };

  const frozen = await freeze(project([device()]));
  const accepted = await assessPluginProductionEligibility(frozen, options);
  assert.equal(accepted.certifiable, true);
  assert.equal(accepted.decisions[0]?.mode, "frozen");

  const stale = await freeze(project([device()]));
  stale.tracks[0]!.devices[0]!.parameters[0]!.value = 9;
  assert.equal((await assessPluginProductionEligibility(stale, options)).certifiable, false);

  const missingManifest = await assessPluginProductionEligibility(await freeze(project([device()])), {
    ...options, manifestFor: () => undefined
  });
  assert.equal(missingManifest.certifiable, false);

  const unknown = await freeze(project([device()]));
  assert.equal(
    (await assessPluginProductionEligibility(unknown, { ...options, descriptorFor: () => undefined })).decisions[0]?.mode,
    "frozen"
  );
});

test("device ids shared across tracks are judged by their own track's freeze evidence", async () => {
  const value = await freeze(project([device()]));
  // A second track reuses the device id without a freeze; ids are only unique per track.
  value.tracks.push({ id: "track-2", name: "Pad", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices: [device()], clips: [] });
  const assessment = await assessPluginProductionEligibility(value, { descriptorFor: () => descriptor(), manifestFor: () => manifest() });
  assert.deepEqual(assessment.decisions.map((decision) => [decision.trackId, decision.mode]), [["track-1", "frozen"], ["track-2", "blocked"]]);
  assert.equal(assessment.certifiable, false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "./index.ts";
import {
  AudioPluginDescriptorSchema,
  computePluginStateChecksum,
  computePluginStatePayloadChecksum,
  computeSignalChainChecksum,
  evaluateFrozenPluginEvidence,
  resolvePluginAvailability,
  verifyPluginStateEnvelope,
  type AudioPluginDescriptor
} from "./plugin.ts";
import { MusicProjectV2Schema, migrateProjectV1ToV2, type DeviceV2, type MusicProjectV2 } from "./v2.ts";

const MODULE_CHECKSUM = "a".repeat(64);

function descriptor(overrides: Partial<AudioPluginDescriptor> = {}): AudioPluginDescriptor {
  return AudioPluginDescriptorSchema.parse({
    reference: {
      pluginId: "test.drive",
      vendorId: "synaptix",
      version: "1.0.0",
      runtimeKind: "audio-worklet",
      moduleChecksumSha256: MODULE_CHECKSUM
    },
    name: "Test Drive",
    category: "effect",
    buses: { audioInputChannels: [2], audioOutputChannels: [2], midiInput: false },
    parameters: [{
      id: "drive", label: "Drive", kind: "continuous", unit: "ratio",
      minimum: 1, maximum: 20, defaultValue: 1, automatable: true, automationRate: "k-rate"
    }],
    state: { stateVersion: 1, encoding: "json" },
    latency: { latencySamples: 0, tailSeconds: 0 },
    license: {
      licenseId: "LicenseRef-Synaptix-Proprietary", licenseTextUri: null, localUse: true,
      commercialUse: true, redistribution: false, cloudRender: true, multiUser: true,
      activationRequired: false, trademarkRestrictions: []
    },
    provenance: {
      publisher: "Synaptix", sourceUri: null, reviewStatus: "first-party",
      reviewedAt: null, acceptanceEvidence: []
    },
    compatibility: {
      requiresSecureContext: true, requiresCrossOriginIsolation: false, deterministicProductionRender: false
    },
    ...overrides
  });
}

function pluginDevice(overrides: Partial<DeviceV2> = {}): DeviceV2 {
  return {
    id: "device-drive",
    deviceType: "test.drive",
    deviceVersion: "1.0.0",
    enabled: true,
    parameters: [{ id: "drive", value: 4 }],
    plugin: {
      pluginId: "test.drive", vendorId: "synaptix", version: "1.0.0",
      runtimeKind: "audio-worklet", moduleChecksumSha256: MODULE_CHECKSUM
    },
    pluginState: null,
    automation: [],
    frozen: null,
    ...overrides
  };
}

function project(devices: DeviceV2[] = [pluginDevice()]): MusicProjectV2 {
  const v2 = migrateProjectV1ToV2(createEmptyProject("project-1", {
    revisionId: "revision-1",
    now: "2026-09-22T00:00:00.000Z"
  }));
  v2.tracks.push({
    id: "track-1", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0,
    devices,
    clips: [{
      id: "clip-1", kind: "midi", name: "Motif", loop: false,
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 3840 },
      notes: [{ id: "note-1", pitch: 60, velocity: 100, startTick: 0, durationTicks: 960 }]
    }]
  });
  return MusicProjectV2Schema.parse(v2);
}

test("descriptors reject duplicate parameters and out-of-range defaults", () => {
  const base = descriptor();
  assert.throws(() => AudioPluginDescriptorSchema.parse({ ...base, parameters: [...base.parameters, ...base.parameters] }));
  assert.throws(() => AudioPluginDescriptorSchema.parse({
    ...base, parameters: [{ ...base.parameters[0]!, defaultValue: 50 }]
  }));
});

test("availability is resolved from trusted descriptors without touching the project", () => {
  const device = pluginDevice();
  assert.deepEqual(resolvePluginAvailability(device, descriptor()), { status: "available" });

  const reasons = [
    resolvePluginAvailability(device, undefined),
    resolvePluginAvailability({ ...device, plugin: { ...device.plugin, version: "2.0.0" } }, descriptor()),
    resolvePluginAvailability({ ...device, plugin: { ...device.plugin, runtimeKind: "wam" } }, descriptor()),
    resolvePluginAvailability({ ...device, plugin: { ...device.plugin, moduleChecksumSha256: "b".repeat(64) } }, descriptor()),
    resolvePluginAvailability(device, descriptor({ provenance: { ...descriptor().provenance, reviewStatus: "revoked" } })),
    resolvePluginAvailability(device, descriptor({ provenance: { ...descriptor().provenance, reviewStatus: "pending" } })),
    resolvePluginAvailability(
      { ...device, pluginState: { stateVersion: 9, encoding: "json", payload: "{}", checksumSha256: null } },
      descriptor()
    )
  ].map((state) => (state.status === "unavailable" ? state.reason : state.status));

  assert.deepEqual(reasons, [
    "unknown-plugin", "version-mismatch", "unsupported-runtime", "integrity-mismatch",
    "revoked", "not-approved", "state-incompatible"
  ]);
});

test("unknown plug-in devices survive a parse/serialize round trip exactly", () => {
  const unknown = pluginDevice({
    plugin: { pluginId: "vendor.unknown", vendorId: "vendor", version: "3.1.0", runtimeKind: "wam", moduleChecksumSha256: null },
    pluginState: { stateVersion: 7, encoding: "base64", payload: "AAEC", checksumSha256: null },
    automation: [{ parameterId: "cutoff", points: [{ tick: 0, value: 0.2, curve: "linear" }, { tick: 960, value: 0.9, curve: "step" }] }]
  });
  const source = project([unknown]);
  const reloaded = MusicProjectV2Schema.parse(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(reloaded, source);
  assert.equal(resolvePluginAvailability(unknown, undefined).status, "unavailable");
});

test("state envelope checksums detect payload tampering", async () => {
  const envelope = { stateVersion: 1, encoding: "json" as const, payload: "{\"drive\":4}", checksumSha256: null as string | null };
  envelope.checksumSha256 = await computePluginStatePayloadChecksum(envelope);
  assert.equal(await verifyPluginStateEnvelope(envelope), true);
  assert.equal(await verifyPluginStateEnvelope({ ...envelope, payload: "{\"drive\":5}" }), false);
  assert.equal(await verifyPluginStateEnvelope({ ...envelope, checksumSha256: null }), true);
});

async function frozenProject(): Promise<MusicProjectV2> {
  const source = project();
  const device = source.tracks[0]!.devices[0]!;
  device.frozen = {
    renderId: "7f7b8f0e-7f55-4a41-9d4e-3b1f8f3f7a10",
    artifactId: "0c3f3f0e-1a55-4a41-9d4e-3b1f8f3f7a11",
    sourceProjectId: source.projectId,
    sourceRevisionId: source.revisionId,
    sourceProjectChecksumSha256: "c".repeat(64),
    sourceDeviceId: device.id,
    sourcePluginStateChecksumSha256: await computePluginStateChecksum(device),
    sourceSignalChainChecksumSha256: await computeSignalChainChecksum(source, device.id),
    artifactChecksumSha256: "d".repeat(64),
    engineVersion: "render-worker@1.0.0",
    frozenAt: "2026-09-22T00:00:00Z"
  };
  // Attaching the freeze produces a descendant revision; validity must not depend on revision IDs.
  source.parentRevisionId = source.revisionId;
  source.revisionId = "revision-2";
  return MusicProjectV2Schema.parse(source);
}

test("frozen evidence stays current across descendant revisions", async () => {
  assert.deepEqual(await evaluateFrozenPluginEvidence(project(), "device-drive"), { status: "absent" });
  const frozen = await frozenProject();
  assert.equal((await evaluateFrozenPluginEvidence(frozen, "device-drive")).status, "current");
});

test("frozen evidence goes stale when parameters, automation, clips, or upstream devices change", async () => {
  const cases: Array<(value: MusicProjectV2) => void> = [
    (value) => { value.tracks[0]!.devices[0]!.parameters[0]!.value = 5; },
    (value) => { value.tracks[0]!.devices[0]!.automation.push({ parameterId: "drive", points: [{ tick: 0, value: 2, curve: "step" }] }); },
    (value) => { (value.tracks[0]!.clips[0] as { notes: Array<{ pitch: number }> }).notes[0]!.pitch = 62; },
    (value) => { value.tempoMap[0]!.bpm = 90; },
    (value) => { value.tracks[0]!.devices.unshift(pluginDevice({ id: "device-upstream" })); }
  ];
  for (const mutate of cases) {
    const frozen = await frozenProject();
    mutate(frozen);
    const status = await evaluateFrozenPluginEvidence(frozen, "device-drive");
    assert.equal(status.status, "stale");
  }
});

test("frozen evidence is independent of downstream devices and other tracks", async () => {
  const frozen = await frozenProject();
  frozen.tracks[0]!.devices.push(pluginDevice({ id: "device-downstream" }));
  frozen.tracks[0]!.volumeDb = -6;
  assert.equal((await evaluateFrozenPluginEvidence(frozen, "device-drive")).status, "current");
});

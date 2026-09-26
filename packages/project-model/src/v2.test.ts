import assert from "node:assert/strict";
import test from "node:test";

import { MusicProjectSchema, createEmptyProject } from "./index.ts";
import {
  MusicProjectV2Schema,
  migrateProjectV1ToV2
} from "./v2.ts";

test("migrates a v1 project deterministically without mutating the source", () => {
  const source = createEmptyProject("project-1", {
    revisionId: "revision-1",
    now: "2026-09-22T00:00:00.000Z"
  });
  source.tracks.push({
    id: "track-1",
    name: "Lead",
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: 0,
    pan: 0,
    devices: [{
      id: "device-1",
      deviceType: "synaptix.basic-synth",
      deviceVersion: "1.0.0",
      enabled: true,
      parameters: [{ id: "gain", value: 0.8 }]
    }],
    clips: []
  });

  const first = migrateProjectV1ToV2(source);
  const second = migrateProjectV1ToV2(source);

  assert.deepEqual(first, second);
  assert.equal(source.schemaVersion, 1);
  assert.equal(first.schemaVersion, 2);
  assert.deepEqual(first.tracks[0]?.devices[0]?.plugin, {
    pluginId: "synaptix.basic-synth",
    vendorId: "synaptix",
    version: "1.0.0",
    runtimeKind: "builtin",
    moduleChecksumSha256: null
  });
  assert.equal(first.tracks[0]?.devices[0]?.pluginState, null);
  assert.doesNotThrow(() => MusicProjectV2Schema.parse(first));
  assert.doesNotThrow(() => MusicProjectSchema.parse(source));
});

test("v1 rejects v2 and v2 rejects v1", () => {
  const v1 = createEmptyProject("project-1", {
    revisionId: "revision-1",
    now: "2026-09-22T00:00:00.000Z"
  });
  const v2 = migrateProjectV1ToV2(v1);
  assert.throws(() => MusicProjectSchema.parse(v2));
  assert.throws(() => MusicProjectV2Schema.parse(v1));
});

test("v2 rejects unknown runtime kinds and malformed checksums", () => {
  const v2 = migrateProjectV1ToV2(createEmptyProject("project-1", {
    revisionId: "revision-1",
    now: "2026-09-22T00:00:00.000Z"
  }));
  v2.tracks.push({
    id: "track-1", name: "Lead", kind: "instrument", muted: false, solo: false,
    volumeDb: 0, pan: 0, clips: [], devices: [{
      id: "device-1", deviceType: "test", deviceVersion: "1", enabled: true,
      parameters: [], pluginState: null, automation: [], frozen: null,
      plugin: { pluginId: "test", vendorId: null, version: "1", runtimeKind: "wam", moduleChecksumSha256: null }
    }]
  });
  const bad = structuredClone(v2) as any;
  bad.tracks[0].devices[0].plugin.moduleChecksumSha256 = "bad";
  assert.throws(() => MusicProjectV2Schema.parse(bad));
});

test("v2 conversions: open any version, project views, and lossless downgrade", async () => {
  const { toProjectV2, projectV2EditingView, projectV2BuiltinView, downgradeProjectV2ToV1 } = await import("./v2.ts");
  const v1 = createEmptyProject("project-1", { revisionId: "revision-1", now: "2026-09-22T00:00:00.000Z" });
  v1.tracks.push({
    id: "track-1", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, clips: [],
    devices: [{ id: "device-1", deviceType: "synaptix.basic-synth", deviceVersion: "1.0.0", enabled: true, parameters: [{ id: "gain", value: 0.8 }] }]
  });
  const v2 = toProjectV2(v1);
  assert.deepEqual(toProjectV2(v2), v2);
  assert.deepEqual(downgradeProjectV2ToV1(v2), MusicProjectSchema.parse(v1));
  assert.deepEqual(migrateProjectV1ToV2(downgradeProjectV2ToV1(v2)!), v2);

  v2.tracks[0]!.devices.push({
    id: "device-2", deviceType: "x.fx", deviceVersion: "1", enabled: true, parameters: [],
    plugin: { pluginId: "x.fx", vendorId: null, version: "1", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
    pluginState: null, automation: [], frozen: null
  });
  assert.equal(downgradeProjectV2ToV1(v2), null);
  assert.deepEqual(projectV2EditingView(v2).tracks[0]!.devices.map((device) => device.id), ["device-1", "device-2"]);
  assert.deepEqual(projectV2BuiltinView(v2).tracks[0]!.devices.map((device) => device.id), ["device-1"]);
  assert.doesNotThrow(() => MusicProjectSchema.parse(projectV2EditingView(v2)));

  const automated = structuredClone(toProjectV2(v1));
  automated.tracks[0]!.devices[0]!.automation.push({ parameterId: "gain", points: [] });
  assert.equal(downgradeProjectV2ToV1(automated), null);
});

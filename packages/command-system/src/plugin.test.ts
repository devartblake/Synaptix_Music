import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";
import { computePluginStatePayloadChecksum } from "@synaptix/project-model/plugin";
import { MusicProjectV2Schema, migrateProjectV1ToV2, type DeviceV2, type MusicProjectV2 } from "@synaptix/project-model/v2";

import { SetDeviceEnabledEditorCommand, SetDeviceParameterEditorCommand } from "./device.ts";
import { EditorCommandHistory } from "./editor.ts";
import {
  InsertPluginDeviceEditorCommand,
  RemovePluginDeviceEditorCommand,
  ReplacePluginStateEditorCommand,
  SetAutomationLaneEditorCommand,
  SetFrozenPluginArtifactEditorCommand
} from "./plugin.ts";

function driveDevice(id = "device-drive"): DeviceV2 {
  return {
    id, deviceType: "synaptix.reference-drive", deviceVersion: "1.0.0", enabled: true,
    parameters: [{ id: "drive", value: 1 }],
    plugin: { pluginId: "synaptix.reference-drive", vendorId: "synaptix", version: "1.0.0", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
    pluginState: null, automation: [], frozen: null
  };
}

function project(): MusicProjectV2 {
  const value = migrateProjectV1ToV2(createEmptyProject("project-1", { revisionId: "revision-1", now: "2026-09-22T00:00:00.000Z" }));
  value.tracks.push({
    id: "track-1", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0,
    devices: [driveDevice()], clips: []
  });
  return value;
}

test("a parameter gesture on a v2 plug-in is one history entry with exact undo/redo", async () => {
  const history = new EditorCommandHistory<MusicProjectV2>();
  const source = project();
  const edited = await history.execute(source, new SetDeviceParameterEditorCommand("track-1", "device-drive", "drive", 1, 7.5));
  assert.equal(history.snapshot().undoDepth, 1);
  assert.equal(edited.project.tracks[0]!.devices[0]!.parameters[0]!.value, 7.5);
  assert.equal(edited.project.parentRevisionId, "revision-1");
  assert.doesNotThrow(() => MusicProjectV2Schema.parse(edited.project));

  const undone = (await history.undo(edited.project))!;
  assert.deepEqual(undone.project.tracks, source.tracks);
  const redone = (await history.redo(undone.project))!;
  assert.deepEqual(redone.project.tracks, edited.project.tracks);
});

test("bypass reuses the device enabled command on v2 projects", () => {
  const command = new SetDeviceEnabledEditorCommand("track-1", "device-drive", true, false);
  const bypassed = command.execute(project());
  assert.equal(bypassed.tracks[0]!.devices[0]!.enabled, false);
  assert.equal(command.undo(bypassed).tracks[0]!.devices[0]!.enabled, true);
});

test("inserting and removing plug-in devices is reversible and order-preserving", () => {
  const source = project();
  const insert = new InsertPluginDeviceEditorCommand("track-1", driveDevice("device-2"), 0);
  const inserted = insert.execute(source);
  assert.deepEqual(inserted.tracks[0]!.devices.map((device) => device.id), ["device-2", "device-drive"]);
  assert.throws(() => insert.execute(inserted), /already exists/);
  assert.deepEqual(insert.undo(inserted), source);

  const remove = new RemovePluginDeviceEditorCommand("track-1", "device-2");
  const removed = remove.execute(inserted);
  assert.deepEqual(removed.tracks[0]!.devices.map((device) => device.id), ["device-drive"]);
  assert.deepEqual(remove.undo(removed), inserted);
});

test("state replacement is atomic, reversible, and rejects tampered envelopes", async () => {
  const source = project();
  const payload = JSON.stringify({ preset: "warm" });
  const envelope = { stateVersion: 1, encoding: "json" as const, payload, checksumSha256: await computePluginStatePayloadChecksum({ encoding: "json", payload }) };
  const previous = { parameters: source.tracks[0]!.devices[0]!.parameters, pluginState: null };
  const next = { parameters: [{ id: "drive", value: 6 }, { id: "mix", value: 0.5 }], pluginState: envelope };

  const command = await ReplacePluginStateEditorCommand.create("track-1", "device-drive", previous, next);
  const replaced = command.execute(source);
  assert.deepEqual(replaced.tracks[0]!.devices[0]!.parameters, next.parameters);
  assert.deepEqual(replaced.tracks[0]!.devices[0]!.pluginState, envelope);
  assert.deepEqual(command.undo(replaced), source);

  await assert.rejects(
    ReplacePluginStateEditorCommand.create("track-1", "device-drive", previous, { ...next, pluginState: { ...envelope, payload: "{}" } }),
    /checksum/
  );
  await assert.rejects(
    ReplacePluginStateEditorCommand.create("track-1", "device-drive", previous, { ...next, parameters: [{ id: "drive", value: Number.NaN }] })
  );
});

test("automation lanes are normalized, replaced as one command, and removable", () => {
  const source = project();
  const command = new SetAutomationLaneEditorCommand("track-1", "device-drive", "drive", null, [
    { tick: 960, value: 4, curve: "linear" },
    { tick: 0, value: 1, curve: "linear" },
    { tick: 960, value: 5, curve: "step" }
  ]);
  const automated = command.execute(source);
  assert.deepEqual(automated.tracks[0]!.devices[0]!.automation, [{
    parameterId: "drive",
    points: [{ tick: 0, value: 1, curve: "linear" }, { tick: 960, value: 5, curve: "step" }]
  }]);
  assert.doesNotThrow(() => MusicProjectV2Schema.parse(automated));
  assert.deepEqual(command.undo(automated), source);

  const remove = new SetAutomationLaneEditorCommand("track-1", "device-drive", "drive", command.nextPoints, null);
  assert.deepEqual(remove.execute(automated).tracks[0]!.devices[0]!.automation, []);
  assert.throws(() => new SetAutomationLaneEditorCommand("track-1", "device-drive", "drive", null, [{ tick: -1, value: 0, curve: "step" }]));
});

test("frozen evidence attachment is reversible and bound to its device", () => {
  const source = project();
  const reference = {
    renderId: "7f7b8f0e-7f55-4a41-9d4e-3b1f8f3f7a10", artifactId: "0c3f3f0e-1a55-4a41-9d4e-3b1f8f3f7a11",
    sourceProjectId: "project-1", sourceRevisionId: "revision-1", sourceProjectChecksumSha256: "c".repeat(64),
    sourceDeviceId: "device-drive", sourcePluginStateChecksumSha256: "a".repeat(64),
    sourceSignalChainChecksumSha256: "b".repeat(64), artifactChecksumSha256: "d".repeat(64),
    engineVersion: "render-worker@1.0.0", frozenAt: "2026-09-22T00:00:00Z"
  };
  const command = new SetFrozenPluginArtifactEditorCommand("track-1", "device-drive", null, reference);
  const frozen = command.execute(source);
  assert.deepEqual(frozen.tracks[0]!.devices[0]!.frozen, reference);
  assert.doesNotThrow(() => MusicProjectV2Schema.parse(frozen));
  assert.deepEqual(command.undo(frozen), source);
  assert.throws(() => new SetFrozenPluginArtifactEditorCommand("track-1", "other", null, reference));
});

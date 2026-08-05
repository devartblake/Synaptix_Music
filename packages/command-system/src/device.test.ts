import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";

import {
  SetDeviceEnabledEditorCommand,
  SetDeviceParameterEditorCommand
} from "./device.ts";

function project() {
  const value = createEmptyProject("device-test");
  value.tracks.push({
    id: "track-1",
    name: "Lead",
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: 0,
    pan: 0,
    devices: [{
      id: "device-1",
      deviceType: "synaptix-lead-synth",
      deviceVersion: "1.0.0",
      enabled: true,
      parameters: [{ id: "filterFrequency", value: 7000 }]
    }],
    clips: []
  });
  return value;
}

test("device enabled edits are reversible", () => {
  const command = new SetDeviceEnabledEditorCommand("track-1", "device-1", true, false);
  const disabled = command.execute(project());
  assert.equal(disabled.tracks[0]?.devices[0]?.enabled, false);
  assert.equal(command.undo(disabled).tracks[0]?.devices[0]?.enabled, true);
});

test("device parameter edits add or update values and are reversible", () => {
  const command = new SetDeviceParameterEditorCommand(
    "track-1",
    "device-1",
    "filterFrequency",
    7000,
    4200
  );
  const updated = command.execute(project());
  assert.equal(updated.tracks[0]?.devices[0]?.parameters[0]?.value, 4200);
  assert.equal(command.undo(updated).tracks[0]?.devices[0]?.parameters[0]?.value, 7000);
});

test("device parameter commands fail closed for non-finite values", () => {
  assert.throws(
    () => new SetDeviceParameterEditorCommand("track-1", "device-1", "filterFrequency", 7000, Number.NaN),
    /finite numbers/
  );
});

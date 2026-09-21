import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FREQUENCY_DRONE_SETTINGS, FREQUENCY_DRONE_PRESETS, clampDroneSettings } from "./frequency-drone-model.ts";

test("ships the nine requested frequency presets", () => {
  assert.deepEqual(FREQUENCY_DRONE_PRESETS.map((preset) => preset.frequencyHz), [174, 285, 396, 417, 528, 639, 741, 852, 963]);
});

test("uses conservative output defaults and clamps unsafe model ranges", () => {
  assert.equal(DEFAULT_FREQUENCY_DRONE_SETTINGS.gain, 0.12);
  const value = clampDroneSettings({ ...DEFAULT_FREQUENCY_DRONE_SETTINGS, frequencyHz: 99999, gain: 1, stereoDetuneHz: 99 });
  assert.equal(value.frequencyHz, 20000);
  assert.equal(value.gain, 0.35);
  assert.equal(value.stereoDetuneHz, 40);
});

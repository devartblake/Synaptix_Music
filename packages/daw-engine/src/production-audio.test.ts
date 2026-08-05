import assert from "node:assert/strict";
import test from "node:test";

import type { Track } from "@synaptix/project-model";

import { meterSnapshot, resolveInstrumentProfile } from "./production-audio.ts";

function track(name: string, deviceType: string): Track {
  return {
    id: `track-${name}`,
    name,
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: -6,
    pan: 0,
    devices: [{
      id: `device-${name}`,
      deviceType,
      deviceVersion: "1.0.0",
      enabled: true,
      parameters: []
    }],
    clips: []
  };
}

test("device-specific profiles route drums and bass deterministically", () => {
  const drums = resolveInstrumentProfile(track("Percussion", "synaptix-drum-synth"));
  const bass = resolveInstrumentProfile(track("Low End", "synaptix-bass-synth"));

  assert.equal(drums.kind, "drums");
  assert.equal(drums.destinationBus, "drums");
  assert.equal(bass.kind, "bass");
  assert.equal(bass.oscillator, "square");
});

test("master meter reports clipping from stereo values", () => {
  assert.deepEqual(meterSnapshot([-3, -0.05], [-12, -10]), {
    peakDbfs: -0.05,
    rmsDbfs: -10,
    clipped: true
  });
});

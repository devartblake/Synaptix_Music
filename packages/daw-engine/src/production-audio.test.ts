import assert from "node:assert/strict";
import test from "node:test";

import type { Track } from "@synaptix/project-model";

import { ENVELOPE_ATTACK_PARAMETER, FILTER_FREQUENCY_PARAMETER, REVERB_SEND_PARAMETER } from "./device-parameters.ts";
import { meterSnapshot, resolveEffectiveInstrumentSettings, resolveInstrumentProfile } from "./production-audio.ts";

function track(name: string, deviceType: string, parameters: { id: string; value: number }[] = []): Track {
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
      parameters
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

test("master meter clamps sub-floor readings to silence instead of reporting drifting negative values", () => {
  assert.deepEqual(meterSnapshot(-1326.6, -95), {
    peakDbfs: Number.NEGATIVE_INFINITY,
    rmsDbfs: Number.NEGATIVE_INFINITY,
    clipped: false
  });
});

test("master meter leaves audible readings just above the silence floor untouched", () => {
  const settled = meterSnapshot(-89.9, -89.9);
  assert.equal(settled.peakDbfs, -89.9);
  assert.equal(settled.rmsDbfs, -89.9);
});

test("effective instrument settings fall back to profile defaults without overrides", () => {
  const settings = resolveEffectiveInstrumentSettings(track("Low End", "synaptix-bass-synth"));
  assert.equal(settings.filterFrequency, 1800);
  assert.equal(settings.attack, 0.005);
  assert.equal(settings.reverbSend, 0.16);
});

test("effective instrument settings apply and clamp canonical device parameter overrides", () => {
  const settings = resolveEffectiveInstrumentSettings(track("Low End", "synaptix-bass-synth", [
    { id: FILTER_FREQUENCY_PARAMETER, value: 400 },
    { id: ENVELOPE_ATTACK_PARAMETER, value: -1 },
    { id: REVERB_SEND_PARAMETER, value: 0.75 }
  ]));
  assert.equal(settings.filterFrequency, 400);
  assert.equal(settings.attack, 0.001);
  assert.equal(settings.reverbSend, 0.75);
  assert.equal(settings.decay, 0.14, "unrelated parameters keep their profile default");
});

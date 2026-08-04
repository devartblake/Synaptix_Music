import assert from "node:assert/strict";
import test from "node:test";

import type { MusicProject } from "@synaptix/project-model";

import {
  isDrumTrack,
  nextStepVelocity,
  noteAtStep,
  notesInBar,
  playbackStep,
  resolveDrumLanes
} from "./drum-step-sequencer-model.ts";

const track = {
  id: "track-drums",
  name: "Drums",
  kind: "instrument" as const,
  muted: false,
  solo: false,
  volumeDb: 0,
  pan: 0,
  devices: [{
    id: "device-drums",
    deviceType: "synaptix-drum-synth",
    deviceVersion: "1.0.0",
    enabled: true,
    parameters: [{ id: "drum-map.kick", value: 35 }]
  }],
  clips: []
};

test("resolves device drum mapping overrides", () => {
  assert.equal(isDrumTrack(track), true);
  assert.equal(resolveDrumLanes(track).find((lane) => lane.id === "kick")?.pitch, 35);
  assert.equal(resolveDrumLanes(track).find((lane) => lane.id === "snare")?.pitch, 38);
});

test("finds notes at exact steps and within bars", () => {
  const notes = [
    { id: "kick-1", pitch: 36, velocity: 100, startTick: 0, durationTicks: 120 },
    { id: "snare-2", pitch: 38, velocity: 100, startTick: 3840, durationTicks: 120 }
  ];
  assert.equal(noteAtStep(notes, 36, 0, 240)?.id, "kick-1");
  assert.deepEqual(notesInBar(notes, 1, 3840).map((note) => note.id), ["snare-2"]);
});

test("cycles velocity through soft normal and accent", () => {
  assert.equal(nextStepVelocity(64), 100);
  assert.equal(nextStepVelocity(100), 127);
  assert.equal(nextStepVelocity(127), 64);
});

test("computes looping playback cursor", () => {
  assert.equal(playbackStep(0, 120, 1), 0);
  assert.equal(playbackStep(125, 120, 1), 1);
  assert.equal(playbackStep(2000, 120, 1), 0);
});

void ({} as MusicProject);

import assert from "node:assert/strict";
import test from "node:test";

import type { MusicProject } from "@synaptix/project-model";

import {
  DRUM_KIT_DEVICE_TYPE,
  drumNoteName,
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

const kit = {
  ...track,
  id: "track-kit",
  devices: [{ ...track.devices[0]!, id: "device-kit", deviceType: DRUM_KIT_DEVICE_TYPE, parameters: [] }]
};

test("the Drum Kit opens in the step sequencer with a lane for every drum it plays", () => {
  // Its device type has no "drum" in it, so it used to open in the plain piano roll.
  assert.equal(isDrumTrack(kit), true);
  assert.deepEqual(
    resolveDrumLanes(kit).map((lane) => `${lane.label} ${lane.pitch}`),
    ["Kick 36", "Rim 37", "Snare 38", "Clap 39", "Closed Hat 42", "Open Hat 46",
      "Low Tom 45", "Mid Tom 47", "High Tom 50", "Crash 49", "Ride 51"]
  );
  // Drum Synth keeps its eight lanes: it has no rim or cymbal sounds.
  assert.equal(resolveDrumLanes(track).length, 8);
});

test("drum notes are named by what they play, for the piano roll", () => {
  assert.equal(drumNoteName(kit, 36), "Kick");
  assert.equal(drumNoteName(kit, 51), "Ride");
  // Notes off the lanes: the kit's own map (low notes kick, unmapped notes tuned toms).
  assert.equal(drumNoteName(kit, 30), "Kick");
  assert.equal(drumNoteName(kit, 44), "Closed Hat");
  assert.equal(drumNoteName(kit, 72), "Tom");
  // Drum Synth names its lanes; other notes are plain pitches. Melodic tracks get no drum names.
  assert.equal(drumNoteName(track, 38), "Snare");
  assert.equal(drumNoteName(track, 72), null);
  assert.equal(drumNoteName({ ...track, devices: [{ ...track.devices[0]!, deviceType: "synaptix-lead-synth" }] }, 36), null);
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

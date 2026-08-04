import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject, type MusicProject } from "@synaptix/project-model";

import {
  AddMidiNoteCommand,
  ClearDrumPatternCommand,
  DuplicateMidiNotesCommand,
  MoveMidiNotesCommand,
  QuantizeMidiNotesCommand,
  RemoveMidiNotesCommand,
  ResizeMidiNotesCommand,
  SetMidiVelocityCommand,
  ToggleDrumStepCommand,
  TransposeMidiNotesCommand
} from "./midi.ts";

function project(): MusicProject {
  const value = createEmptyProject("project-midi", {
    revisionId: "revision-1",
    now: "2026-08-04T19:00:00.000Z"
  });
  value.tracks = [{
    id: "track-1",
    name: "Drums",
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: 0,
    pan: 0,
    devices: [],
    clips: [{
      id: "clip-1",
      kind: "midi",
      name: "Pattern",
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 3840 },
      loop: true,
      notes: [
        { id: "note-1", pitch: 36, velocity: 100, startTick: 110, durationTicks: 240 },
        { id: "note-2", pitch: 38, velocity: 90, startTick: 960, durationTicks: 240 }
      ]
    }]
  }];
  return value;
}

function notes(value: MusicProject) {
  const clip = value.tracks[0]?.clips[0];
  assert.equal(clip?.kind, "midi");
  return clip.notes;
}

test("add and remove MIDI notes are reversible", () => {
  const original = project();
  const add = new AddMidiNoteCommand("track-1", "clip-1", {
    id: "note-3", pitch: 42, velocity: 80, startTick: 1920, durationTicks: 240
  });
  const added = add.execute(original);
  assert.equal(notes(added).length, 3);
  assert.deepEqual(notes(add.undo(added)), notes(original));

  const remove = new RemoveMidiNotesCommand("track-1", "clip-1", ["note-1", "note-2"]);
  const removed = remove.execute(original);
  assert.equal(notes(removed).length, 0);
  assert.deepEqual(notes(remove.undo(removed)), notes(original));
});

test("multi-note movement resize velocity and transpose are reversible", () => {
  const original = project();
  const move = new MoveMidiNotesCommand("track-1", "clip-1", ["note-1", "note-2"], 120, 2);
  const moved = move.execute(original);
  assert.equal(notes(moved)[0]?.startTick, 230);
  assert.equal(notes(moved)[0]?.pitch, 38);
  assert.deepEqual(notes(move.undo(moved)), notes(original));

  const resize = new ResizeMidiNotesCommand("track-1", "clip-1", ["note-1"], 120);
  const resized = resize.execute(original);
  assert.equal(notes(resized)[0]?.durationTicks, 360);

  const velocity = new SetMidiVelocityCommand("track-1", "clip-1", ["note-2"], 127);
  assert.equal(notes(velocity.execute(original))[1]?.velocity, 127);

  const transpose = new TransposeMidiNotesCommand("track-1", "clip-1", ["note-2"], -12);
  assert.equal(notes(transpose.execute(original))[1]?.pitch, 26);
});

test("quantize and duplicate preserve deterministic batch behavior", () => {
  const original = project();
  const quantize = new QuantizeMidiNotesCommand("track-1", "clip-1", ["note-1"], 240);
  assert.equal(notes(quantize.execute(original))[0]?.startTick, 0);

  const duplicate = new DuplicateMidiNotesCommand(
    "track-1",
    "clip-1",
    ["note-1"],
    480,
    () => "note-copy"
  );
  const duplicated = duplicate.execute(original);
  assert.equal(notes(duplicated).length, 3);
  assert.equal(notes(duplicated).find((note) => note.id === "note-copy")?.startTick, 590);
  assert.deepEqual(notes(duplicate.undo(duplicated)), notes(original));
});

test("drum step toggling and clearing are reversible", () => {
  const original = project();
  const addStep = new ToggleDrumStepCommand("track-1", "clip-1", 42, 480, 120, 96);
  const withStep = addStep.execute(original);
  assert.equal(notes(withStep).some((note) => note.pitch === 42 && note.startTick === 480), true);
  assert.deepEqual(notes(addStep.undo(withStep)), notes(original));

  const removeStep = new ToggleDrumStepCommand("track-1", "clip-1", 36, 110, 120);
  assert.equal(notes(removeStep.execute(original)).some((note) => note.id === "note-1"), false);

  const clear = new ClearDrumPatternCommand("track-1", "clip-1", [36, 38]);
  const cleared = clear.execute(original);
  assert.equal(notes(cleared).length, 0);
  assert.deepEqual(notes(clear.undo(cleared)), notes(original));
});

test("invalid MIDI edits fail closed", () => {
  const original = project();
  assert.throws(
    () => new AddMidiNoteCommand("track-1", "clip-1", {
      id: "bad", pitch: 128, velocity: 100, startTick: 0, durationTicks: 120
    }).execute(original),
    /pitch/
  );
  assert.throws(
    () => new ResizeMidiNotesCommand("track-1", "clip-1", ["note-1"], -240).execute(original),
    /durationTicks/
  );
  assert.throws(
    () => new MoveMidiNotesCommand("track-1", "clip-1", ["note-1"], -200, 0).execute(original),
    /startTick/
  );
});

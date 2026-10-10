import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";
import { ApplyGeneratedArrangementEditorCommand, projectKeyFromGeneration } from "./apply-generated-arrangement-command.ts";

test("generated variations replace the arrangement and undo restores it", () => {
  const project = createEmptyProject("project-1");
  project.tracks = [{ id: "old", name: "Old", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices: [], clips: [] }];
  const roles = ["drums", "bass", "harmony", "melody"] as const;
  const proposal = {
    operation: "create-arrangement" as const, projectId: "project-1", genre: "electronic-trivia" as const, mood: "upbeat" as const,
    tempo: 120, key: "D minor", ticksPerQuarterNote: 960 as const,
    sections: [
      { id: "s1", kind: "intro" as const, name: "Intro", startBar: 0, bars: 4 },
      { id: "s2", kind: "main" as const, name: "Main", startBar: 4, bars: 8 },
      { id: "s3", kind: "victory" as const, name: "Win", startBar: 12, bars: 4 }
    ],
    tracks: roles.map((role, index) => ({ id: `track-${index}`, role, name: role, instrumentId: "synth", clips: [] })),
    provenance: { generatorId: "synaptix-procedural-composer" as const, generatorVersion: "0.1.0" as const, seed: 9 }, warnings: []
  };
  const command = new ApplyGeneratedArrangementEditorCommand(proposal, "job-1");
  const generated = command.execute(project);
  assert.deepEqual(generated.tracks.map((track) => track.id), ["track-0", "track-1", "track-2", "track-3"]);
  assert.equal(generated.generationMetadata?.seed, 9);
  assert.deepEqual(command.undo(generated).tracks.map((track) => track.id), ["old"]);
  // The generator's key becomes the project's key, so it travels with the project; undo removes
  // it again (the project had none).
  assert.deepEqual(generated.key, { tonic: 2, mode: "minor" });
  assert.equal("key" in command.undo(generated), false);
});

test("generator key names map to pitch classes, flats included, and unknown names map to nothing", () => {
  assert.deepEqual(projectKeyFromGeneration("Eb harmonic minor"), { tonic: 3, mode: "harmonic minor" });
  assert.deepEqual(projectKeyFromGeneration("F# lydian"), { tonic: 6, mode: "lydian" });
  assert.deepEqual(projectKeyFromGeneration("B major"), { tonic: 11, mode: "major" });
  assert.equal(projectKeyFromGeneration("H minor"), null);
  assert.equal(projectKeyFromGeneration("C"), null);
});

test("generated mix hints and supporting layers become the project's tracks", () => {
  const project = createEmptyProject("project-1");
  const proposal = {
    operation: "create-arrangement" as const, projectId: "project-1", genre: "electronic-trivia" as const, mood: "triumphant" as const,
    tempo: 156, key: "C major", ticksPerQuarterNote: 960 as const,
    sections: [{ id: "s1", kind: "main" as const, name: "Main", startBar: 0, bars: 8 }],
    tracks: [
      { id: "track-melody", role: "melody" as const, name: "Lead Melody (Organ)", instrumentId: "synaptix-organ", clips: [], volumeDb: -10, pan: 0, reverbSend: 0.2 },
      { id: "track-sparkle", role: "sparkle" as const, name: "Sparkle (Bell)", instrumentId: "synaptix-bell", clips: [], volumeDb: -16, pan: 0.35, reverbSend: 0.4 },
      { id: "track-drums", role: "drums" as const, name: "Drums", instrumentId: "synaptix-drum-synth", clips: [] }
    ],
    provenance: { generatorId: "synaptix-procedural-composer" as const, generatorVersion: "0.2.0", seed: 1 }, warnings: []
  };
  const tracks = new ApplyGeneratedArrangementEditorCommand(proposal, "job-2").execute(project).tracks;
  const sparkle = tracks.find((track) => track.id === "track-sparkle")!;
  assert.equal(sparkle.devices[0]!.deviceType, "synaptix-bell");
  assert.equal(sparkle.volumeDb, -16);
  assert.equal(sparkle.pan, 0.35);
  assert.equal(sparkle.reverbSend, 0.4);
  const drums = tracks.find((track) => track.id === "track-drums")!;
  assert.equal(drums.volumeDb, 0, "older proposals without mix hints keep the defaults");
  assert.equal(drums.reverbSend, undefined);
});

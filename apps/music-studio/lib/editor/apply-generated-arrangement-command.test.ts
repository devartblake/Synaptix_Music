import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";
import { ApplyGeneratedArrangementEditorCommand } from "./apply-generated-arrangement-command.ts";

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
});

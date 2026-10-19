import assert from "node:assert/strict";
import test from "node:test";

import {
  MusicProjectSchema,
  createEmptyProject,
  editShare,
  generatedNoteHashes,
  noteHash,
  type MusicProject
} from "./index.ts";
import { MusicProjectV2Schema, migrateProjectV1ToV2 } from "./v2.ts";

// Publication rules v1, phase 1: generated music carries its licence facts and a per-note record, so
// publishing can refuse unlicensed material and report how much a person changed.

function generatedProject(): MusicProject {
  const project = createEmptyProject("p", { revisionId: "r1", now: "2026-10-19T00:00:00.000Z" });
  project.tracks.push({
    id: "t", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: -8, pan: 0, devices: [],
    clips: [{
      id: "c", kind: "midi", name: "Lead", loop: false, range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 15360 },
      notes: [0, 1, 2, 3].map((index) => ({ id: `n${index}`, pitch: 60 + index, startTick: index * 960, durationTicks: 480, velocity: 100 }))
    }]
  });
  project.generationMetadata = {
    generatorId: "synaptix-claude-composer",
    generatorVersion: "1.0.0",
    seed: 7,
    createdAt: "2026-10-19T00:00:00.000Z",
    provenance: { model: "claude-x", licence: "Anthropic-Commercial-Terms", commercialUse: "allowed", planSha256: "a".repeat(64) },
    generatedNotes: generatedNoteHashes(project)
  };
  return project;
}

test("music left as generated has an edit share of 0", () => {
  assert.equal(editShare(generatedProject()), 0);
});

test("each changed, removed or added note counts toward the edit share", () => {
  const project = generatedProject();
  const notes = (project.tracks[0]!.clips[0] as Extract<MusicProject["tracks"][number]["clips"][number], { kind: "midi" }>).notes;
  // Velocity is part of what a note plays, so changing it is an edit.
  notes[0]!.velocity = 90;
  assert.equal(editShare(project), 1 / 4);
  notes.splice(1, 1);
  assert.equal(editShare(project), 2 / 4);
  notes.push({ id: "added", pitch: 72, startTick: 0, durationTicks: 240, velocity: 80 });
  // Two of four generated notes differ, plus one added: 3 ÷ (4 + 1).
  assert.equal(editShare(project), 3 / 5);
});

test("hand-composed music has no edit share, and a note's hash ignores its id", () => {
  const hand = createEmptyProject("h");
  assert.equal(editShare(hand), null);
  assert.equal(noteHash({ pitch: 60, startTick: 0, durationTicks: 480, velocity: 100 }), noteHash({ pitch: 60, startTick: 0, durationTicks: 480, velocity: 100 }));
  assert.notEqual(noteHash({ pitch: 60, startTick: 0, durationTicks: 480, velocity: 100 }), noteHash({ pitch: 61, startTick: 0, durationTicks: 480, velocity: 100 }));
});

test("provenance validates in v1 and v2, rejects unknown commercial-use values, and is optional", () => {
  const project = generatedProject();
  assert.doesNotThrow(() => MusicProjectSchema.parse(project));
  assert.doesNotThrow(() => MusicProjectV2Schema.parse(migrateProjectV1ToV2(project)));
  const bad = structuredClone(project) as unknown as { generationMetadata: { provenance: { commercialUse: string } } };
  bad.generationMetadata.provenance.commercialUse = "maybe";
  assert.throws(() => MusicProjectSchema.parse(bad));
  // Projects generated before the record existed serialize exactly as before (so their checksums
  // don't change): the fields stay absent rather than appearing empty.
  const older = generatedProject();
  delete older.generationMetadata!.provenance;
  delete older.generationMetadata!.generatedNotes;
  const parsed = MusicProjectSchema.parse(older);
  assert.deepEqual(Object.keys(parsed.generationMetadata!).sort(), Object.keys(older.generationMetadata!).sort());
});

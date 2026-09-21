import assert from "node:assert/strict";
import test from "node:test";

import { buildGenerationJobRequest, formForPreset, interpretCreativeBrief, proposalSummary } from "./generation-workspace-model.ts";

test("presets build a valid idempotent platform request", () => {
  const request = buildGenerationJobRequest(
    "project-1", "revision-1", formForPreset("pressure-rise", 42), "idempotency-1", "correlation-1", "2026-09-20T00:00:00.000Z"
  );
  assert.equal(request.generation.mood, "tense");
  assert.equal(request.generation.seed, 42);
  assert.equal(request.expectedRevisionId, "revision-1");
});

test("creative briefs tune only supported structured controls", () => {
  const interpreted = interpretCreativeBrief(formForPreset("bright-round"), "Intense layered boss countdown");
  assert.equal(interpreted.mood, "tense");
  assert.equal(interpreted.tempo, 132);
  assert.equal(interpreted.energy, 0.85);
  assert.equal(interpreted.complexity, 0.75);
});

test("proposal summaries count tracks notes sections and duration", () => {
  const summary = proposalSummary({
    operation: "create-arrangement", projectId: "project-1", genre: "electronic-trivia", mood: "upbeat", tempo: 120,
    key: "D minor", ticksPerQuarterNote: 960,
    sections: [
      { id: "s1", kind: "intro", name: "Intro", startBar: 0, bars: 4 },
      { id: "s2", kind: "main", name: "Main", startBar: 4, bars: 8 },
      { id: "s3", kind: "victory", name: "Win", startBar: 12, bars: 4 }
    ],
    tracks: Array.from({ length: 4 }, (_, index) => ({
      id: `t${index}`, role: (["drums", "bass", "harmony", "melody"] as const)[index]!, name: `Track ${index}`,
      instrumentId: "instrument", clips: [{ id: `c${index}`, name: "Clip", range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 15360 }, loop: true,
        notes: [{ id: `n${index}`, pitch: 60, velocity: 100, startTick: 0, durationTicks: 960 }] }]
    })),
    provenance: { generatorId: "synaptix-procedural-composer", generatorVersion: "0.1.0", seed: 1 }, warnings: []
  });
  assert.deepEqual(summary, { sectionCount: 3, trackCount: 4, noteCount: 4, durationBars: 16 });
});

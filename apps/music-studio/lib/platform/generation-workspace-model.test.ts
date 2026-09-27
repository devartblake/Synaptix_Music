import assert from "node:assert/strict";
import test from "node:test";

import { buildGenerationJobRequest, composerLabel, formForPreset, interpretCreativeBrief, proposalSummary, prototypeAudioPrompt } from "./generation-workspace-model.ts";

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

test("the creative brief is sent trimmed and only when present", () => {
  const form = formForPreset("pressure-rise", 1);
  const withBrief = buildGenerationJobRequest("p", "r", form, "i", "c", "2026-09-25T00:00:00.000Z", "  boss fight  ");
  assert.equal(withBrief.generation.brief, "boss fight");
  const blank = buildGenerationJobRequest("p", "r", form, "i", "c", "2026-09-25T00:00:00.000Z", "   ");
  assert.equal("brief" in blank.generation, false);
  const long = buildGenerationJobRequest("p", "r", form, "i", "c", "2026-09-25T00:00:00.000Z", "x".repeat(2500));
  assert.equal(long.generation.brief?.length, 2000);
});

test("previews say which composer wrote the arrangement", () => {
  assert.equal(
    composerLabel({ generatorId: "synaptix-claude-composer", generatorVersion: "1.0.0", seed: 1, model: "claude-opus-5" }),
    "Composed by Claude (claude-opus-5)"
  );
  assert.equal(
    composerLabel({ generatorId: "synaptix-procedural-composer", generatorVersion: "0.1.0", seed: 7 }),
    "Procedural composer · seed 7"
  );
});

test("briefs choose a mode from their wording and keep the tonic", () => {
  const form = formForPreset("bright-round"); // D minor
  const key = (brief: string) => interpretCreativeBrief(form, brief).key;
  assert.equal(key("An up-tempo heroic adventure, like a Pokémon route"), "D major");
  assert.equal(key("The villain arrives"), "D harmonic minor");
  assert.equal(key("Dreamy, magical forest"), "D lydian");
  assert.equal(key("Groovy bluesy shop music"), "D mixolydian");
  assert.equal(key("Mysterious desert ruins"), "D phrygian");
  assert.equal(key("A cool, sneaky heist"), "D dorian");
  assert.equal(key("Fast quiz round"), "D minor", "no mode words leaves the key alone");
});

test("a key named in the brief is used exactly", () => {
  const form = formForPreset("bright-round");
  const key = (brief: string) => interpretCreativeBrief(form, brief).key;
  assert.equal(key("Victory fanfare in C major"), "C major");
  assert.equal(key("key of F# dorian, cool and sneaky"), "F# dorian");
  assert.equal(key("Boss theme in A harmonic minor"), "A harmonic minor");
  assert.equal(key("Bb mixolydian key, groovy"), "Bb mixolydian");
  assert.equal(key("Not a major battle"), "D minor", "a bare 'a major' isn't a key");
});

test("major and harmonic-minor presets send their keys", () => {
  const adventure = buildGenerationJobRequest("p", "r", formForPreset("adventure-route"), "i", "c", "2026-09-26T00:00:00.000Z");
  const villain = buildGenerationJobRequest("p", "r", formForPreset("villain-encounter"), "i", "c", "2026-09-26T00:00:00.000Z");
  assert.equal(adventure.generation.key, "C major");
  assert.equal(villain.generation.key, "A harmonic minor");
});

test("an up-tempo brief asks for real speed", () => {
  const form = formForPreset("bright-round"); // 120 BPM
  assert.equal(interpretCreativeBrief(form, "An up-tempo route theme").tempo, 152);
  assert.equal(interpretCreativeBrief(form, "Fast quiz round").tempo, 132);
  assert.equal(formForPreset("adventure-route").tempo, 156);
});

test("prototype audio prompts combine the brief with the musical controls", () => {
  const prompt = prototypeAudioPrompt(formForPreset("adventure-route"), "  Heroic   route theme ");
  assert.equal(prompt, "Heroic route theme. upbeat, bright and bouncy video game music, 156 BPM, C major, high energy, full band");
  assert.ok(prototypeAudioPrompt(formForPreset("bright-round"), "x".repeat(900)).length <= 500);
  assert.match(prototypeAudioPrompt(formForPreset("villain-encounter"), ""), /^tense, urgent and driving video game music, 136 BPM, A harmonic minor/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { aiTags, assertDeliverableFormats, withWavInfo } from "./ai-marking.ts";
import { encodeWav } from "./wav-encoder.ts";

test("music with AI involvement is tagged with its generator, model and licence; hand-composed isn't", () => {
  assert.deepEqual(
    aiTags({
      generationMetadata: {
        generatorId: "synaptix-claude-composer",
        provenance: { model: "claude-x", licence: "Anthropic-Commercial-Terms" }
      }
    }),
    { AI_GENERATED: "true", AI_GENERATOR: "synaptix-claude-composer", AI_MODEL: "claude-x", AI_LICENSE: "Anthropic-Commercial-Terms" }
  );
  assert.equal(aiTags({}), null);
});

test("the INFO chunk keeps the WAV valid: sizes add up and the audio is unchanged", () => {
  const wav = encodeWav({ left: new Float64Array([0, 0.5, -0.5]), right: new Float64Array([0, 0.25, -0.25]) }, 44100, 16);
  const tagged = withWavInfo(wav, { AI_GENERATED: "true", AI_MODEL: "odd" });
  assert.equal(tagged.readUInt32LE(4), tagged.length - 8);
  assert.ok(tagged.subarray(0, wav.length).subarray(8).equals(wav.subarray(8)));
  const list = tagged.subarray(wav.length);
  assert.equal(list.toString("ascii", 0, 4), "LIST");
  assert.equal(list.readUInt32LE(4), list.length - 8);
  assert.match(list.toString("utf8"), /ICMT.*AI_GENERATED=true; AI_MODEL=odd/s);
  assert.throws(() => withWavInfo(Buffer.from("ID3"), {}), /RIFF\/WAVE/);
});

test("music made with AI is never delivered as OGG, previews included; hand-composed music may be", () => {
  const ai = { generationMetadata: { generatorId: "synaptix-claude-composer" } };
  assert.throws(() => assertDeliverableFormats(ai, { format: "ogg" }), /OGG isn't offered/);
  assert.throws(() => assertDeliverableFormats(ai, { format: "wav", preview: { format: "ogg" } }), /OGG isn't offered/);
  assert.doesNotThrow(() => assertDeliverableFormats(ai, { format: "mp3", preview: { format: "mp3" } }));
  assert.doesNotThrow(() => assertDeliverableFormats({}, { format: "ogg" }));
});

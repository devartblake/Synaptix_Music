import assert from "node:assert/strict";
import test from "node:test";
import type { Clip } from "@synaptix/project-model";
import { boundedNoteMove, boundedNoteResize } from "./note-editing.ts";

const clip: Extract<Clip, { kind: "midi" }> = {
  id: "clip",
  kind: "midi",
  name: "Bounds",
  loop: false,
  range: { start: { bar: 2, beat: 1, tick: 12 }, durationTicks: 960 },
  notes: [
    { id: "low", pitch: 0, velocity: 100, startTick: 20, durationTicks: 100 },
    { id: "high", pitch: 127, velocity: 100, startTick: 700, durationTicks: 200 }
  ]
};
test("group movement preserves spacing at both clip and pitch boundaries", () => {
  assert.deepEqual(boundedNoteMove(clip, ["low", "high"], -240, -12), { ticks: -20, pitch: 0 });
  assert.deepEqual(boundedNoteMove(clip, ["low", "high"], 240, 12), { ticks: 60, pitch: 0 });
  assert.deepEqual(boundedNoteMove(clip, ["high"], -240, -12), { ticks: -240, pitch: -12 });
});
test("group resizing keeps every duration positive and within the clip", () => {
  assert.equal(boundedNoteResize(clip, ["low", "high"], -240), -99);
  assert.equal(boundedNoteResize(clip, ["low", "high"], 240), 60);
  assert.equal(boundedNoteResize(clip, ["deleted"], 240), 0);
});

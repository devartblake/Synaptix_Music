import assert from "node:assert/strict";
import test from "node:test";

import {
  pitchFromPointer,
  snapTick,
  tickFromPointer,
  toggleSelection
} from "./piano-roll-model.ts";

test("snapTick rounds to the nearest grid and clamps to clip bounds", () => {
  assert.equal(snapTick(370, 240, 960), 480);
  assert.equal(snapTick(-20, 240, 960), 0);
  assert.equal(snapTick(1200, 240, 960), 960);
});

test("toggleSelection supports replacement and additive toggles", () => {
  assert.deepEqual([...toggleSelection(new Set(["a"]), "b", false)], ["b"]);
  assert.deepEqual([...toggleSelection(new Set(["a"]), "b", true)].sort(), ["a", "b"]);
  assert.deepEqual([...toggleSelection(new Set(["a", "b"]), "b", true)], ["a"]);
});

test("pointer conversion maps coordinates to valid pitch and ticks", () => {
  assert.equal(pitchFromPointer(0, 480, 84, 36), 84);
  assert.equal(pitchFromPointer(480, 480, 84, 36), 36);
  assert.equal(tickFromPointer(500, 1000, 3840), 1920);
});

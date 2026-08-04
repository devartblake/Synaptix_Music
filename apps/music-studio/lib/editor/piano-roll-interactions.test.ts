import assert from "node:assert/strict";
import test from "node:test";

import {
  clampNoteToClip,
  clampZoom,
  nextClipboardStart,
  notesInsideMarquee,
  rectangleFromPoints
} from "./piano-roll-interactions.ts";

test("normalizes marquee coordinates and selects intersecting notes", () => {
  const marquee = rectangleFromPoints({ x: 90, y: 70 }, { x: 10, y: 20 });
  assert.deepEqual(marquee, { left: 10, top: 20, right: 90, bottom: 70 });
  assert.deepEqual(
    [...notesInsideMarquee(marquee, [
      { id: "inside", left: 20, top: 30, right: 40, bottom: 50 },
      { id: "outside", left: 100, top: 100, right: 120, bottom: 120 }
    ])],
    ["inside"]
  );
});

test("clamps zoom and notes to supported bounds", () => {
  assert.equal(clampZoom(0.1), 0.5);
  assert.equal(clampZoom(5), 4);
  assert.deepEqual(clampNoteToClip(990, 40, 1000), { startTick: 960, durationTicks: 40 });
});

test("preserves relative clipboard timing", () => {
  assert.equal(nextClipboardStart(480, 240, 960), 1200);
});

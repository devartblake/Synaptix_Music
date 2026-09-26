import assert from "node:assert/strict";
import test from "node:test";

import { copyNotes, pasteNotes, readNoteClipboard, writeNoteClipboard } from "./note-clipboard.ts";

const notes = [
  { id: "a", pitch: 60, velocity: 100, startTick: 960, durationTicks: 240 },
  { id: "b", pitch: 64, velocity: 80, startTick: 1200, durationTicks: 480 },
  { id: "c", pitch: 67, velocity: 90, startTick: 3000, durationTicks: 240 }
];

test("copy keeps timing relative to the earliest selected note", () => {
  const copied = copyNotes(notes, ["b", "a"]);
  assert.deepEqual(copied, {
    notes: [
      { pitch: 60, velocity: 100, offsetTicks: 0, durationTicks: 240 },
      { pitch: 64, velocity: 80, offsetTicks: 240, durationTicks: 480 }
    ],
    spanTicks: 720
  });
  assert.equal(copyNotes(notes, ["missing"]), null);
});

test("paste places notes at the target with fresh IDs", () => {
  let next = 0;
  const pasted = pasteNotes(copyNotes(notes, ["a", "b"])!, 7680, 1920, () => `n${next++}`);
  assert.deepEqual(pasted, [
    { id: "n0", pitch: 60, velocity: 100, startTick: 1920, durationTicks: 240 },
    { id: "n1", pitch: 64, velocity: 80, startTick: 2160, durationTicks: 480 }
  ]);
});

test("paste near the clip end drops and trims notes to fit", () => {
  const copied = copyNotes(notes, ["a", "b"])!;
  const pasted = pasteNotes(copied, 3840, 3700, () => "x");
  assert.deepEqual(pasted, [{ id: "x", pitch: 60, velocity: 100, startTick: 3700, durationTicks: 140 }]);
  assert.deepEqual(pasteNotes(copied, 3840, 4000), []);
});

test("the clipboard is shared for the session", () => {
  writeNoteClipboard(copyNotes(notes, ["c"]));
  assert.equal(readNoteClipboard()?.notes[0]?.pitch, 67);
  writeNoteClipboard(null);
  assert.equal(readNoteClipboard(), null);
});

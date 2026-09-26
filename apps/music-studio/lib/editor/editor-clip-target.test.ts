import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject, type Track } from "@synaptix/project-model";

import { editorKindForTrack, findEditorClip } from "./editor-clip-target.ts";

function track(id: string, deviceType: string, clipIds: string[]): Track {
  return {
    id, name: id, kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0,
    devices: [{ id: `${id}-device`, deviceType, deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: clipIds.map((clipId) => ({
      id: clipId, kind: "midi" as const, name: clipId, loop: false, notes: [],
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 3840 }
    }))
  };
}

function project() {
  const value = createEmptyProject("p");
  value.tracks = [
    track("drone", "synaptix-frequency-drone", []),
    track("drums", "synaptix-drum-synth", ["drum-a", "drum-b"]),
    track("keys", "synaptix-electric-piano", ["keys-a"]),
    track("pad", "synaptix-pad", ["pad-a"])
  ];
  return value;
}

test("each editor opens the first clip on a matching track", () => {
  assert.deepEqual(findEditorClip(project(), "piano-roll"), { trackId: "keys", clipId: "keys-a" });
  assert.deepEqual(findEditorClip(project(), "drum-sequencer"), { trackId: "drums", clipId: "drum-a" });
});

test("the clip already being edited wins when it suits the editor", () => {
  const current = { trackId: "pad", clipId: "pad-a" };
  assert.deepEqual(findEditorClip(project(), "piano-roll", current), current);
  assert.deepEqual(
    findEditorClip(project(), "drum-sequencer", current),
    { trackId: "drums", clipId: "drum-a" },
    "a melodic clip never opens in the drum sequencer"
  );
  assert.deepEqual(
    findEditorClip(project(), "piano-roll", { trackId: "keys", clipId: "missing" }),
    { trackId: "keys", clipId: "keys-a" }
  );
});

test("editors without a suitable clip have nothing to open", () => {
  const value = project();
  value.tracks = value.tracks.filter((item) => item.id === "drone");
  assert.equal(findEditorClip(value, "piano-roll"), null);
  assert.equal(findEditorClip(value, "drum-sequencer"), null);
  assert.equal(editorKindForTrack(value, "nope"), null);
});

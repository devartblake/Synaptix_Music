import assert from "node:assert/strict";
import test from "node:test";

import { ClipSchema, createEmptyProject, type Track } from "@synaptix/project-model";

import { canAddMidiClip, createEmptyMidiClip } from "./new-clip.ts";

function track(deviceType: string, clipBars: [number, number][] = []): Track {
  return {
    id: "t", name: "Keys", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0,
    devices: [{ id: "d", deviceType, deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: clipBars.map(([bar, bars], index) => ({
      id: `c${index}`, kind: "midi" as const, name: "c", loop: false, notes: [],
      range: { start: { bar, beat: 0, tick: 0 }, durationTicks: bars * 3840 }
    }))
  };
}

test("new clips start on the first whole bar after the last clip", () => {
  const project = createEmptyProject("p");
  const empty = createEmptyMidiClip(project, track("synaptix-pad"), "x");
  assert.deepEqual(empty.range, { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 4 * 3840 });
  assert.equal(empty.name, "Keys clip 1");
  assert.doesNotThrow(() => ClipSchema.parse(empty));

  const after = createEmptyMidiClip(project, track("synaptix-pad", [[0, 2], [6, 1]]), "y");
  assert.equal(after.range.start.bar, 7);

  const partial = track("synaptix-pad", [[0, 1]]);
  partial.clips[0]!.range.durationTicks = 3840 + 100;
  assert.equal(createEmptyMidiClip(project, partial, "z").range.start.bar, 2, "rounds up to a whole bar");
});

test("drones never get MIDI clips", () => {
  assert.equal(canAddMidiClip(track("synaptix-frequency-drone")), false);
  assert.equal(canAddMidiClip(track("synaptix-drum-synth")), true);
  assert.equal(canAddMidiClip({ ...track("synaptix-pad"), kind: "bus" }), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyProject } from "@synaptix/project-model";
import {
  arrangementBars,
  barRange,
  barTicks,
  clipPlaybackTick,
  positionTicks,
  tickPosition,
  transportLabel,
  transportTime
} from "./timeline-model.ts";

test("timeline includes beat/tick offsets and clips beyond the original 16 bars", () => {
  const project = createEmptyProject("timeline");
  project.transport.ticksPerQuarterNote = 480;
  project.timeSignatureMap[0]!.numerator = 3;
  const clip = {
    id: "offset",
    kind: "midi" as const,
    name: "Offset",
    loop: true,
    notes: [],
    range: { start: { bar: 20, beat: 1, tick: 12 }, durationTicks: 1000 }
  };
  project.tracks = [
    {
      id: "track",
      name: "Track",
      kind: "instrument",
      muted: false,
      solo: false,
      volumeDb: 0,
      pan: 0,
      devices: [],
      clips: [clip]
    }
  ];
  assert.equal(barTicks(project), 1440);
  assert.equal(positionTicks(project, clip.range.start), 29292);
  assert.equal(arrangementBars(project), 22);
  assert.equal(clipPlaybackTick(project, clip, 29291), null);
  assert.equal(clipPlaybackTick(project, clip, 29292), 0);
  assert.equal(clipPlaybackTick(project, clip, 30292), null);
  assert.equal(transportLabel(project, 29292), "21:2:012");
});

test("the time counter follows the tempo, so a bar at 120 BPM is two seconds and at 90 BPM is longer", () => {
  const project = createEmptyProject("clock");
  const bar = barTicks(project);
  assert.equal(transportTime(project, 0), "0:00.0");
  assert.equal(transportTime(project, bar), "0:02.0");
  assert.equal(transportTime(project, bar * 30 + bar / 4), "1:00.5");
  project.tempoMap[0]!.bpm = 90;
  assert.equal(transportTime(project, bar), "0:02.6");
  assert.equal(transportTime(project, -5), "0:00.0");
});

test("tick positions round-trip, and a dragged loop covers whole bars whichever way it was dragged", () => {
  const project = createEmptyProject("positions");
  project.timeSignatureMap[0]!.numerator = 3;
  for (const position of [{ bar: 0, beat: 0, tick: 0 }, { bar: 7, beat: 2, tick: 959 }, { bar: 12, beat: 1, tick: 5 }]) {
    assert.deepEqual(tickPosition(project, positionTicks(project, position)), position);
  }
  assert.deepEqual(barRange(project, 11, 8), barRange(project, 8, 11));
  assert.deepEqual(barRange(project, 8, 11), { start: { bar: 8, beat: 0, tick: 0 }, durationTicks: 4 * barTicks(project) });
  assert.equal(barRange(project, 3, 3).durationTicks, barTicks(project));
});

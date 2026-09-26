import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyProject } from "@synaptix/project-model";
import {
  arrangementBars,
  barTicks,
  clipPlaybackTick,
  positionTicks,
  transportLabel
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

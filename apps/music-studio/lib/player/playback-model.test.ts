import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject, type MusicProject } from "@synaptix/project-model";
import { migrateProjectV1ToV2 } from "@synaptix/project-model/v2";

import {
  artworkContour,
  artworkPalette,
  formatClock,
  listeningProject,
  nextIndex,
  playbackItemKey,
  previousIndex,
  projectDurationSeconds,
  projectDurationTicks,
  studioHref,
  studioStartTick,
  summarizeTracks,
  type PlaybackItem
} from "./playback-model.ts";

function project(): MusicProject {
  const value = createEmptyProject("song-1", { revisionId: "r1", now: "2026-09-26T00:00:00.000Z", name: "Night Drive" });
  value.transport.loopEnabled = true;
  value.tracks = ["Bass", "Lead"].map((name, index) => ({
    id: `track-${index}`, name, kind: "instrument" as const, muted: index === 1, solo: false, volumeDb: 0, pan: 0,
    devices: [{ id: `d-${index}`, deviceType: "synaptix-poly-synth", deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: [{
      id: `c-${index}`, kind: "midi" as const, name, loop: false,
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 960 * 4 * 8 },
      notes: [{ id: `n-${index}`, pitch: 48 + index * 12, velocity: 100, startTick: 0, durationTicks: 960 }]
    }]
  }));
  return value;
}

const item = (id: string): PlaybackItem => ({ kind: "project", projectId: id, title: id, subtitle: "", soloTrackId: null });

test("durations follow the arrangement length and tempo", () => {
  assert.equal(projectDurationTicks(project()), 8 * 4 * 960);
  assert.equal(projectDurationSeconds(project()), 16); // 8 bars of 4/4 at 120 BPM
  assert.equal(projectDurationSeconds(migrateProjectV1ToV2(project())), 16);
  assert.equal(formatClock(75.9), "1:15");
  assert.equal(formatClock(Number.NaN), "0:00");
});

test("listening copies play through once, or loop only for repeat-one, and can solo a track", () => {
  const source = project();
  const once = listeningProject(source, null, "all");
  assert.equal(once.transport.loopEnabled, false);
  assert.equal(listeningProject(source, null, "one").transport.loopEnabled, true);
  const solo = listeningProject(source, "track-1", "off");
  assert.deepEqual(solo.tracks.map((track) => [track.solo, track.muted]), [[false, false], [true, false]]);
  assert.equal(source.transport.loopEnabled, true, "the stored project is not modified");
});

test("queue navigation handles repeat modes and restart-on-previous", () => {
  const queue = { items: [item("a"), item("b")], index: 1 };
  assert.equal(nextIndex(queue, "off"), null);
  assert.equal(nextIndex(queue, "all"), 0);
  assert.equal(nextIndex(queue, "one"), 1);
  assert.equal(nextIndex(queue, "one", true), 0, "a manual skip moves on even in repeat-one");
  assert.equal(nextIndex({ items: [], index: 0 }, "all"), null);
  assert.equal(previousIndex(queue, 10), 1);
  assert.equal(previousIndex(queue, 1), 0);
  assert.equal(previousIndex({ items: queue.items, index: 0 }, 1), 1);
  assert.notEqual(playbackItemKey(item("a")), playbackItemKey({ ...item("a"), soloTrackId: "track-1" } as PlaybackItem));
});

test("track summaries, artwork palettes, and contours are deterministic", () => {
  const v2 = migrateProjectV1ToV2(project());
  v2.tracks[0]!.devices.push({
    id: "fx", deviceType: "synaptix.reference-drive", deviceVersion: "1.0.0", enabled: true, parameters: [],
    plugin: { pluginId: "synaptix.reference-drive", vendorId: "synaptix", version: "1.0.0", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
    pluginState: null, automation: [], frozen: null
  });
  assert.deepEqual(summarizeTracks(v2).map((track) => [track.name, track.noteCount, track.instrument, track.pluginCount]), [
    ["Bass", 1, "poly synth", 1], ["Lead", 1, "poly synth", 0]
  ]);
  assert.deepEqual(artworkPalette("song-1"), artworkPalette("song-1"));
  assert.notDeepEqual(artworkPalette("song-1"), artworkPalette("song-2"));
  const contour = artworkContour(v2, 8);
  assert.equal(contour.length, 8);
  assert.ok(contour.every((value) => value >= 0.2 && value <= 1));
  assert.equal(artworkContour(null, 4).length, 4);
});

test("the studio link carries the listening position and the studio starts there on the beat", () => {
  assert.equal(studioHref("song 1"), "/studio/song%201");
  assert.equal(studioHref("song-1", 0.6), "/studio/song-1", "under a second opens at the start");
  assert.equal(studioHref("song-1", 42.36), "/studio/song-1?t=42.4");
  assert.equal(studioHref("song-1", Number.NaN), "/studio/song-1");

  const value = project();
  const bpm = value.tempoMap[0]!.bpm;
  const beatSeconds = 60 / bpm;
  // 2.5 beats in: snapped down to beat 2.
  assert.equal(studioStartTick(value, String(beatSeconds * 2.5)), 960 * 2);
  assert.equal(studioStartTick(value, "0"), null);
  assert.equal(studioStartTick(value, null), null);
  for (const bad of ["-3", "abc", "1e9", "Infinity", ""]) assert.equal(studioStartTick(value, bad), null, bad);
  // Past the end: the last beat of the arrangement.
  assert.equal(studioStartTick(value, "99999"), projectDurationTicks(value) - 960);
});

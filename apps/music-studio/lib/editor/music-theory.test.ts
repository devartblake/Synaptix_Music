import assert from "node:assert/strict";
import test from "node:test";
import { chordName, chordTimeline, detectKey, inScale, keyLabel } from "./music-theory.ts";

const note = (pitch: number, startTick = 0, durationTicks = 960) => ({ pitch, startTick, durationTicks });

test("chord names cover the common shapes, and a slash shows a bass note that isn't the root", () => {
  assert.equal(chordName([60, 64, 67]), "C");
  assert.equal(chordName([62, 65, 69]), "Dm");
  assert.equal(chordName([57, 60, 64, 67]), "Am7");
  assert.equal(chordName([55, 59, 62, 65]), "G7");
  assert.equal(chordName([60, 64, 67, 71]), "Cmaj7");
  assert.equal(chordName([59, 62, 65]), "Bdim");
  assert.equal(chordName([62, 67, 69]), "Dsus4");
  // First inversion: E in the bass of a C major triad.
  assert.equal(chordName([52, 55, 60]), "C/E");
  // Doubled notes don't change the chord; two notes or a cluster aren't named.
  assert.equal(chordName([48, 60, 64, 67, 72]), "C");
  assert.equal(chordName([60, 67]), null);
  assert.equal(chordName([60, 61, 62]), null);
});

test("the detected key is the scale holding the most note time, preferring major and minor", () => {
  // A C major scale run: C major, not A minor (same notes), because it starts and ends on C.
  const cMajor = [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, i) => note(pitch, i * 960));
  assert.equal(keyLabel(detectKey(cMajor)!), "C major");
  // The demo's Harmony clip (A, C, E, G looping) reads as A minor.
  const aMinor = [57, 60, 64, 67, 57, 60, 64, 67].map((pitch, i) => note(pitch, i * 960));
  assert.equal(keyLabel(detectKey(aMinor)!), "A minor");
  assert.equal(detectKey([]), null);
  assert.equal(inScale({ tonic: 9, mode: "minor" }, 60), true);
  assert.equal(inScale({ tonic: 9, mode: "minor" }, 61), false);
});

test("the chord lane merges repeated chords and skips stretches with no chord", () => {
  // The FM Electric Piano starter: C major for 1.5 beats, a gap, then D minor.
  const notes = [note(60, 0, 1440), note(64, 0, 1440), note(67, 0, 1440), note(62, 1920, 1440), note(65, 1920, 1440), note(69, 1920, 1440)];
  assert.deepEqual(chordTimeline(notes, 480, 3840), [
    { startTick: 0, endTick: 1440, name: "C" },
    { startTick: 1920, endTick: 3360, name: "Dm" }
  ]);
});

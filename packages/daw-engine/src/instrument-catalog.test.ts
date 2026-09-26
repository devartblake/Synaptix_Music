import assert from "node:assert/strict";
import test from "node:test";

import { TrackSchema } from "@synaptix/project-model";

import { DEVICE_PARAMETER_DEFINITIONS } from "./device-parameters.ts";
import { createInstrumentTrack, INSTRUMENT_CATALOG, resolveInstrumentDefinition } from "./instrument-catalog.ts";
import { resolveEffectiveInstrumentSettings, resolveInstrumentProfile } from "./production-audio.ts";

test("catalog device types are unique and each resolves to its own profile", () => {
  const types = INSTRUMENT_CATALOG.map((entry) => entry.deviceType);
  assert.equal(new Set(types).size, types.length);
  for (const entry of INSTRUMENT_CATALOG) {
    assert.equal(resolveInstrumentDefinition(entry.deviceType, "Untitled").deviceType, entry.deviceType);
  }
});

test("catalog profile defaults sit inside the device parameter slider ranges", () => {
  const range = (id: string) => DEVICE_PARAMETER_DEFINITIONS.find((definition) => definition.id === id)!;
  const checks = { filterFrequency: "filterFrequency", attack: "envelopeAttack", decay: "envelopeDecay",
    sustain: "envelopeSustain", release: "envelopeRelease", reverbSend: "reverbSend" } as const;
  for (const entry of INSTRUMENT_CATALOG) {
    for (const [key, id] of Object.entries(checks)) {
      const value = entry.profile[key as keyof typeof checks];
      const { minimum, maximum } = range(id);
      assert.ok(value >= minimum && value <= maximum, `${entry.deviceType} ${key}=${value} outside ${minimum}..${maximum}`);
    }
  }
});

test("specific keywords win over the ones they contain", () => {
  assert.equal(resolveInstrumentDefinition("synaptix-sub-bass", "").profile.kind, "sub-bass");
  assert.equal(resolveInstrumentDefinition("synaptix-bass-synth", "").profile.kind, "bass");
});

test("an explicit device type wins over the track name, a generic one defers to it", () => {
  assert.equal(resolveInstrumentDefinition("synaptix-strings", "Lead Melody").profile.kind, "strings");
  assert.equal(resolveInstrumentDefinition("synaptix-poly-synth", "Bass").profile.kind, "bass");
  assert.equal(resolveInstrumentDefinition("synaptix-poly-synth", "Harmony").profile.kind, "poly");
  assert.equal(resolveInstrumentDefinition("", "Rhodes Keys").profile.kind, "keys");
});

test("new instrument tracks are valid, audible, and carry a starter phrase", () => {
  for (const entry of INSTRUMENT_CATALOG) {
    const track = createInstrumentTrack(entry.deviceType, { id: "t", bars: 2 });
    assert.doesNotThrow(() => TrackSchema.parse(track), entry.deviceType);
    assert.equal(resolveInstrumentProfile(track).kind, entry.profile.kind);
    const clip = track.clips[0];
    assert.ok(clip?.kind === "midi" && clip.notes.length === entry.starterPattern.length * 2);
    assert.ok(clip.notes.every((note) => note.startTick + note.durationTicks <= clip.range.durationTicks));
  }
});

test("pads default to a wetter reverb send than drums", () => {
  const pad = resolveEffectiveInstrumentSettings(createInstrumentTrack("synaptix-pad", { id: "p" }));
  const drums = resolveEffectiveInstrumentSettings(createInstrumentTrack("synaptix-drum-synth", { id: "d" }));
  assert.ok(pad.reverbSend > drums.reverbSend);
  assert.equal(drums.destinationBus, "drums");
});

test("unknown instruments are rejected", () => {
  assert.throws(() => createInstrumentTrack("synaptix-theremin"), /Unknown instrument/);
});

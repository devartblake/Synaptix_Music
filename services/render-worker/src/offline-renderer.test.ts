import assert from "node:assert/strict";
import test from "node:test";

import { createInstrumentTrack, INSTRUMENT_CATALOG } from "@synaptix/daw-engine";
import { createEmptyProject, defaultMixer, type MusicProject, type Track } from "@synaptix/project-model";
import {
  RenderResultSchema,
  RENDER_CONTRACT_VERSION,
  type RenderManifest
} from "@synaptix/render-contracts";

import { renderProjectOffline } from "./offline-renderer.ts";

const PPQ = 960;

function noteTrack(
  id: string,
  name: string,
  deviceType: string,
  overrides: Partial<Track> = {}
): Track {
  return {
    id,
    name,
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: 0,
    pan: 0,
    devices: [
      { id: `${id}-device`, deviceType, deviceVersion: "1.0.0", enabled: true, parameters: [] }
    ],
    clips: [
      {
        id: `${id}-clip`,
        kind: "midi",
        name: `${name} clip`,
        range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * 4 },
        loop: false,
        notes: [{ id: `${id}-note`, pitch: 60, velocity: 100, startTick: 0, durationTicks: PPQ }]
      }
    ],
    ...overrides
  };
}

function project(tracks: Track[]): MusicProject {
  const value = createEmptyProject("project-a", { revisionId: "revision-a" });
  value.tracks = tracks;
  return value;
}

function manifest(overrides: Partial<RenderManifest> = {}): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId: "10000000-0000-4000-8000-000000000000",
    projectId: "project-a",
    revisionId: "revision-a",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: "1.0.0",
    seed: 1,
    scope: { kind: "master" },
    range: { startTick: 0, endTick: PPQ * 4 },
    output: {
      format: "wav",
      sampleRate: 44100,
      bitDepth: 16,
      normalizePeakDbfs: null,
      includeTailSeconds: 0.1
    },
    requestedAt: "2026-08-15T00:00:00.000Z",
    ...overrides
  };
}

function readLeftSample(bytes: Buffer, frame: number): number {
  return bytes.readInt16LE(44 + frame * 4);
}

test("rendering the same project and manifest twice is byte-identical", () => {
  const outcomeA = renderProjectOffline(
    project([noteTrack("track-1", "Lead", "synaptix-lead-synth")]),
    manifest()
  );
  const outcomeB = renderProjectOffline(
    project([noteTrack("track-1", "Lead", "synaptix-lead-synth")]),
    manifest()
  );
  assert.equal(
    outcomeA.artifacts[0]?.metadata.checksumSha256,
    outcomeB.artifacts[0]?.metadata.checksumSha256
  );
  assert.ok(outcomeA.artifacts[0]!.bytes.equals(outcomeB.artifacts[0]!.bytes));
});

test("master rendering applies the canonical reverb-send parameter", () => {
  const dryTrack = noteTrack("track-1", "Lead", "synaptix-lead-synth");
  dryTrack.devices[0]!.parameters = [{ id: "reverbSend", value: 0 }];
  const wetTrack = noteTrack("track-1", "Lead", "synaptix-lead-synth");
  wetTrack.devices[0]!.parameters = [{ id: "reverbSend", value: 1 }];

  const dry = renderProjectOffline(project([dryTrack]), manifest());
  const wet = renderProjectOffline(project([wetTrack]), manifest());
  assert.notEqual(
    dry.artifacts[0]?.metadata.checksumSha256,
    wet.artifacts[0]?.metadata.checksumSha256
  );
});

test("stem rendering stays dry and independent of master effects", () => {
  const dryTrack = noteTrack("track-1", "Lead", "synaptix-lead-synth");
  dryTrack.devices[0]!.parameters = [{ id: "reverbSend", value: 0 }];
  const wetTrack = noteTrack("track-1", "Lead", "synaptix-lead-synth");
  wetTrack.devices[0]!.parameters = [{ id: "reverbSend", value: 1 }];
  const stemManifest = manifest({ scope: { kind: "stems", trackIds: ["track-1"] } });

  const dry = renderProjectOffline(project([dryTrack]), stemManifest);
  const wet = renderProjectOffline(project([wetTrack]), stemManifest);
  assert.ok(dry.artifacts[0]!.bytes.equals(wet.artifacts[0]!.bytes));
});

test("produces a valid RenderResult with one master artifact", () => {
  const outcome = renderProjectOffline(
    project([noteTrack("track-1", "Lead", "synaptix-lead-synth")]),
    manifest()
  );
  assert.doesNotThrow(() => RenderResultSchema.parse(outcome.result));
  assert.equal(outcome.result.status, "completed");
  assert.equal(outcome.artifacts.length, 1);
  assert.equal(outcome.artifacts[0]?.metadata.trackId, null);
  assert.equal(outcome.artifacts[0]?.metadata.fileName, "master.wav");
});

test("artifact metadata matches the encoded bytes", () => {
  const outcome = renderProjectOffline(
    project([noteTrack("track-1", "Lead", "synaptix-lead-synth")]),
    manifest()
  );
  const artifact = outcome.artifacts[0]!;
  assert.equal(artifact.metadata.byteLength, artifact.bytes.length);
  const expectedDuration = ((PPQ * 4) / PPQ) * (60 / 120) + 0.1;
  assert.ok(Math.abs(artifact.metadata.durationSeconds - expectedDuration) < 0.01);
});

test("a note produces silence before its onset and signal during sustain", () => {
  const halfBarTicks = PPQ * 2;
  const outcome = renderProjectOffline(
    project([
      noteTrack("track-1", "Lead", "synaptix-lead-synth", {
        clips: [
          {
            id: "clip-1",
            kind: "midi",
            name: "clip",
            loop: false,
            range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * 4 },
            notes: [
              {
                id: "note-1",
                pitch: 69,
                velocity: 127,
                startTick: halfBarTicks,
                durationTicks: PPQ
              }
            ]
          }
        ]
      })
    ]),
    manifest()
  );
  const bytes = outcome.artifacts[0]!.bytes;
  const sampleRate = 44100;
  const noteStartSeconds = (halfBarTicks / PPQ) * (60 / 120);
  const beforeFrame = Math.round((noteStartSeconds - 0.02) * sampleRate);
  const duringFrame = Math.round((noteStartSeconds + 0.05) * sampleRate);

  assert.equal(readLeftSample(bytes, beforeFrame), 0, "silent before the note starts");
  assert.notEqual(readLeftSample(bytes, duringFrame), 0, "audible during the note's sustain");
});

test("a muted track is silent in the master mix", () => {
  const outcome = renderProjectOffline(
    project([noteTrack("track-1", "Lead", "synaptix-lead-synth", { muted: true })]),
    manifest()
  );
  const bytes = outcome.artifacts[0]!.bytes;
  for (let frame = 0; frame < (bytes.length - 44) / 4; frame++) {
    assert.equal(readLeftSample(bytes, frame), 0);
  }
});

test("soloing one track silences the others in the master mix", () => {
  const outcome = renderProjectOffline(
    project([
      noteTrack("track-1", "Lead", "synaptix-lead-synth", { solo: true }),
      noteTrack("track-2", "Bass", "synaptix-bass-synth", { pan: 0 })
    ]),
    manifest()
  );
  // Both tracks would otherwise sound identical notes; confirm the mix is not silent
  // (soloed track audible) and matches a solo-only render (non-soloed track excluded).
  const soloOnly = renderProjectOffline(
    project([noteTrack("track-1", "Lead", "synaptix-lead-synth", { solo: true })]),
    manifest()
  );
  assert.ok(outcome.artifacts[0]!.bytes.equals(soloOnly.artifacts[0]!.bytes));
});

test("notes starting outside the render range are excluded", () => {
  const outcome = renderProjectOffline(
    project([
      noteTrack("track-1", "Lead", "synaptix-lead-synth", {
        clips: [
          {
            id: "clip-1",
            kind: "midi",
            name: "clip",
            loop: false,
            range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * 8 },
            notes: [
              { id: "note-1", pitch: 60, velocity: 100, startTick: PPQ * 6, durationTicks: PPQ }
            ]
          }
        ]
      })
    ]),
    manifest({ range: { startTick: 0, endTick: PPQ * 4 } })
  );
  const bytes = outcome.artifacts[0]!.bytes;
  for (let frame = 0; frame < (bytes.length - 44) / 4; frame++) {
    assert.equal(readLeftSample(bytes, frame), 0);
  }
});

test("stems scope renders one artifact per requested track and ignores mute", () => {
  const outcome = renderProjectOffline(
    project([
      noteTrack("track-1", "Lead", "synaptix-lead-synth", { muted: true }),
      noteTrack("track-2", "Bass", "synaptix-bass-synth")
    ]),
    manifest({ scope: { kind: "stems", trackIds: ["track-1"] } })
  );
  assert.equal(outcome.artifacts.length, 1);
  assert.equal(outcome.artifacts[0]?.metadata.trackId, "track-1");
  assert.equal(outcome.artifacts[0]?.metadata.fileName, "lead.wav");

  const bytes = outcome.artifacts[0]!.bytes;
  const hasSignal = Array.from({ length: (bytes.length - 44) / 4 }, (_, frame) =>
    readLeftSample(bytes, frame)
  ).some((value) => value !== 0);
  assert.ok(hasSignal, "muted track is still rendered as a stem");
});

test("stem filenames are slugified and trimmed safely", () => {
  const outcome = renderProjectOffline(
    project([noteTrack("track-1", "---Lead   Track---", "synaptix-lead-synth")]),
    manifest({ scope: { kind: "stems", trackIds: ["track-1"] } })
  );
  assert.equal(outcome.artifacts[0]?.metadata.fileName, "lead-track.wav");

  const fallback = renderProjectOffline(
    project([noteTrack("track-2", "---###---", "synaptix-bass-synth")]),
    manifest({ scope: { kind: "stems", trackIds: ["track-2"] } })
  );
  assert.equal(fallback.artifacts[0]?.metadata.fileName, "track.wav");
});

test("requesting an unknown stem track fails closed", () => {
  assert.throws(
    () =>
      renderProjectOffline(
        project([noteTrack("track-1", "Lead", "synaptix-lead-synth")]),
        manifest({
          scope: { kind: "stems", trackIds: ["missing-track"] }
        })
      ),
    /was not found/
  );
});

test("a projectId or revisionId mismatch between the manifest and project fails closed", () => {
  assert.throws(
    () => renderProjectOffline(project([]), manifest({ projectId: "different-project" })),
    /does not match project/
  );
  assert.throws(
    () => renderProjectOffline(project([]), manifest({ revisionId: "different-revision" })),
    /does not match project revision/
  );
});

test("normalization scales the output to the requested peak level", () => {
  const outcome = renderProjectOffline(
    project([noteTrack("track-1", "Lead", "synaptix-lead-synth", { volumeDb: -24 })]),
    manifest({
      output: {
        format: "wav",
        sampleRate: 44100,
        bitDepth: 16,
        normalizePeakDbfs: -1,
        includeTailSeconds: 0.1
      }
    })
  );
  const bytes = outcome.artifacts[0]!.bytes;
  let peak = 0;
  for (let frame = 0; frame < (bytes.length - 44) / 4; frame++)
    peak = Math.max(peak, Math.abs(readLeftSample(bytes, frame)));
  const expectedPeak = 10 ** (-1 / 20) * 32767;
  assert.ok(
    Math.abs(peak - expectedPeak) / expectedPeak < 0.02,
    `peak ${peak} should be close to ${expectedPeak}`
  );
});

test("frequency drone devices render signal in master and stems", () => {
  const drone = noteTrack("drone-1", "Frequency Drone", "synaptix-frequency-drone", { clips: [] });
  drone.devices[0]!.parameters = [
    { id: "droneFrequencyHz", value: 528 }, { id: "droneGain", value: 0.12 },
    { id: "droneHarmonics", value: 3 }, { id: "droneModulationRateHz", value: 0.2 },
    { id: "droneModulationDepth", value: 0.1 }, { id: "droneFilterHz", value: 12000 },
    { id: "droneStereoOffsetHz", value: 0 }
  ];
  const master = renderProjectOffline(project([drone]), manifest());
  const stem = renderProjectOffline(project([drone]), manifest({ scope: { kind: "stems", trackIds: ["drone-1"] } }));
  const hasSignal = (bytes: Buffer) => Array.from({length:(bytes.length-44)/4},(_,frame)=>readLeftSample(bytes,frame)).some(value=>value!==0);
  assert.ok(hasSignal(master.artifacts[0]!.bytes));
  assert.ok(hasSignal(stem.artifacts[0]!.bytes));
  assert.equal(stem.artifacts[0]?.metadata.trackId, "drone-1");
});

test("muted frequency drone is silent in master but explicit stem remains audible", () => {
  const drone = noteTrack("drone-1", "Frequency Drone", "synaptix-frequency-drone", { clips: [], muted: true });
  drone.devices[0]!.parameters = [{ id: "droneFrequencyHz", value: 396 }, { id: "droneGain", value: 0.1 }];
  const master = renderProjectOffline(project([drone]), manifest());
  const stem = renderProjectOffline(project([drone]), manifest({ scope: { kind: "stems", trackIds: ["drone-1"] } }));
  const masterSignal = Array.from({length:(master.artifacts[0]!.bytes.length-44)/4},(_,frame)=>readLeftSample(master.artifacts[0]!.bytes,frame)).some(value=>value!==0);
  const stemSignal = Array.from({length:(stem.artifacts[0]!.bytes.length-44)/4},(_,frame)=>readLeftSample(stem.artifacts[0]!.bytes,frame)).some(value=>value!==0);
  assert.equal(masterSignal,false); assert.equal(stemSignal,true);
});


test("master rendering respects bus routing, return mute, and post-compressor master gain", () => {
  const value = project([noteTrack("track-1", "Bass", "synaptix-poly-synth", { reverbSend: 0 })]);
  const render = () => renderProjectOffline(value, manifest()).artifacts[0]!.bytes;
  const peak = (bytes: Buffer) => {
    let max = 0;
    for (let offset = 44; offset < bytes.length; offset += 2) max = Math.max(max, Math.abs(bytes.readInt16LE(offset)));
    return max;
  };
  const original = render();
  value.mixer = defaultMixer();
  assert.deepEqual(render(), original);
  value.mixer.music.muted = true;
  assert.equal(peak(render()), 0);
  value.tracks[0]!.outputBusId = "drums";
  assert.ok(peak(render()) > 0);
  value.mixer.drums.muted = true;
  assert.equal(peak(render()), 0);
  value.tracks[0]!.outputBusId = "master";
  const full = peak(render());
  value.mixer.master.volumeDb = -6;
  assert.ok(Math.abs(peak(render()) / full - 10 ** (-6 / 20)) < 0.002);
  value.mixer.master.muted = true;
  assert.equal(peak(render()), 0);
  value.mixer.master.muted = false;
  value.tracks[0]!.outputBusId = "music";
  value.tracks[0]!.reverbSend = 1;
  assert.ok(peak(render()) > 0, "post-track send bypasses a muted dry bus");
  value.mixer.reverb.muted = true;
  assert.equal(peak(render()), 0);
  const stem = renderProjectOffline(value, manifest({ scope: { kind: "stems", trackIds: ["track-1"] } })).artifacts[0]!.bytes;
  assert.ok(peak(stem) > 0, "isolated stems exclude bus and master controls");
});

test("the modulation controls reach the export, and zero depths render exactly as before", () => {
  const render = (parameters: { id: string; value: number }[]) => {
    const track = noteTrack("track-1", "Lead", "synaptix-lead-synth");
    track.devices[0]!.parameters = parameters;
    return renderProjectOffline(project([track]), manifest()).artifacts[0]!.metadata.checksumSha256;
  };
  const plain = render([]);
  // A rate with no depth is no modulation.
  assert.equal(render([{ id: "lfoRate", value: 7 }]), plain);
  for (const id of ["vibratoCents", "lfoCutoffOctaves", "tremolo", "filterEnvOctaves"]) {
    assert.notEqual(render([{ id, value: id === "vibratoCents" ? 40 : 0.8 }]), plain, id);
  }
});

test("the Resonance control reaches the export, and 0 renders exactly as before", () => {
  const withResonance = (value: number | null) => {
    const track = noteTrack("track-1", "Lead", "synaptix-lead-synth");
    if (value !== null) track.devices[0]!.parameters = [{ id: "filterResonance", value }];
    return renderProjectOffline(project([track]), manifest()).artifacts[0]!.metadata.checksumSha256;
  };
  assert.equal(withResonance(0), withResonance(null), "resonance 0 is the original one-pole filter");
  assert.notEqual(withResonance(0.8), withResonance(null));
});

// Golden output. Renders are artifacts players hear and packages are verified by checksum, so a
// speed-up (or a future WASM synthesis kernel) must not change a single sample. One track per
// catalog instrument covers every oscillator and envelope shape. If this fails, the audio changed:
// only update the expected values for an intended sound change, and say so in the changelog.
// Intended changes so far: band-limited (PolyBLEP) saw and square in the Rust kernel changed the
// six saw/square instruments; Supersaw Lead, Unison Pad, Plucked String,
// FM Bell, FM Electric Piano, Drum Kit, 808 Bass and Chiptune Lead were added.
// Stereo voice path: Supersaw Lead and Unison Pad now spread their saws across the stereo field.
// Modulation system: Acid Bass and Motion Pad were added.
const GOLDEN_STEMS: Record<string, string> = {
  "synaptix-drum-synth": "e2b2ffcb44e2e51794045fba4f3702e914b87016a27e784a6f6d379adc173327",
  "synaptix-sub-bass": "a3e24dc2dc0916b38d1a258b9d9ab3cf4bad014ea1e77b586ce0a37ed3bdeeb0",
  "synaptix-bass-synth": "a5ad3391b6240290c5c81660c8704d491feb27328af414a0a5a6c1a98f69eecb",
  "synaptix-lead-synth": "bd7d15d2537e8b740b9cded003cf42ab79f355cf4e2933f42016e3134ca80f00",
  "synaptix-pad": "72472e0ab45a77bb2ecbeffb501a53115512cfea2addef0c797be12e8214c72d",
  "synaptix-pluck": "f25416e9aa1b838810f8acdb3a8d5e9e30762808ef8ceec17e4c2be01af8b1bf",
  "synaptix-electric-piano": "e4e94622747d67d1a7738c23bb0452bf13eb6dcc95ed8aaf8665a7fa1d9b12e7",
  "synaptix-organ": "2c40c332980cedc42c4190741044244a9f1d7565957a7082a3f5c4164ce5ed21",
  "synaptix-strings": "8acecfb7f56a6b698454427c9ad311dafe4d053775561362a574028753f62098",
  "synaptix-brass": "48df5c86f7a86eba1553f971124eddda5a3ab46c83c76b561bd770106b49350b",
  "synaptix-bell": "d59fe591221738c0dc4208213f07e062332976fe01e421d32f61f865777bd748",
  "synaptix-poly-synth": "6961e425915149f4c87df542c8e13e3574de198603c905dc9dc0d962cc9b9a58",
  "synaptix-supersaw": "94e8cfcbf80454fb74f4dbd4b2c95bbcb13213443c926fb93b5dacecac490b79",
  "synaptix-unison": "aeb14fa9508df2654eafee89d0ac17a2301865d6c97b5826fc20e317509dcdac",
  "synaptix-guitar": "ae489fee1eb8737c62a2928eb40d1a3085bdb3b27797be4bce4b34b48137a8c8",
  "synaptix-fm-glass": "7a0b9b7eb136c82e815f53ee428e96242627419998e87bd2108907bf664bf958",
  "synaptix-fm-ep": "12c06005b9ccd593f7784ef1ea501853b3755c2553f800e19ab96e9524404b0a",
  "synaptix-beat-kit": "e4fbd3f7eba650803560ebded6013010bcdf33bb6fe333ec9fd090de6197f97f",
  "synaptix-boom": "618144ad6a9ce1fd7d3288db961c04f8739ae167cb2ea1c4ee0fa5f953c2e334",
  "synaptix-chiptune": "20b4876bdef0721c97d42d5bb1c6007fdfd68a5ec07b9a07013c34fd843bf4ef",
  "synaptix-squelch": "9176405664aebe5aa5ff6f70d4e3b86a39e9e606e4367d56260df4462abfd4e0",
  "synaptix-motion": "ac0d6355f7a49eba7c4ee120929909e67e607aa6784e3ad76292d4661a0be5dd"
};
const GOLDEN_MASTER = "b13bd34d0774f932163d8eaa14c3b7dccfd3f8e2e5937036c38ed7c2dd82df5b";
test("every catalog instrument renders the same bytes as before (golden checksums)", () => {
  const value = createEmptyProject("golden", { revisionId: "golden-r1" });
  value.tracks = INSTRUMENT_CATALOG.map((entry, index) => {
    const instrument = createInstrumentTrack(entry.deviceType, { id: `golden-${index}` });
    instrument.clips = [
      {
        id: `golden-clip-${index}`,
        kind: "midi",
        name: entry.label,
        range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * 8 },
        loop: false,
        notes: [0, 1, 2, 3, 4, 5].map((n) => ({
          id: `golden-${index}-${n}`,
          pitch: 40 + index * 2 + n * 3,
          velocity: 60 + n * 10,
          startTick: n * PPQ + index * 11,
          durationTicks: PPQ / 2 + n * 40
        }))
      }
    ];
    return instrument;
  });
  const golden = (scope: RenderManifest["scope"]) =>
    manifest({
      projectId: "golden",
      revisionId: "golden-r1",
      scope,
      range: { startTick: 0, endTick: PPQ * 8 },
      output: { format: "wav", sampleRate: 48000, bitDepth: 24, normalizePeakDbfs: null, includeTailSeconds: 2 }
    });

  const master = renderProjectOffline(value, golden({ kind: "master" }));
  const stems = renderProjectOffline(value, golden({ kind: "stems", trackIds: value.tracks.map((t) => t.id) }));
  // Stems are pinned per instrument, so a change shows which instruments it touched, and adding
  // an instrument (appended to the catalog) leaves the others' entries alone.
  const stemChecksums = Object.fromEntries(
    INSTRUMENT_CATALOG.map((entry, index) => [entry.deviceType, stems.artifacts[index]!.metadata.checksumSha256])
  );

  assert.deepEqual(stemChecksums, GOLDEN_STEMS);
  assert.equal(master.artifacts[0]!.metadata.checksumSha256, GOLDEN_MASTER);
});

// The catalog golden project plays each instrument at rising pitches, which on the Drum Kit are
// all toms. This pins one hit of every drum on the General MIDI map.
test("every Drum Kit piece renders the same bytes as before (golden checksum)", () => {
  const value = createEmptyProject("golden-kit", { revisionId: "golden-kit-r1" });
  const kit = createInstrumentTrack("synaptix-beat-kit", { id: "golden-kit" });
  // kick, rim, snare, clap, closed hat, open hat, crash, ride, tom
  const pieces = [36, 37, 38, 39, 42, 46, 49, 51, 45];
  kit.clips = [
    {
      id: "golden-kit-clip",
      kind: "midi",
      name: "Every drum",
      range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: PPQ * pieces.length },
      loop: false,
      notes: pieces.map((pitch, n) => ({
        id: `golden-kit-${pitch}`,
        pitch,
        velocity: 100,
        startTick: n * PPQ,
        durationTicks: PPQ / 2
      }))
    }
  ];
  value.tracks = [kit];
  const stem = renderProjectOffline(
    value,
    manifest({
      projectId: "golden-kit",
      revisionId: "golden-kit-r1",
      scope: { kind: "stems", trackIds: [kit.id] },
      range: { startTick: 0, endTick: PPQ * pieces.length },
      output: { format: "wav", sampleRate: 48000, bitDepth: 24, normalizePeakDbfs: null, includeTailSeconds: 2 }
    })
  );

  assert.equal(stem.artifacts[0]!.metadata.checksumSha256, "2686043118c1d10bed74ae40fd7a21095a5fbb02fa4881b31b0d6024491f9be8");
});

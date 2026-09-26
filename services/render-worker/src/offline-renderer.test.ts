import assert from "node:assert/strict";
import test from "node:test";

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

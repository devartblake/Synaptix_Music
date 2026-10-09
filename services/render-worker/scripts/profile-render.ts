/**
 * DSP profiling for the offline renderer (Stage 12, step 9).
 *
 * Rust/WASM is deferred until profiling shows a material bottleneck in a DSP kernel
 * (roadmap section 8). This renders synthetic projects that are heavier than typical
 * studio projects and reports wall time and the real-time factor (seconds of audio
 * rendered per second of CPU), for whole renders and for each exported kernel.
 *
 *   npm run profile -w @synaptix/render-worker            # every scenario
 *   npm run profile -w @synaptix/render-worker -- dense   # scenarios whose name contains "dense"
 *   node --experimental-transform-types --cpu-prof --cpu-prof-dir=/tmp/render-prof \
 *     services/render-worker/scripts/profile-render.ts dense  # per-function self time
 *
 * Results and the decision they support: docs/development/dsp-profiling.md.
 */
import { performance } from "node:perf_hooks";

import { createEmptyProject, type MusicProject, type Track } from "@synaptix/project-model";
import { RENDER_CONTRACT_VERSION, type RenderManifest } from "@synaptix/render-contracts";

import { applyCompressor } from "../src/compressor.ts";
import { renderProjectOffline } from "../src/offline-renderer.ts";
import { applyReverb } from "../src/reverb.ts";
import { encodeWav } from "../src/wav-encoder.ts";

const PPQ = 960;
const BPM = 120;
const SAMPLE_RATE = 48_000;
const SYNTHS = ["synaptix-lead-synth", "synaptix-poly-synth", "synaptix-bass-synth"] as const;

interface Scenario {
  name: string;
  tracks: number;
  bars: number;
  /** Notes started per beat on each track; chords count each voice. */
  notesPerBeat: number;
}

const SCENARIOS: Scenario[] = [
  { name: "typical: 8 tracks, 32 bars", tracks: 8, bars: 32, notesPerBeat: 2 },
  { name: "dense: 16 tracks, 64 bars", tracks: 16, bars: 64, notesPerBeat: 4 },
  { name: "worst case: 32 tracks, 64 bars", tracks: 32, bars: 64, notesPerBeat: 8 }
];

function track(index: number, bars: number, notesPerBeat: number): Track {
  const beats = bars * 4;
  const step = PPQ / notesPerBeat;
  const notes = [];
  for (let n = 0; n < beats * notesPerBeat; n++) {
    notes.push({
      id: `t${index}-n${n}`,
      pitch: 36 + ((index * 7 + n * 5) % 48),
      velocity: 70 + (n % 50),
      startTick: n * step,
      // Overlapping notes so voices stack the way chords and pads do.
      durationTicks: step * 3
    });
  }
  return {
    id: `track-${index}`,
    name: `Track ${index}`,
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: -6,
    pan: ((index % 5) - 2) / 4,
    reverbSend: 0.25,
    devices: [
      {
        id: `track-${index}-device`,
        deviceType: SYNTHS[index % SYNTHS.length]!,
        deviceVersion: "1.0.0",
        enabled: true,
        parameters: []
      }
    ],
    clips: [
      {
        id: `track-${index}-clip`,
        kind: "midi",
        name: "clip",
        range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: beats * PPQ },
        loop: false,
        notes
      }
    ]
  } as Track;
}

function project(scenario: Scenario): MusicProject {
  const value = createEmptyProject("profile-project", { revisionId: "profile-revision" });
  value.tracks = Array.from({ length: scenario.tracks }, (_, i) =>
    track(i, scenario.bars, scenario.notesPerBeat)
  );
  return value;
}

function manifest(scenario: Scenario, scope: RenderManifest["scope"]): RenderManifest {
  return {
    contractVersion: RENDER_CONTRACT_VERSION,
    renderId: "10000000-0000-4000-8000-000000000000",
    projectId: "profile-project",
    revisionId: "profile-revision",
    projectChecksumSha256: "a".repeat(64),
    engineVersion: "1.0.0",
    seed: 1,
    scope,
    range: { startTick: 0, endTick: scenario.bars * 4 * PPQ },
    output: {
      format: "wav",
      sampleRate: SAMPLE_RATE,
      bitDepth: 24,
      normalizePeakDbfs: null,
      includeTailSeconds: 2
    },
    requestedAt: "2026-10-09T00:00:00.000Z"
  };
}

function time<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

function row(label: string, audioSeconds: number, ms: number): string {
  const rtf = audioSeconds / (ms / 1000);
  return `  ${label.padEnd(34)} ${ms.toFixed(0).padStart(7)} ms   ${rtf.toFixed(1).padStart(7)}x real time`;
}

function noise(samples: number): { left: Float64Array; right: Float64Array } {
  let seed = 1;
  const next = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const left = new Float64Array(samples);
  const right = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    left[i] = next() * 0.5;
    right[i] = next() * 0.5;
  }
  return { left, right };
}

const filter = process.argv[2];
console.log(`Node ${process.version}, ${SAMPLE_RATE} Hz, 24-bit WAV\n`);
for (const scenario of SCENARIOS.filter((s) => !filter || s.name.includes(filter))) {
  const value = project(scenario);
  const audioSeconds = (scenario.bars * 4 * 60) / BPM + 2;
  const notes = scenario.tracks * scenario.bars * 4 * scenario.notesPerBeat;
  console.log(`${scenario.name}: ${audioSeconds.toFixed(0)} s of audio, ${notes} notes`);

  // Warm-up so the JIT has optimized the hot loops before timing.
  renderProjectOffline(value, manifest({ ...scenario, bars: 2 }, { kind: "master" }));

  const master = time(() => renderProjectOffline(value, manifest(scenario, { kind: "master" })));
  console.log(row("master render (synth+mix+fx+wav)", audioSeconds, master.ms));
  const stems = time(() =>
    renderProjectOffline(
      value,
      manifest(scenario, { kind: "stems", trackIds: value.tracks.map((t) => t.id) })
    )
  );
  console.log(row(`stems render (${scenario.tracks} WAVs)`, audioSeconds, stems.ms));

  const samples = Math.round(audioSeconds * SAMPLE_RATE);
  const input = noise(samples);
  console.log(
    row("  reverb (master send)", audioSeconds, time(() => applyReverb(input, 1.8, SAMPLE_RATE)).ms)
  );
  const compressor = { thresholdDb: -10, ratio: 3, attackSeconds: 0.01, releaseSeconds: 0.15 };
  console.log(
    row(
      "  compressor (master)",
      audioSeconds,
      time(() => applyCompressor(input, compressor, SAMPLE_RATE)).ms
    )
  );
  console.log(
    row("  WAV encode (24-bit)", audioSeconds, time(() => encodeWav(input, SAMPLE_RATE, 24)).ms)
  );
  const heapMb = process.memoryUsage().heapUsed / 2 ** 20;
  console.log(`  heap after scenario: ${heapMb.toFixed(0)} MB\n`);
}

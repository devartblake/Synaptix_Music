import assert from "node:assert/strict";
import test from "node:test";

import { type KernelOscillator, type VoiceParams } from "./index.ts";
import { createNodeDspKernel } from "./node.ts";

/**
 * The kernel must make exactly the samples this plain TypeScript does: that is what lets the
 * studio preview and the render worker share it, and it proves the WebAssembly arithmetic is
 * the same IEEE-754 arithmetic as JavaScript's. Only sines differ (the kernel's own
 * polynomial instead of Math.sin, so every platform agrees), by at most a rounding step.
 */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

// Must match the constants in crates/dsp/src/voice.rs.
const SUPERSAW_RATIOS = [0.989, 0.9937, 0.998, 1.0, 1.002, 1.0063, 1.011];
const SUPERSAW_PHASES = [0.37, 0.71, 0.13, 0.0, 0.53, 0.89, 0.29];
const SUPERSAW_LEVELS = [0.6, 0.6, 0.6, 1.0, 0.6, 0.6, 0.6];
const SUPERSAW_GAIN = 0.405;

const softClip = (x: number) => x / (1 + Math.abs(x));

// crates/dsp FM_BELL and FM_PIANO.
const FM = {
  "fm-bell": { ratio: 3.5, start: 5, end: 0.5, fall: 4 },
  "fm-piano": { ratio: 1, start: 2.5, end: 0.3, fall: 12 }
} as const;
const FRAC_1_2PI = 0.15915494309189535;

// crates/dsp PluckedString, step for step.
function referenceString(frequency: number, sampleRate: number, seed: number): () => number {
  const period = sampleRate / frequency;
  const whole = Math.max(1, Math.floor(period - 0.6));
  const fraction = period - 0.5 - whole;
  let state = seed === 0 ? 0x9e3779b9 : seed >>> 0;
  const line = Array.from({ length: whole }, () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state / 2_147_483_648 - 1;
  });
  let sum = 0;
  for (const sample of line) sum += sample;
  const mean = sum / whole;
  for (let i = 0; i < whole; i++) line[i]! -= mean;
  const allpass = (1 - fraction) / (1 + fraction);
  let position = 0;
  let previous = 0;
  let allpassInput = 0;
  let allpassOutput = 0;
  return () => {
    const out = line[position]!;
    const average = 0.5 * (out + previous);
    previous = out;
    const tuned = allpass * average + allpassInput - allpass * allpassOutput;
    allpassInput = average;
    allpassOutput = tuned;
    line[position] = tuned * 0.996;
    position = (position + 1) % whole;
    return out;
  };
}

function worstDifference(actual: Float64Array, expected: Float64Array): number {
  return actual.reduce((max, s, i) => Math.max(max, Math.abs(s - expected[i]!)), 0);
}

const SUPERSAW_PANS = [-0.8, 0.53, -0.27, 0.0, 0.27, -0.53, 0.8];

function referenceVoice(
  out: { left: Float64Array; right: Float64Array },
  p: VoiceParams,
  noteStart: number,
  noteTotal: number
): void {
  const first = Math.max(0, -noteStart);
  const end = Math.min(noteTotal, out.left.length - noteStart);
  // Equal-power pan per saw, ×√2 so a centred saw is at full level on both sides.
  const panLeft = SUPERSAW_PANS.map((pan) => Math.SQRT2 * Math.cos(((pan + 1) * Math.PI) / 4));
  const panRight = SUPERSAW_PANS.map((pan) => Math.SQRT2 * Math.sin(((pan + 1) * Math.PI) / 4));
  let rawRight = 0;
  let filteredRight = 0;
  let icRight1 = 0;
  let icRight2 = 0;
  const dt = p.frequency / p.sampleRate;
  const supersawFrequencies = SUPERSAW_RATIOS.map((ratio) => p.frequency * ratio);
  const supersawDts = supersawFrequencies.map((frequency) => frequency / p.sampleRate);
  const string = referenceString(p.frequency, p.sampleRate, p.seed);
  let sweepPhase = 0;
  let filtered = 0;
  // crates/dsp ResonantLowPass, with Math.sin / Math.cos for tan.
  const angle = Math.PI * Math.min(Math.max(p.cutoff / p.sampleRate, 0), 0.49);
  const g = Math.sin(angle) / Math.cos(angle);
  const k = 2 - 1.9 * Math.min(Math.max(p.resonance, 0), 1);
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  let ic1 = 0;
  let ic2 = 0;
  for (let i = first; i < end; i++) {
    const time = i / p.sampleRate;
    const phase = time * p.frequency;
    const cycle = phase - Math.floor(phase);
    let raw: number;
    if (p.oscillator === "808-bass") {
      raw =
        softClip(Math.sin(2 * Math.PI * (sweepPhase - Math.floor(sweepPhase))) * 2.2) /
        softClip(2.2);
      sweepPhase += (p.frequency * (1 + 1.5 / (1 + time * 35))) / p.sampleRate;
    } else if (p.oscillator === "fm-bell" || p.oscillator === "fm-piano") {
      const fm = FM[p.oscillator];
      const modulatorPhase = time * (p.frequency * fm.ratio);
      const modulator = Math.sin(2 * Math.PI * (modulatorPhase - Math.floor(modulatorPhase)));
      const index = fm.end + (fm.start - fm.end) / (1 + time * fm.fall);
      const carrier = cycle + index * modulator * FRAC_1_2PI;
      raw = Math.sin(2 * Math.PI * (carrier - Math.floor(carrier)));
    } else if (p.oscillator === "plucked-string") raw = string();
    else if (p.oscillator === "supersaw") {
      let sumLeft = 0;
      let sumRight = 0;
      for (let k = 0; k < 7; k++) {
        const voicePhase = time * supersawFrequencies[k]! + SUPERSAW_PHASES[k]!;
        const voiceCycle = voicePhase - Math.floor(voicePhase);
        const saw =
          SUPERSAW_LEVELS[k]! * (2 * voiceCycle - 1 - polyBlep(voiceCycle, supersawDts[k]!));
        sumLeft += saw * panLeft[k]!;
        sumRight += saw * panRight[k]!;
      }
      raw = sumLeft * SUPERSAW_GAIN;
      rawRight = sumRight * SUPERSAW_GAIN;
    } else if (p.oscillator === "sine") raw = Math.sin(2 * Math.PI * cycle);
    else if (p.oscillator === "square") {
      const half = cycle + 0.5;
      raw =
        (cycle < 0.5 ? 1 : -1) + polyBlep(cycle, dt) - polyBlep(half >= 1 ? half - 1 : half, dt);
    } else if (p.oscillator === "sawtooth") raw = 2 * cycle - 1 - polyBlep(cycle, dt);
    else if (p.oscillator === "pulse-25") {
      const fall = cycle + 0.75;
      raw =
        (cycle < 0.25 ? 1 : -1) +
        polyBlep(cycle, dt) -
        polyBlep(fall >= 1 ? fall - 1 : fall, dt) +
        0.5;
    } else raw = cycle < 0.5 ? 4 * cycle - 1 : 3 - 4 * cycle;
    if (p.resonance > 0) {
      const v3 = raw - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      filtered = v2;
    } else filtered += p.alpha * (raw - filtered);
    const stereo = p.oscillator === "supersaw";
    if (stereo) {
      if (p.resonance > 0) {
        const v3 = rawRight - icRight2;
        const v1 = a1 * icRight1 + a2 * v3;
        const v2 = icRight2 + a2 * icRight1 + a3 * v3;
        icRight1 = 2 * v1 - icRight1;
        icRight2 = 2 * v2 - icRight2;
        filteredRight = v2;
      } else filteredRight += p.alpha * (rawRight - filteredRight);
    }

    let envelope: number;
    if (time < p.attack) envelope = p.attack > 0 ? time / p.attack : 1;
    else if (time - p.attack < p.decay)
      envelope = p.decay > 0 ? 1 - (1 - p.sustain) * ((time - p.attack) / p.decay) : p.sustain;
    else if (time < p.noteDuration) envelope = p.sustain;
    else {
      const sinceRelease = time - p.noteDuration;
      envelope =
        sinceRelease >= p.release
          ? 0
          : p.release > 0
            ? p.sustain * (1 - sinceRelease / p.release)
            : 0;
    }
    const value = filtered * envelope * p.velocityGain;
    out.left[noteStart + i]! += value;
    out.right[noteStart + i]! += stereo ? filteredRight * envelope * p.velocityGain : value;
  }
}

const OSCILLATORS: KernelOscillator[] = [
  "sine",
  "square",
  "sawtooth",
  "triangle",
  "supersaw",
  "plucked-string",
  "fm-bell",
  "fm-piano",
  "808-bass",
  "pulse-25"
  // "drum-kit" has no TypeScript reference: its arithmetic is the same kinds of operation these
  // already prove identical, and voice-processor.test.ts checks preview against export for it.
];

for (const oscillator of OSCILLATORS) {
  test(`${oscillator}: kernel samples match the reference`, () => {
    const kernel = createNodeDspKernel();
    const length = 30_000;
    const expected = { left: new Float64Array(length), right: new Float64Array(length) };
    kernel.beginTrack(length);
    // Overlapping notes, one starting before the buffer and one running past its end, with
    // every envelope stage and a high note whose PolyBLEP correction spans several samples.
    const notes: [Partial<VoiceParams>, number, number][] = [
      [{ frequency: 110 }, -2_000, 9_000],
      [{ frequency: 523.25, attack: 0.02, decay: 0.05, sustain: 0.6 }, 1_000, 12_000],
      [{ frequency: 7_040, release: 0.1 }, 20_000, 20_000],
      [{ frequency: 61.7, attack: 0, decay: 0, sustain: 0.3, release: 0 }, 5_000, 3_000]
    ];
    for (const [overrides, start, total] of notes) {
      const params: VoiceParams = {
        oscillator,
        frequency: 440,
        sampleRate: 48_000,
        alpha: 0.35,
        attack: 0.005,
        decay: 0.1,
        sustain: 0.7,
        release: 0.05,
        noteDuration: 0.12,
        velocityGain: 0.8,
        seed: 0xdeadbeef,
        cutoff: 2_000,
        resonance: 0,
        ...overrides
      };
      kernel.renderVoice(params, start, total);
      referenceVoice(expected, params, start, total);
    }
    const actual = kernel.trackSamples();

    assert.equal(actual.left.length, length);
    assert.ok(actual.left.some((s) => s !== 0));
    if (
      oscillator === "sine" ||
      oscillator === "fm-bell" ||
      oscillator === "fm-piano" ||
      oscillator === "808-bass" ||
      oscillator === "supersaw"
    ) {
      // Rounding differences between the kernel's sine and Math.sin (the supersaw's pan gains
      // use it too); FM phase-modulates them, so allow a little more there.
      const tolerance = oscillator === "sine" ? 1e-14 : 1e-12;
      for (const side of ["left", "right"] as const) {
        const worst = worstDifference(actual[side], expected[side]);
        assert.ok(worst < tolerance, `${oscillator} ${side} differs by ${worst}`);
      }
    } else {
      assert.deepEqual(actual, expected);
    }
  });
}

test("the resonant filter matches the reference", () => {
  // Its tan comes from the kernel's sine and cosine, so allow for their rounding; resonance
  // amplifies it a little.
  for (const resonance of [0.05, 0.6, 1]) {
    const kernel = createNodeDspKernel();
    const expected = { left: new Float64Array(20_000), right: new Float64Array(20_000) };
    kernel.beginTrack(20_000);
    const params: VoiceParams = {
      oscillator: "sawtooth",
      frequency: 220,
      sampleRate: 48_000,
      alpha: 0.35,
      attack: 0.005,
      decay: 0.1,
      sustain: 0.7,
      release: 0.05,
      noteDuration: 0.3,
      velocityGain: 0.8,
      seed: 1,
      cutoff: 1_500,
      resonance
    };
    kernel.renderVoice(params, 100, 18_000);
    referenceVoice(expected, params, 100, 18_000);
    const actual = kernel.trackSamples();
    const worst = worstDifference(actual.left, expected.left);
    assert.ok(worst < 1e-9, `resonance ${resonance} differs by ${worst}`);
    assert.ok(actual.left.some((s) => s !== 0));
  }
});

test("beginTrack starts from silence", () => {
  const kernel = createNodeDspKernel();
  kernel.beginTrack(100);
  kernel.renderVoice(
    {
      oscillator: "square",
      frequency: 440,
      sampleRate: 48_000,
      alpha: 1,
      attack: 0,
      decay: 0,
      sustain: 1,
      release: 0,
      noteDuration: 1,
      velocityGain: 1,
      seed: 1,
      cutoff: 2_000,
      resonance: 0
    },
    0,
    100
  );
  kernel.beginTrack(50);
  assert.deepEqual(kernel.trackSamples(), {
    left: new Float64Array(50),
    right: new Float64Array(50)
  });
});

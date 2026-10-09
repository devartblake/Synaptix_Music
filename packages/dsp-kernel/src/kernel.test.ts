import assert from "node:assert/strict";
import test from "node:test";

import { type KernelOscillator, type VoiceParams } from "./index.ts";
import { createNodeDspKernel } from "./node.ts";

/**
 * The kernel must make exactly the samples this plain TypeScript does: that is what lets the
 * studio preview and the render worker share it, and it proves the WebAssembly arithmetic is
 * the same IEEE-754 arithmetic as JavaScript's. Only the sine differs (the kernel's own
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

function referenceVoice(
  out: Float64Array,
  p: VoiceParams,
  noteStart: number,
  noteTotal: number
): void {
  const first = Math.max(0, -noteStart);
  const end = Math.min(noteTotal, out.length - noteStart);
  const dt = p.frequency / p.sampleRate;
  const supersawFrequencies = SUPERSAW_RATIOS.map((ratio) => p.frequency * ratio);
  const supersawDts = supersawFrequencies.map((frequency) => frequency / p.sampleRate);
  const string = referenceString(p.frequency, p.sampleRate, p.seed);
  let filtered = 0;
  for (let i = first; i < end; i++) {
    const time = i / p.sampleRate;
    const phase = time * p.frequency;
    const cycle = phase - Math.floor(phase);
    let raw: number;
    if (p.oscillator === "plucked-string") raw = string();
    else if (p.oscillator === "supersaw") {
      let sum = 0;
      for (let k = 0; k < 7; k++) {
        const voicePhase = time * supersawFrequencies[k]! + SUPERSAW_PHASES[k]!;
        const voiceCycle = voicePhase - Math.floor(voicePhase);
        sum += SUPERSAW_LEVELS[k]! * (2 * voiceCycle - 1 - polyBlep(voiceCycle, supersawDts[k]!));
      }
      raw = sum * SUPERSAW_GAIN;
    } else if (p.oscillator === "sine") raw = Math.sin(2 * Math.PI * cycle);
    else if (p.oscillator === "square") {
      const half = cycle + 0.5;
      raw =
        (cycle < 0.5 ? 1 : -1) + polyBlep(cycle, dt) - polyBlep(half >= 1 ? half - 1 : half, dt);
    } else if (p.oscillator === "sawtooth") raw = 2 * cycle - 1 - polyBlep(cycle, dt);
    else raw = cycle < 0.5 ? 4 * cycle - 1 : 3 - 4 * cycle;
    filtered += p.alpha * (raw - filtered);

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
    out[noteStart + i]! += filtered * envelope * p.velocityGain;
  }
}

const OSCILLATORS: KernelOscillator[] = [
  "sine",
  "square",
  "sawtooth",
  "triangle",
  "supersaw",
  "plucked-string"
];

for (const oscillator of OSCILLATORS) {
  test(`${oscillator}: kernel samples match the reference`, () => {
    const kernel = createNodeDspKernel();
    const length = 30_000;
    const expected = new Float64Array(length);
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
        ...overrides
      };
      kernel.renderVoice(params, start, total);
      referenceVoice(expected, params, start, total);
    }
    const actual = kernel.trackSamples();

    assert.equal(actual.length, length);
    assert.ok(actual.some((s) => s !== 0));
    if (oscillator === "sine") {
      const worst = actual.reduce((max, s, i) => Math.max(max, Math.abs(s - expected[i]!)), 0);
      assert.ok(worst < 1e-14, `sine differs by ${worst}`);
    } else {
      assert.deepEqual(actual, expected);
    }
  });
}

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
      seed: 1
    },
    0,
    100
  );
  kernel.beginTrack(50);
  assert.deepEqual(kernel.trackSamples(), new Float64Array(50));
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  kernelWasmBytes,
  NO_MODULATION,
  onePoleAlpha,
  OSCILLATOR_CODES,
  type KernelOscillator,
  type VoiceModulation
} from "./index.ts";
import { createNodeDspKernel } from "./node.ts";
import {
  VOICE_PROCESSOR_NAME,
  VOICE_PROCESSOR_SOURCE,
  type VoiceProcessorMessage
} from "./voice-processor.ts";

/**
 * The preview must sound like the export. This runs the worklet source the studio ships, in
 * 128-frame blocks as a browser does, and compares it with the offline kernel path the render
 * worker uses: every sample must be the export's sample rounded to 32-bit float.
 */
const SAMPLE_RATE = 48_000;
const BLOCK = 128;

interface FakeProcessor {
  port: { onmessage: ((event: { data: VoiceProcessorMessage }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

// The AudioWorkletGlobalScope names the processor uses, installed for this test process.
const frame = { value: 0 };
let registered: (new (options: unknown) => FakeProcessor) | undefined;
Object.assign(globalThis, {
  AudioWorkletProcessor: class {
    port = { onmessage: null };
  },
  registerProcessor: (name: string, processor: typeof registered) => {
    assert.equal(name, VOICE_PROCESSOR_NAME);
    registered = processor;
  },
  sampleRate: SAMPLE_RATE
});
Object.defineProperty(globalThis, "currentFrame", { get: () => frame.value });
new Function(VOICE_PROCESSOR_SOURCE)();

function loadProcessor(): FakeProcessor {
  return new registered!({ processorOptions: { wasm: kernelWasmBytes() } });
}

interface Note {
  oscillator: KernelOscillator;
  frequency: number;
  time: number;
  noteDuration: number;
  resonance?: number;
  modulation?: VoiceModulation;
}

const ENVELOPE = { attack: 0.01, decay: 0.05, sustain: 0.6, release: 0.08 };

function noteMessage(note: Note): VoiceProcessorMessage {
  return {
    type: "note",
    oscillator: OSCILLATOR_CODES[note.oscillator],
    frequency: note.frequency,
    alpha: onePoleAlpha(2_400, SAMPLE_RATE),
    ...ENVELOPE,
    noteDuration: note.noteDuration,
    velocityGain: 0.75,
    seed: 0xc0ffee,
    cutoff: 2_400,
    resonance: note.resonance ?? 0,
    modulation: note.modulation ?? NO_MODULATION,
    time: note.time
  };
}

type Stereo<T> = { left: T; right: T };

function exportSamples(notes: readonly Note[], length: number): Stereo<Float64Array> {
  const kernel = createNodeDspKernel();
  kernel.beginTrack(length);
  for (const note of notes) {
    kernel.renderVoice(
      {
        oscillator: note.oscillator,
        frequency: note.frequency,
        sampleRate: SAMPLE_RATE,
        alpha: onePoleAlpha(2_400, SAMPLE_RATE),
        ...ENVELOPE,
        noteDuration: note.noteDuration,
        velocityGain: 0.75,
        seed: 0xc0ffee,
        cutoff: 2_400,
        resonance: note.resonance ?? 0,
        modulation: note.modulation
      },
      Math.round(note.time * SAMPLE_RATE),
      Math.round((note.noteDuration + ENVELOPE.release) * SAMPLE_RATE)
    );
  }
  return kernel.trackSamples();
}

function play(
  processor: FakeProcessor,
  length: number,
  before?: (frame: number) => void
): Stereo<Float32Array> {
  const out = { left: new Float32Array(length), right: new Float32Array(length) };
  for (frame.value = 0; frame.value < length; frame.value += BLOCK) {
    before?.(frame.value);
    // A stereo output, as the studio creates the node.
    const outputs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    assert.equal(processor.process([], outputs), true);
    const count = Math.min(BLOCK, length - frame.value);
    out.left.set(outputs[0]![0]!.subarray(0, count), frame.value);
    out.right.set(outputs[0]![1]!.subarray(0, count), frame.value);
  }
  return out;
}

/** Exact match, reporting the first differing sample instead of diffing whole buffers. */
function assertSameSamples(actual: Stereo<Float32Array>, expected: Stereo<Float64Array>): void {
  for (const side of ["left", "right"] as const) {
    const [a, e] = [actual[side], expected[side]];
    assert.equal(a.length, e.length);
    const index = a.findIndex((sample, i) => sample !== Math.fround(e[i]!));
    assert.equal(
      index,
      -1,
      `${side} sample ${index}: ${a[index]} vs ${Math.fround(e[index] ?? 0)}`
    );
  }
}

test("the preview worklet plays exactly the samples an export renders", () => {
  const notes: Note[] = [
    { oscillator: "sawtooth", frequency: 220, time: 0.00031, noteDuration: 0.2 },
    { oscillator: "square", frequency: 329.63, time: 0.05, noteDuration: 0.15 },
    { oscillator: "sine", frequency: 880, time: 0.1, noteDuration: 0.05 },
    { oscillator: "triangle", frequency: 110, time: 0.12, noteDuration: 0.3 },
    { oscillator: "supersaw", frequency: 440, time: 0.2, noteDuration: 0.2 },
    { oscillator: "plucked-string", frequency: 196, time: 0.25, noteDuration: 0.25 },
    { oscillator: "fm-bell", frequency: 784, time: 0.3, noteDuration: 0.15 },
    { oscillator: "fm-piano", frequency: 261.63, time: 0.33, noteDuration: 0.2 },
    { oscillator: "fm-marimba", frequency: 523.25, time: 0.34, noteDuration: 0.1 },
    { oscillator: "fm-vibraphone", frequency: 349.23, time: 0.35, noteDuration: 0.2 },
    // Kick, snare and closed hat (General MIDI 36, 38, 42).
    { oscillator: "drum-kit", frequency: 65.40639132514966, time: 0.36, noteDuration: 0.1 },
    { oscillator: "drum-kit", frequency: 73.41619197935188, time: 0.38, noteDuration: 0.1 },
    { oscillator: "drum-kit", frequency: 92.4986056779086, time: 0.4, noteDuration: 0.05 },
    { oscillator: "808-bass", frequency: 55, time: 0.42, noteDuration: 0.15 },
    { oscillator: "pulse-25", frequency: 987.77, time: 0.45, noteDuration: 0.1 },
    { oscillator: "pulse-12", frequency: 659.25, time: 0.46, noteDuration: 0.1 },
    { oscillator: "chip-triangle", frequency: 65.41, time: 0.465, noteDuration: 0.1 },
    { oscillator: "sawtooth", frequency: 146.83, time: 0.47, noteDuration: 0.1, resonance: 0.8 },
    // Wide noise with a rising (negative) filter envelope, as Riser FX uses.
    {
      oscillator: "noise",
      frequency: 261.63,
      time: 0.52,
      noteDuration: 0.06,
      resonance: 0.4,
      modulation: { ...NO_MODULATION, filterEnvOctaves: -4, filterEnvDecay: 0.05 }
    },
    // Every modulation at once, on a resonant supersaw.
    {
      oscillator: "supersaw",
      frequency: 196,
      time: 0.5,
      noteDuration: 0.08,
      resonance: 0.5,
      modulation: {
        lfoRate: 6,
        vibratoCents: 30,
        lfoCutoffOctaves: 1,
        tremolo: 0.4,
        filterEnvOctaves: 2,
        filterEnvDecay: 0.03
      }
    }
  ];
  const length = Math.round(0.6 * SAMPLE_RATE);
  const processor = loadProcessor();
  // Notes arrive ahead of time, as Tone's transport look-ahead sends them.
  for (const note of notes) processor.port.onmessage!({ data: noteMessage(note) });

  const preview = play(processor, length);

  assertSameSamples(preview, exportSamples(notes, length));
  assert.ok(preview.left.some((s) => s !== 0));
  // The supersaw note spreads, so the preview really is stereo.
  assert.ok(preview.left.some((s, i) => s !== preview.right[i]));
});

test("release ends held notes with their release, and silences notes not yet started", () => {
  const processor = loadProcessor();
  processor.port.onmessage!({
    data: noteMessage({ oscillator: "sawtooth", frequency: 220, time: 0, noteDuration: 2 })
  });
  processor.port.onmessage!({
    data: noteMessage({ oscillator: "sawtooth", frequency: 330, time: 0.5, noteDuration: 1 })
  });
  const length = Math.round(0.6 * SAMPLE_RATE);
  const releaseFrame = Math.round(0.2 * SAMPLE_RATE);

  const preview = play(processor, length, (at) => {
    if (at === Math.floor(releaseFrame / BLOCK) * BLOCK)
      processor.port.onmessage!({ data: { type: "release", time: 0.2 } });
  });

  // The held note behaves as if it had been 0.2 s long; the later note never sounds.
  const expected = exportSamples(
    [{ oscillator: "sawtooth", frequency: 220, time: 0, noteDuration: 0.2 }],
    length
  );
  assertSameSamples(preview, expected);
  assert.ok(
    preview.left.subarray(releaseFrame + ENVELOPE.release * SAMPLE_RATE).every((s) => s === 0)
  );
});

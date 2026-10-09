import assert from "node:assert/strict";
import test from "node:test";

import { kernelWasmBytes, onePoleAlpha, OSCILLATOR_CODES, type KernelOscillator } from "./index.ts";
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
    time: note.time
  };
}

function exportSamples(notes: readonly Note[], length: number): Float64Array {
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
        velocityGain: 0.75
      },
      Math.round(note.time * SAMPLE_RATE),
      Math.round((note.noteDuration + ENVELOPE.release) * SAMPLE_RATE)
    );
  }
  return kernel.trackSamples();
}

function play(processor: FakeProcessor, length: number, before?: (frame: number) => void) {
  const out = new Float32Array(length);
  for (frame.value = 0; frame.value < length; frame.value += BLOCK) {
    before?.(frame.value);
    const outputs = [[new Float32Array(BLOCK)]];
    assert.equal(processor.process([], outputs), true);
    out.set(outputs[0]![0]!.subarray(0, Math.min(BLOCK, length - frame.value)), frame.value);
  }
  return out;
}

/** Exact match, reporting the first differing sample instead of diffing whole buffers. */
function assertSameSamples(actual: Float32Array, expected: Float64Array): void {
  assert.equal(actual.length, expected.length);
  const index = actual.findIndex((sample, i) => sample !== Math.fround(expected[i]!));
  assert.equal(
    index,
    -1,
    `sample ${index}: ${actual[index]} vs ${Math.fround(expected[index] ?? 0)}`
  );
}

test("the preview worklet plays exactly the samples an export renders", () => {
  const notes: Note[] = [
    { oscillator: "sawtooth", frequency: 220, time: 0.00031, noteDuration: 0.2 },
    { oscillator: "square", frequency: 329.63, time: 0.05, noteDuration: 0.15 },
    { oscillator: "sine", frequency: 880, time: 0.1, noteDuration: 0.05 },
    { oscillator: "triangle", frequency: 110, time: 0.12, noteDuration: 0.3 }
  ];
  const length = Math.round(0.6 * SAMPLE_RATE);
  const processor = loadProcessor();
  // Notes arrive ahead of time, as Tone's transport look-ahead sends them.
  for (const note of notes) processor.port.onmessage!({ data: noteMessage(note) });

  const preview = play(processor, length);

  assertSameSamples(preview, exportSamples(notes, length));
  assert.ok(preview.some((s) => s !== 0));
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
  assert.ok(preview.subarray(releaseFrame + ENVELOPE.release * SAMPLE_RATE).every((s) => s === 0));
});

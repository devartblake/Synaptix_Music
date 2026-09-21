import type { StereoBuffer } from "./wav-encoder.ts";

const REFERENCE_SAMPLE_RATE = 44100;
const COMB_DELAYS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617] as const;
const ALLPASS_DELAYS = [556, 441, 341, 225] as const;
const STEREO_SPREAD = 23;

function scaledDelay(samples: number, sampleRate: number): number {
  return Math.max(1, Math.round((samples * sampleRate) / REFERENCE_SAMPLE_RATE));
}

function combFilter(
  input: Float64Array,
  delaySamples: number,
  decaySeconds: number,
  sampleRate: number
): Float64Array {
  const output = new Float64Array(input.length);
  const delaySeconds = delaySamples / sampleRate;
  const feedback = Math.min(0.98, 10 ** ((-3 * delaySeconds) / decaySeconds));
  const damping = 0.2;
  let filteredFeedback = 0;

  for (let index = 0; index < input.length; index++) {
    const delayed = index >= delaySamples ? (output[index - delaySamples] ?? 0) : 0;
    filteredFeedback += damping * (delayed - filteredFeedback);
    output[index] = (input[index] ?? 0) + filteredFeedback * feedback;
  }
  return output;
}

function allpassFilter(input: Float64Array, delaySamples: number): Float64Array {
  const output = new Float64Array(input.length);
  const feedback = 0.5;
  for (let index = 0; index < input.length; index++) {
    const delayedInput = index >= delaySamples ? (input[index - delaySamples] ?? 0) : 0;
    const delayedOutput = index >= delaySamples ? (output[index - delaySamples] ?? 0) : 0;
    output[index] = -feedback * (input[index] ?? 0) + delayedInput + feedback * delayedOutput;
  }
  return output;
}

function reverberateChannel(
  input: Float64Array,
  sampleRate: number,
  decaySeconds: number,
  spread: number
): Float64Array {
  const combined = new Float64Array(input.length);
  for (const baseDelay of COMB_DELAYS) {
    const comb = combFilter(
      input,
      scaledDelay(baseDelay + spread, sampleRate),
      decaySeconds,
      sampleRate
    );
    for (let index = 0; index < combined.length; index++) {
      combined[index] = (combined[index] ?? 0) + (comb[index] ?? 0) / COMB_DELAYS.length;
    }
  }

  let output = combined;
  for (const baseDelay of ALLPASS_DELAYS) {
    output = allpassFilter(output, scaledDelay(baseDelay + spread, sampleRate));
  }
  return output;
}

/**
 * Deterministic Freeverb-style stereo reverb. The input is treated as a wet
 * send and the returned buffer contains only the processed return signal.
 */
export function applyReverb(
  buffer: StereoBuffer,
  decaySeconds: number,
  sampleRate: number
): StereoBuffer {
  if (buffer.left.length !== buffer.right.length)
    throw new Error("Reverb channel buffers must have equal length.");
  if (!Number.isFinite(decaySeconds) || decaySeconds <= 0)
    throw new Error("decaySeconds must be positive.");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0)
    throw new Error("sampleRate must be a positive integer.");

  return {
    left: reverberateChannel(buffer.left, sampleRate, decaySeconds, 0),
    right: reverberateChannel(buffer.right, sampleRate, decaySeconds, STEREO_SPREAD)
  };
}

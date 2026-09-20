import type { StereoBuffer } from "./wav-encoder.ts";

export interface CompressorOptions {
  thresholdDb: number;
  ratio: number;
  attackSeconds: number;
  releaseSeconds: number;
}

export interface CompressorOutcome {
  buffer: StereoBuffer;
  warnings: string[];
}

function smoothingCoefficient(seconds: number, sampleRate: number): number {
  return seconds === 0 ? 0 : Math.exp(-1 / (seconds * sampleRate));
}

/** A deterministic, stereo-linked feed-forward peak compressor. */
export function applyCompressor(
  buffer: StereoBuffer,
  options: CompressorOptions,
  sampleRate: number
): CompressorOutcome {
  if (buffer.left.length !== buffer.right.length)
    throw new Error("Compressor channel buffers must have equal length.");
  if (!Number.isFinite(options.thresholdDb) || options.thresholdDb > 0) {
    throw new Error("thresholdDb must be finite and no greater than 0 dBFS.");
  }
  if (!Number.isFinite(options.ratio) || options.ratio < 1)
    throw new Error("ratio must be at least 1.");
  if (!Number.isFinite(options.attackSeconds) || options.attackSeconds < 0) {
    throw new Error("attackSeconds must be non-negative.");
  }
  if (!Number.isFinite(options.releaseSeconds) || options.releaseSeconds < 0) {
    throw new Error("releaseSeconds must be non-negative.");
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0)
    throw new Error("sampleRate must be a positive integer.");

  const left = new Float64Array(buffer.left.length);
  const right = new Float64Array(buffer.right.length);
  const attack = smoothingCoefficient(options.attackSeconds, sampleRate);
  const release = smoothingCoefficient(options.releaseSeconds, sampleRate);
  let envelope = 0;

  for (let index = 0; index < left.length; index++) {
    const detector = Math.max(
      Math.abs(buffer.left[index] ?? 0),
      Math.abs(buffer.right[index] ?? 0)
    );
    const coefficient = detector > envelope ? attack : release;
    envelope = coefficient * envelope + (1 - coefficient) * detector;

    let gain = 1;
    if (envelope > 0) {
      const inputDb = 20 * Math.log10(envelope);
      if (inputDb > options.thresholdDb) {
        const outputDb = options.thresholdDb + (inputDb - options.thresholdDb) / options.ratio;
        gain = 10 ** ((outputDb - inputDb) / 20);
      }
    }
    left[index] = (buffer.left[index] ?? 0) * gain;
    right[index] = (buffer.right[index] ?? 0) * gain;
  }

  return { buffer: { left, right }, warnings: [] };
}

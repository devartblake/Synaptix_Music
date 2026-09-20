import assert from "node:assert/strict";
import test from "node:test";

import { applyCompressor, type CompressorOptions } from "./compressor.ts";

const INSTANT_OPTIONS: CompressorOptions = {
  thresholdDb: -12,
  ratio: 4,
  attackSeconds: 0,
  releaseSeconds: 0
};

test("compressor leaves signal below threshold at unity gain", () => {
  const input = Float64Array.from([0.1, -0.1, 0.2]);
  const outcome = applyCompressor({ left: input, right: input }, INSTANT_OPTIONS, 1000);
  assert.deepEqual(outcome.buffer.left, input);
  assert.deepEqual(outcome.buffer.right, input);
  assert.deepEqual(outcome.warnings, []);
});

test("compressor applies the configured ratio above threshold", () => {
  const input = Float64Array.from([1]);
  const outcome = applyCompressor({ left: input, right: input }, INSTANT_OPTIONS, 1000);
  const expectedOutputDb = -12 + 12 / 4;
  const expectedAmplitude = 10 ** (expectedOutputDb / 20);
  assert.ok(Math.abs((outcome.buffer.left[0] ?? 0) - expectedAmplitude) < 1e-12);
});

test("compressor is stereo-linked and deterministic", () => {
  const buffer = {
    left: Float64Array.from([1, 0.5, 0.25]),
    right: Float64Array.from([0.25, 0.5, 1])
  };
  const first = applyCompressor(buffer, INSTANT_OPTIONS, 1000);
  const second = applyCompressor(buffer, INSTANT_OPTIONS, 1000);
  assert.deepEqual(first.buffer.left, second.buffer.left);
  assert.deepEqual(first.buffer.right, second.buffer.right);
  assert.equal((first.buffer.left[0] ?? 0) / 1, (first.buffer.right[0] ?? 0) / 0.25);
});

test("compressor validates its settings", () => {
  const buffer = { left: new Float64Array(1), right: new Float64Array(1) };
  assert.throws(() => applyCompressor(buffer, { ...INSTANT_OPTIONS, ratio: 0 }, 44100), /ratio/);
  assert.throws(
    () => applyCompressor(buffer, { ...INSTANT_OPTIONS, attackSeconds: -1 }, 44100),
    /attackSeconds/
  );
  assert.throws(
    () =>
      applyCompressor(
        { left: new Float64Array(1), right: new Float64Array(2) },
        INSTANT_OPTIONS,
        44100
      ),
    /equal length/
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { encodeWav, type StereoBuffer } from "./wav-encoder.ts";

function stereo(samples: number[]): StereoBuffer {
  return { left: Float64Array.from(samples), right: Float64Array.from(samples) };
}

test("WAV header describes the format correctly", () => {
  const bytes = encodeWav(stereo([0, 0.5, -0.5, 1, -1]), 48000, 16);

  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "fmt ");
  assert.equal(bytes.readUInt16LE(20), 1, "PCM audio format");
  assert.equal(bytes.readUInt16LE(22), 2, "stereo");
  assert.equal(bytes.readUInt32LE(24), 48000, "sample rate");
  assert.equal(bytes.readUInt16LE(34), 16, "bit depth");
  assert.equal(bytes.subarray(36, 40).toString("ascii"), "data");

  const dataSize = 5 * 2 * 2; // frames * channels * bytesPerSample
  assert.equal(bytes.readUInt32LE(40), dataSize);
  assert.equal(bytes.readUInt32LE(4), 36 + dataSize);
  assert.equal(bytes.length, 44 + dataSize);
});

test("16-bit samples round-trip through full-scale values", () => {
  const bytes = encodeWav(stereo([1, -1, 0]), 44100, 16);
  assert.equal(bytes.readInt16LE(44), 32767);
  assert.equal(bytes.readInt16LE(46), 32767);
  assert.equal(bytes.readInt16LE(48), -32768);
  assert.equal(bytes.readInt16LE(50), -32768);
  assert.equal(bytes.readInt16LE(52), 0);
});

test("out-of-range samples are hard-clipped rather than wrapping", () => {
  const bytes = encodeWav(stereo([2, -2]), 44100, 16);
  assert.equal(bytes.readInt16LE(44), 32767);
  assert.equal(bytes.readInt16LE(48), -32768);
});

test("24-bit and 32-bit encodings use the requested bit depth and byte layout", () => {
  const bytes24 = encodeWav(stereo([1]), 44100, 24);
  assert.equal(bytes24.readUInt16LE(34), 24);
  assert.equal(bytes24.length, 44 + 1 * 2 * 3);

  const bytes32 = encodeWav(stereo([1]), 44100, 32);
  assert.equal(bytes32.readUInt16LE(34), 32);
  assert.equal(bytes32.readInt32LE(44), 2 ** 31 - 1);
});

test("mismatched channel lengths fail closed", () => {
  assert.throws(
    () => encodeWav({ left: Float64Array.from([0]), right: Float64Array.from([0, 0]) }, 44100, 16),
    /equal length/
  );
});

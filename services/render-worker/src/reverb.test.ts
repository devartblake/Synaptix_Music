import assert from "node:assert/strict";
import test from "node:test";

import { applyReverb } from "./reverb.ts";

function impulse(length: number): { left: Float64Array; right: Float64Array } {
  const left = new Float64Array(length);
  const right = new Float64Array(length);
  left[0] = 1;
  right[0] = 1;
  return { left, right };
}

function energyAfter(channel: Float64Array, start: number): number {
  let energy = 0;
  for (let index = start; index < channel.length; index++) energy += (channel[index] ?? 0) ** 2;
  return energy;
}

test("reverb is deterministic and produces a decaying stereo tail", () => {
  const first = applyReverb(impulse(44100), 1.8, 44100);
  const second = applyReverb(impulse(44100), 1.8, 44100);

  assert.deepEqual(first.left, second.left);
  assert.deepEqual(first.right, second.right);
  assert.ok(energyAfter(first.left, 2205) > 0, "left channel has energy after 50 ms");
  assert.ok(energyAfter(first.right, 2205) > 0, "right channel has energy after 50 ms");
  assert.notDeepEqual(first.left, first.right, "stereo spread decorrelates the return channels");
});

test("a longer decay retains more late-tail energy", () => {
  const short = applyReverb(impulse(44100), 0.4, 44100);
  const long = applyReverb(impulse(44100), 2.4, 44100);
  assert.ok(energyAfter(long.left, 22050) > energyAfter(short.left, 22050));
});

test("reverb validates channel lengths and processing settings", () => {
  assert.throws(
    () => applyReverb({ left: new Float64Array(1), right: new Float64Array(2) }, 1.8, 44100),
    /equal length/
  );
  assert.throws(() => applyReverb(impulse(10), 0, 44100), /decaySeconds/);
  assert.throws(() => applyReverb(impulse(10), 1.8, 0), /sampleRate/);
});

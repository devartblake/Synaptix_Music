import assert from "node:assert/strict"; import test from "node:test";
import { buildFrequencyDroneRenderPlan, renderFrequencyDroneMono, DEFAULT_FREQUENCY_DRONE_DEVICE_SETTINGS } from "./index.ts";
test("frequency drone rendering is deterministic and bounded",()=>{const plan=buildFrequencyDroneRenderPlan({...DEFAULT_FREQUENCY_DRONE_DEVICE_SETTINGS,frequencyHz:528,harmonics:3},0.1,48000);const a=renderFrequencyDroneMono(plan),b=renderFrequencyDroneMono(plan);assert.equal(a.length,4800);assert.deepEqual(a,b);assert.ok(a.some(v=>v!==0));assert.ok(a.every(v=>Math.abs(v)<=1));});
test("frequency drone render rejects non-positive durations",()=>assert.throws(()=>buildFrequencyDroneRenderPlan(DEFAULT_FREQUENCY_DRONE_DEVICE_SETTINGS,0),/positive/));

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";

import { AudioPluginDescriptorSchema } from "@synaptix/project-model/plugin";
import { DeviceV2Schema } from "@synaptix/project-model/v2";

import {
  createReferenceDriveDevice,
  REFERENCE_DRIVE_DESCRIPTOR,
  REFERENCE_DRIVE_MODULE_CHECKSUM,
  REFERENCE_DRIVE_PROCESSOR_NAME,
  REFERENCE_DRIVE_PROCESSOR_SOURCE
} from "./reference-drive.ts";

interface ProcessorDescriptor { name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }
interface Processor {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
interface ProcessorClass { new (): Processor; parameterDescriptors: ProcessorDescriptor[] }

/** Evaluate the exact shipped module in an isolated AudioWorkletGlobalScope stand-in. */
function loadProcessor(): { name: string; Processor: ProcessorClass } {
  let registered: { name: string; Processor: ProcessorClass } | null = null;
  class AudioWorkletProcessor {
    readonly port = { onmessage: null as ((event: { data: unknown }) => void) | null };
  }
  vm.runInNewContext(REFERENCE_DRIVE_PROCESSOR_SOURCE, {
    AudioWorkletProcessor,
    registerProcessor: (name: string, Processor: ProcessorClass) => { registered = { name, Processor }; },
    Math
  });
  assert.ok(registered, "module must register a processor");
  return registered;
}

function parameters(values: Partial<Record<string, number | number[]>> = {}): Record<string, Float32Array> {
  const defaults: Record<string, number> = { inputGainDb: 0, drive: 1, mix: 1, outputGainDb: 0 };
  return Object.fromEntries(Object.entries(defaults).map(([id, fallback]) => {
    const value = values[id] ?? fallback;
    return [id, Float32Array.from(Array.isArray(value) ? value : [value])];
  }));
}

function run(input: Float32Array[] | null, params: Record<string, Float32Array>, frames = 128): Float32Array[] {
  const { Processor } = loadProcessor();
  const output = [new Float32Array(frames), new Float32Array(frames)];
  new Processor().process(input ? [input] : [[]], [output], params);
  return output;
}

function ramp(frames = 128, peak = 1): Float32Array {
  return Float32Array.from({ length: frames }, (_, index) => peak * Math.sin((2 * Math.PI * index) / frames));
}

test("the shipped processor source matches its pinned integrity checksum", () => {
  const checksum = createHash("sha256").update(REFERENCE_DRIVE_PROCESSOR_SOURCE, "utf8").digest("hex");
  assert.equal(checksum, REFERENCE_DRIVE_MODULE_CHECKSUM);
  assert.equal(REFERENCE_DRIVE_DESCRIPTOR.reference.moduleChecksumSha256, REFERENCE_DRIVE_MODULE_CHECKSUM);
});

test("processor parameter descriptors match the canonical plug-in descriptor", () => {
  const { name, Processor } = loadProcessor();
  assert.equal(name, REFERENCE_DRIVE_PROCESSOR_NAME);
  // The module runs in another realm; compare plain data.
  const processorDescriptors: ProcessorDescriptor[] = JSON.parse(JSON.stringify(Processor.parameterDescriptors));
  assert.deepEqual(
    processorDescriptors.map(({ name: id, defaultValue, minValue, maxValue, automationRate }) => ({ id, defaultValue, minValue, maxValue, automationRate })),
    REFERENCE_DRIVE_DESCRIPTOR.parameters.map(({ id, defaultValue, minimum, maximum, automationRate }) => ({
      id, defaultValue, minValue: minimum, maxValue: maximum, automationRate
    }))
  );
  assert.doesNotThrow(() => AudioPluginDescriptorSchema.parse(REFERENCE_DRIVE_DESCRIPTOR));
});

test("a fully dry mix passes stereo audio through unchanged", () => {
  const left = ramp();
  const right = ramp(128, -0.5);
  const [outLeft, outRight] = run([left, right], parameters({ mix: 0 }));
  assert.deepEqual(outLeft, left);
  assert.deepEqual(outRight, right);
});

test("the soft clipper is unity for small signals and bounded for large ones", () => {
  const quiet = Float32Array.from({ length: 128 }, () => 0.001);
  const [small] = run([quiet, quiet], parameters({ drive: 8 }));
  assert.ok(Math.abs(small![0]! - 0.001) < 1e-6);

  const loud = Float32Array.from({ length: 128 }, () => 50);
  const [clipped] = run([loud, loud], parameters({ drive: 4 }));
  assert.ok(clipped!.every((sample) => sample <= 0.25 + 1e-6 && sample > 0.24));
});

test("gains and a-rate automation are applied per sample", () => {
  const input = Float32Array.from({ length: 4 }, () => 0.001);
  const [boosted] = run([input, input], parameters({ inputGainDb: 20, mix: 0 }), 4);
  assert.ok(Math.abs(boosted![0]! - 0.01) < 1e-6);

  const [automated] = run([input, input], parameters({ mix: 0, outputGainDb: [0, 6.0206, 0, -6.0206] }), 4);
  assert.deepEqual(Array.from(automated!, (sample) => Math.round(sample * 1e5) / 1e5), [0.001, 0.002, 0.001, 0.0005]);
});

test("mono input is up-mixed and missing input yields silence", () => {
  const mono = ramp();
  const [left, right] = run([mono], parameters({ mix: 0 }));
  assert.deepEqual(left, mono);
  assert.deepEqual(right, mono);
  const [silentLeft] = run(null, parameters());
  assert.ok(silentLeft!.every((sample) => sample === 0));
});

test("the processor stops after a dispose message", () => {
  const { Processor } = loadProcessor();
  const processor = new Processor();
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  assert.equal(processor.process([[]], outputs, parameters()), true);
  processor.port.onmessage?.({ data: { type: "dispose" } });
  assert.equal(processor.process([[]], outputs, parameters()), false);
});

test("new Reference Drive devices are valid v2 devices at descriptor defaults", () => {
  const device = DeviceV2Schema.parse(createReferenceDriveDevice("device-drive"));
  assert.deepEqual(device.plugin, REFERENCE_DRIVE_DESCRIPTOR.reference);
  assert.deepEqual(device.parameters, [
    { id: "inputGainDb", value: 0 }, { id: "drive", value: 1 }, { id: "mix", value: 1 }, { id: "outputGainDb", value: 0 }
  ]);
});

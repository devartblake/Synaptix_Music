import type { DeviceV2 } from "@synaptix/project-model/v2";

/**
 * Deterministic offline ports of first-party plug-in processors, used to render plug-in freezes
 * (Project Schema v2 cutover step E). Each must match its browser AudioWorklet sample for
 * sample; a parity test runs the worklet source against these. Third-party plug-ins are never
 * processed here: freezes of them fail closed.
 */
export interface StereoSamples {
  left: Float64Array;
  right: Float64Array;
}

export interface OfflinePluginProcessor {
  pluginId: string;
  version: string;
  process(buffer: StereoSamples, device: DeviceV2, sampleRate: number): void;
}

function parameter(device: DeviceV2, id: string, fallback: number, min: number, max: number): number {
  const value = device.parameters.find((candidate) => candidate.id === id)?.value;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Same formula as the Reference Drive AudioWorklet (`driveSample` in reference-drive.ts). */
export function referenceDriveSample(x: number, inputGain: number, drive: number, mix: number, outputGain: number): number {
  const pre = x * inputGain;
  const wet = Math.tanh(drive * pre) / drive;
  return outputGain * ((1 - mix) * pre + mix * wet);
}

const referenceDrive: OfflinePluginProcessor = {
  pluginId: "synaptix.reference-drive",
  version: "1.0.0",
  process(buffer, device) {
    const inputGain = dbToGain(parameter(device, "inputGainDb", 0, -24, 24));
    const drive = parameter(device, "drive", 1, 1, 20);
    const mix = parameter(device, "mix", 1, 0, 1);
    const outputGain = dbToGain(parameter(device, "outputGainDb", 0, -24, 24));
    for (const channel of [buffer.left, buffer.right]) {
      for (let index = 0; index < channel.length; index++) {
        channel[index] = referenceDriveSample(channel[index] ?? 0, inputGain, drive, mix, outputGain);
      }
    }
  }
};

const PROCESSORS = new Map([referenceDrive].map((processor) => [`${processor.pluginId}@${processor.version}`, processor]));

/** The deterministic processor for a device, or a reason it can't be frozen. */
export function offlineProcessorFor(device: DeviceV2): OfflinePluginProcessor | string {
  const processor = PROCESSORS.get(`${device.plugin.pluginId}@${device.plugin.version}`);
  if (!processor) return "only first-party plug-ins with an offline processor can be frozen";
  if (device.automation.length > 0) return "automated plug-in parameters can't be frozen yet";
  return processor;
}

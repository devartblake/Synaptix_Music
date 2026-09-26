import { AudioPluginDescriptorSchema, type AudioPluginDescriptor } from "@synaptix/project-model/plugin";
import type { DeviceV2 } from "@synaptix/project-model/v2";

/*
 * Synaptix Reference Drive: first-party AudioWorklet reference processor
 * (Plugin Runtime Foundation v1, R3 / Slice D).
 *
 * Stereo input gain -> tanh soft clip (normalized so small signals pass at unity) ->
 * wet/dry mix -> output gain. Bypass is host-level (device.enabled), not a parameter.
 *
 * REFERENCE_DRIVE_PROCESSOR_SOURCE is the exact module loaded into the AudioWorklet
 * global scope. It is plain JavaScript with no imports, and its SHA-256 is pinned in the
 * descriptor so the host can verify integrity before loading it.
 */

export const REFERENCE_DRIVE_PLUGIN_ID = "synaptix.reference-drive";
export const REFERENCE_DRIVE_VERSION = "1.0.0";
export const REFERENCE_DRIVE_PROCESSOR_NAME = "synaptix-reference-drive";

export const REFERENCE_DRIVE_INPUT_GAIN_PARAMETER = "inputGainDb";
export const REFERENCE_DRIVE_DRIVE_PARAMETER = "drive";
export const REFERENCE_DRIVE_MIX_PARAMETER = "mix";
export const REFERENCE_DRIVE_OUTPUT_GAIN_PARAMETER = "outputGainDb";

export const REFERENCE_DRIVE_PROCESSOR_SOURCE = `"use strict";
const PARAMETERS = [
  { name: "inputGainDb", defaultValue: 0, minValue: -24, maxValue: 24, automationRate: "a-rate" },
  { name: "drive", defaultValue: 1, minValue: 1, maxValue: 20, automationRate: "a-rate" },
  { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "a-rate" },
  { name: "outputGainDb", defaultValue: 0, minValue: -24, maxValue: 24, automationRate: "a-rate" }
];

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function driveSample(x, inputGain, drive, mix, outputGain) {
  const pre = x * inputGain;
  const wet = Math.tanh(drive * pre) / drive;
  return outputGain * ((1 - mix) * pre + mix * wet);
}

function at(values, index) {
  return values.length > 1 ? values[index] : values[0];
}

class SynaptixReferenceDriveProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAMETERS;
  }

  constructor() {
    super();
    this.active = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "dispose") this.active = false;
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output) return this.active;
    const inputGainDb = parameters.inputGainDb;
    const drive = parameters.drive;
    const mix = parameters.mix;
    const outputGainDb = parameters.outputGainDb;
    const constantGains = inputGainDb.length === 1 && outputGainDb.length === 1;
    const inputGain = dbToGain(inputGainDb[0]);
    const outputGain = dbToGain(outputGainDb[0]);
    for (let channel = 0; channel < output.length; channel += 1) {
      const target = output[channel];
      const source = input && input.length > 0 ? input[Math.min(channel, input.length - 1)] : null;
      for (let index = 0; index < target.length; index += 1) {
        const sample = source ? source[index] : 0;
        target[index] = driveSample(
          sample,
          constantGains ? inputGain : dbToGain(at(inputGainDb, index)),
          at(drive, index),
          at(mix, index),
          constantGains ? outputGain : dbToGain(at(outputGainDb, index))
        );
      }
    }
    return this.active;
  }
}

registerProcessor("synaptix-reference-drive", SynaptixReferenceDriveProcessor);
`;

/** SHA-256 of REFERENCE_DRIVE_PROCESSOR_SOURCE. Tests fail if the source changes without updating this pin. */
export const REFERENCE_DRIVE_MODULE_CHECKSUM = "ba891f3c3e6a8036c264aba2ab5c442b5fe645dc9242b3293372ae976cd0b34d";

export const REFERENCE_DRIVE_DESCRIPTOR: AudioPluginDescriptor = AudioPluginDescriptorSchema.parse({
  reference: {
    pluginId: REFERENCE_DRIVE_PLUGIN_ID,
    vendorId: "synaptix",
    version: REFERENCE_DRIVE_VERSION,
    runtimeKind: "audio-worklet",
    moduleChecksumSha256: REFERENCE_DRIVE_MODULE_CHECKSUM
  },
  name: "Reference Drive",
  category: "effect",
  buses: { audioInputChannels: [2], audioOutputChannels: [2], midiInput: false },
  parameters: [
    {
      id: REFERENCE_DRIVE_INPUT_GAIN_PARAMETER, label: "Input", kind: "continuous", unit: "db",
      minimum: -24, maximum: 24, defaultValue: 0, automatable: true, automationRate: "a-rate"
    },
    {
      id: REFERENCE_DRIVE_DRIVE_PARAMETER, label: "Drive", kind: "continuous", unit: "none",
      minimum: 1, maximum: 20, defaultValue: 1, automatable: true, automationRate: "a-rate"
    },
    {
      id: REFERENCE_DRIVE_MIX_PARAMETER, label: "Mix", kind: "continuous", unit: "ratio",
      minimum: 0, maximum: 1, defaultValue: 1, automatable: true, automationRate: "a-rate"
    },
    {
      id: REFERENCE_DRIVE_OUTPUT_GAIN_PARAMETER, label: "Output", kind: "continuous", unit: "db",
      minimum: -24, maximum: 24, defaultValue: 0, automatable: true, automationRate: "a-rate"
    }
  ],
  state: { stateVersion: 1, encoding: "json" },
  latency: { latencySamples: 0, tailSeconds: 0 },
  license: {
    licenseId: "LicenseRef-Synaptix-Proprietary",
    licenseTextUri: null,
    localUse: true,
    commercialUse: true,
    redistribution: false,
    cloudRender: true,
    multiUser: true,
    activationRequired: false,
    trademarkRestrictions: []
  },
  provenance: {
    publisher: "Synaptix",
    sourceUri: null,
    reviewStatus: "first-party",
    reviewedAt: null,
    acceptanceEvidence: ["packages/daw-engine/src/reference-drive.test.ts"]
  },
  compatibility: {
    requiresSecureContext: true,
    requiresCrossOriginIsolation: false,
    deterministicProductionRender: false
  }
});

/** A new Reference Drive device at default settings, ready for InsertPluginDeviceEditorCommand. */
export function createReferenceDriveDevice(id: string): DeviceV2 {
  return {
    id,
    deviceType: REFERENCE_DRIVE_PLUGIN_ID,
    deviceVersion: REFERENCE_DRIVE_VERSION,
    enabled: true,
    parameters: REFERENCE_DRIVE_DESCRIPTOR.parameters.map((parameter) => ({ id: parameter.id, value: parameter.defaultValue })),
    plugin: { ...REFERENCE_DRIVE_DESCRIPTOR.reference },
    pluginState: null,
    automation: [],
    frozen: null
  };
}

import type { Device } from "@synaptix/project-model";

export type DeviceParameterUnit = "hz" | "seconds" | "ratio";

export interface DeviceParameterDefinition {
  readonly id: string;
  readonly label: string;
  readonly unit: DeviceParameterUnit;
  readonly minimum: number;
  readonly maximum: number;
}

export const FILTER_FREQUENCY_PARAMETER = "filterFrequency";
export const ENVELOPE_ATTACK_PARAMETER = "envelopeAttack";
export const ENVELOPE_DECAY_PARAMETER = "envelopeDecay";
export const ENVELOPE_SUSTAIN_PARAMETER = "envelopeSustain";
export const ENVELOPE_RELEASE_PARAMETER = "envelopeRelease";
export const REVERB_SEND_PARAMETER = "reverbSend";

export const DEVICE_PARAMETER_DEFINITIONS: readonly DeviceParameterDefinition[] = [
  { id: FILTER_FREQUENCY_PARAMETER, label: "Filter Frequency", unit: "hz", minimum: 80, maximum: 16000 },
  { id: ENVELOPE_ATTACK_PARAMETER, label: "Attack", unit: "seconds", minimum: 0.001, maximum: 2 },
  { id: ENVELOPE_DECAY_PARAMETER, label: "Decay", unit: "seconds", minimum: 0.01, maximum: 2 },
  { id: ENVELOPE_SUSTAIN_PARAMETER, label: "Sustain", unit: "ratio", minimum: 0, maximum: 1 },
  { id: ENVELOPE_RELEASE_PARAMETER, label: "Release", unit: "seconds", minimum: 0.01, maximum: 4 },
  { id: REVERB_SEND_PARAMETER, label: "Reverb Send", unit: "ratio", minimum: 0, maximum: 1 }
];

const DEFINITION_BY_ID = new Map(DEVICE_PARAMETER_DEFINITIONS.map((definition) => [definition.id, definition]));

export function deviceParameterDefinition(id: string): DeviceParameterDefinition | undefined {
  return DEFINITION_BY_ID.get(id);
}

export function clampDeviceParameterValue(id: string, value: number): number {
  const definition = DEFINITION_BY_ID.get(id);
  if (!definition) return value;
  return Math.min(definition.maximum, Math.max(definition.minimum, value));
}

export function resolveDeviceParameterValue(device: Device | undefined, id: string, fallback: number): number {
  const raw = device?.parameters.find((parameter) => parameter.id === id)?.value;
  const candidate = Number.isFinite(raw) ? (raw as number) : fallback;
  return clampDeviceParameterValue(id, candidate);
}

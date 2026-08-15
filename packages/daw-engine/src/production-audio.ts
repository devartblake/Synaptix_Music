import type { Device, Track } from "@synaptix/project-model";

import {
  ENVELOPE_ATTACK_PARAMETER,
  ENVELOPE_DECAY_PARAMETER,
  ENVELOPE_RELEASE_PARAMETER,
  ENVELOPE_SUSTAIN_PARAMETER,
  FILTER_FREQUENCY_PARAMETER,
  resolveDeviceParameterValue,
  REVERB_SEND_PARAMETER
} from "./device-parameters.ts";

export type InstrumentProfileKind = "drums" | "bass" | "poly" | "lead";

const DEFAULT_REVERB_SEND = 0.16;

export interface InstrumentProfile {
  kind: InstrumentProfileKind;
  oscillator: "sine" | "square" | "triangle" | "sawtooth";
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterFrequency: number;
  destinationBus: "music" | "drums";
}

export interface MasterMeterSnapshot {
  peakDbfs: number;
  rmsDbfs: number;
  clipped: boolean;
}

export const SILENT_METER: MasterMeterSnapshot = {
  peakDbfs: Number.NEGATIVE_INFINITY,
  rmsDbfs: Number.NEGATIVE_INFINITY,
  clipped: false
};

export function primaryDevice(track: Track): Device | undefined {
  return track.devices.find((device) => device.enabled);
}

function deviceType(track: Track): string {
  return primaryDevice(track)?.deviceType.toLowerCase() ?? "";
}

export function resolveInstrumentProfile(track: Track): InstrumentProfile {
  const type = deviceType(track);
  const name = track.name.toLowerCase();

  if (type.includes("drum") || name.includes("drum")) {
    return {
      kind: "drums", oscillator: "sine", attack: 0.001, decay: 0.08,
      sustain: 0.05, release: 0.08, filterFrequency: 12000, destinationBus: "drums"
    };
  }
  if (type.includes("bass") || name.includes("bass")) {
    return {
      kind: "bass", oscillator: "square", attack: 0.005, decay: 0.14,
      sustain: 0.45, release: 0.18, filterFrequency: 1800, destinationBus: "music"
    };
  }
  if (type.includes("lead") || name.includes("lead")) {
    return {
      kind: "lead", oscillator: "sawtooth", attack: 0.008, decay: 0.1,
      sustain: 0.3, release: 0.16, filterFrequency: 7000, destinationBus: "music"
    };
  }
  return {
    kind: "poly", oscillator: "triangle", attack: 0.015, decay: 0.18,
    sustain: 0.4, release: 0.3, filterFrequency: 5000, destinationBus: "music"
  };
}

export interface EffectiveInstrumentSettings extends InstrumentProfile {
  reverbSend: number;
}

export function resolveEffectiveInstrumentSettings(track: Track): EffectiveInstrumentSettings {
  const profile = resolveInstrumentProfile(track);
  const device = primaryDevice(track);
  return {
    ...profile,
    filterFrequency: resolveDeviceParameterValue(device, FILTER_FREQUENCY_PARAMETER, profile.filterFrequency),
    attack: resolveDeviceParameterValue(device, ENVELOPE_ATTACK_PARAMETER, profile.attack),
    decay: resolveDeviceParameterValue(device, ENVELOPE_DECAY_PARAMETER, profile.decay),
    sustain: resolveDeviceParameterValue(device, ENVELOPE_SUSTAIN_PARAMETER, profile.sustain),
    release: resolveDeviceParameterValue(device, ENVELOPE_RELEASE_PARAMETER, profile.release),
    reverbSend: resolveDeviceParameterValue(device, REVERB_SEND_PARAMETER, DEFAULT_REVERB_SEND)
  };
}

export function normalizeMeterValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : Math.max(...value);
}

// Below this floor a reading is inaudible silence rather than signal. Without
// clamping, a decaying reverb tail can leave floating-point residue that
// makes 20*log10() report ever-drifting, non-physical values (e.g. -1300
// dBFS) instead of settling at silence once the transport stops.
const METER_FLOOR_DBFS = -90;

function clampToSilence(valueDbfs: number): number {
  return valueDbfs <= METER_FLOOR_DBFS ? Number.NEGATIVE_INFINITY : valueDbfs;
}

export function meterSnapshot(peak: number | readonly number[], rms: number | readonly number[]): MasterMeterSnapshot {
  const peakDbfs = clampToSilence(normalizeMeterValue(peak));
  const rmsDbfs = clampToSilence(normalizeMeterValue(rms));
  return { peakDbfs, rmsDbfs, clipped: peakDbfs >= -0.1 };
}

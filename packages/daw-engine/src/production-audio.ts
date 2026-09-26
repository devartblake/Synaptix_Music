import type { Device, Track } from "@synaptix/project-model";

// Keep the server-side renderer's entry point independent of browser audio.
export { FREQUENCY_DRONE_DEVICE_TYPE, resolveFrequencyDroneDevice } from "./frequency-drone.ts";
export { buildFrequencyDroneRenderPlan, renderFrequencyDroneMono } from "./frequency-drone-render.ts";

import {
  ENVELOPE_ATTACK_PARAMETER,
  ENVELOPE_DECAY_PARAMETER,
  ENVELOPE_RELEASE_PARAMETER,
  ENVELOPE_SUSTAIN_PARAMETER,
  FILTER_FREQUENCY_PARAMETER,
  resolveDeviceParameterValue,
  REVERB_SEND_PARAMETER
} from "./device-parameters.ts";
import { resolveInstrumentDefinition, type InstrumentProfile } from "./instrument-catalog.ts";

export {
  createInstrumentTrack,
  INSTRUMENT_CATALOG,
  instrumentDefinition,
  resolveInstrumentDefinition,
  type CreateInstrumentTrackOptions,
  type InstrumentDefinition,
  type InstrumentOscillator,
  type InstrumentProfile,
  type InstrumentProfileKind
} from "./instrument-catalog.ts";

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
  return { ...resolveInstrumentDefinition(deviceType(track), track.name).profile };
}

export type EffectiveInstrumentSettings = InstrumentProfile;

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
    reverbSend: track.reverbSend ?? resolveDeviceParameterValue(device, REVERB_SEND_PARAMETER, profile.reverbSend)
  };
}

export function resolveTrackOutput(track: Track): "music" | "drums" | "master" {
  return track.outputBusId === "master" || track.outputBusId === "music" || track.outputBusId === "drums"
    ? track.outputBusId : resolveInstrumentProfile(track).destinationBus;
}

export function resolveTrackSend(track: Track): number {
  return track.reverbSend ?? (track.devices.some((device) => device.deviceType === "synaptix-frequency-drone")
    ? 0 : resolveEffectiveInstrumentSettings(track).reverbSend);
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

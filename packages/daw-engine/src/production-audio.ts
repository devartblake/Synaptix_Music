import type { Track } from "@synaptix/project-model";

export type InstrumentProfileKind = "drums" | "bass" | "poly" | "lead";

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

function deviceType(track: Track): string {
  return track.devices.find((device) => device.enabled)?.deviceType.toLowerCase() ?? "";
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

export function normalizeMeterValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : Math.max(...value);
}

export function meterSnapshot(peak: number | readonly number[], rms: number | readonly number[]): MasterMeterSnapshot {
  const peakDbfs = normalizeMeterValue(peak);
  const rmsDbfs = normalizeMeterValue(rms);
  return { peakDbfs, rmsDbfs, clipped: peakDbfs >= -0.1 };
}

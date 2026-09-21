export const FREQUENCY_DRONE_PRESETS = [
  { id: "174", name: "174 Hz", frequencyHz: 174 },
  { id: "285", name: "285 Hz", frequencyHz: 285 },
  { id: "396", name: "396 Hz", frequencyHz: 396 },
  { id: "417", name: "417 Hz", frequencyHz: 417 },
  { id: "528", name: "528 Hz", frequencyHz: 528 },
  { id: "639", name: "639 Hz", frequencyHz: 639 },
  { id: "741", name: "741 Hz", frequencyHz: 741 },
  { id: "852", name: "852 Hz", frequencyHz: 852 },
  { id: "963", name: "963 Hz", frequencyHz: 963 }
] as const;

export type DroneWaveform = "sine" | "triangle" | "sawtooth" | "square";

export interface FrequencyDroneSettings {
  frequencyHz: number;
  waveform: DroneWaveform;
  gain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  stereoDetuneHz: number;
}

export const DEFAULT_FREQUENCY_DRONE_SETTINGS: FrequencyDroneSettings = {
  frequencyHz: 528,
  waveform: "sine",
  gain: 0.12,
  fadeInSeconds: 0.5,
  fadeOutSeconds: 0.5,
  stereoDetuneHz: 0
};

export function clampDroneSettings(settings: FrequencyDroneSettings): FrequencyDroneSettings {
  return {
    ...settings,
    frequencyHz: Math.min(20_000, Math.max(20, settings.frequencyHz)),
    gain: Math.min(0.35, Math.max(0, settings.gain)),
    fadeInSeconds: Math.min(10, Math.max(0.01, settings.fadeInSeconds)),
    fadeOutSeconds: Math.min(10, Math.max(0.01, settings.fadeOutSeconds)),
    stereoDetuneHz: Math.min(40, Math.max(0, settings.stereoDetuneHz))
  };
}

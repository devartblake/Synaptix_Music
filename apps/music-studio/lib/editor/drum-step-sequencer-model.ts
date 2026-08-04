import type { MusicProject } from "@synaptix/project-model";

type Track = MusicProject["tracks"][number];
type MidiClip = Extract<Track["clips"][number], { kind: "midi" }>;
type MidiNote = MidiClip["notes"][number];

export interface DrumLane {
  id: string;
  label: string;
  pitch: number;
}

const GENERAL_MIDI_LANES: readonly DrumLane[] = [
  { id: "kick", label: "Kick", pitch: 36 },
  { id: "snare", label: "Snare", pitch: 38 },
  { id: "clap", label: "Clap", pitch: 39 },
  { id: "closed-hat", label: "Closed Hat", pitch: 42 },
  { id: "open-hat", label: "Open Hat", pitch: 46 },
  { id: "low-tom", label: "Low Tom", pitch: 45 },
  { id: "mid-tom", label: "Mid Tom", pitch: 47 },
  { id: "high-tom", label: "High Tom", pitch: 50 }
];

export function isDrumTrack(track: Track): boolean {
  return track.devices.some((device) => device.deviceType.toLowerCase().includes("drum"));
}

export function resolveDrumLanes(track: Track): DrumLane[] {
  const device = track.devices.find((candidate) => candidate.deviceType.toLowerCase().includes("drum"));
  if (!device) return [...GENERAL_MIDI_LANES];

  return GENERAL_MIDI_LANES.map((lane) => {
    const override = device.parameters.find(
      (parameter) => parameter.id === `drum-map.${lane.id}` || parameter.id === `drumMap.${lane.id}`
    );
    const pitch = override && Number.isInteger(override.value) && override.value >= 0 && override.value <= 127
      ? override.value
      : lane.pitch;
    return { ...lane, pitch };
  });
}

export function ticksPerBar(project: MusicProject): number {
  const beats = project.timeSignatureMap[0]?.numerator ?? 4;
  return project.transport.ticksPerQuarterNote * beats;
}

export function ticksPerStep(project: MusicProject): number {
  return ticksPerBar(project) / 16;
}

export function noteAtStep(
  notes: readonly MidiNote[],
  pitch: number,
  absoluteStep: number,
  stepTicks: number
): MidiNote | undefined {
  const startTick = absoluteStep * stepTicks;
  return notes.find((note) => note.pitch === pitch && note.startTick === startTick);
}

export function notesInBar(notes: readonly MidiNote[], bar: number, barTicks: number): MidiNote[] {
  const start = bar * barTicks;
  const end = start + barTicks;
  return notes.filter((note) => note.startTick >= start && note.startTick < end);
}

export function nextStepVelocity(current: number): number {
  if (current < 80) return 100;
  if (current < 115) return 127;
  return 64;
}

export function playbackStep(elapsedMilliseconds: number, bpm: number, patternBars: number): number {
  const safeBpm = Math.max(20, Math.min(400, bpm));
  const millisecondsPerStep = 60_000 / safeBpm / 4;
  const totalSteps = Math.max(16, patternBars * 16);
  return Math.floor(elapsedMilliseconds / millisecondsPerStep) % totalSteps;
}

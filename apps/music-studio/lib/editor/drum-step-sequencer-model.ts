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

/** The Drum Kit instrument (synthesized kit on the General MIDI map; see the instrument catalog). */
export const DRUM_KIT_DEVICE_TYPE = "synaptix-beat-kit";

// Everything the Drum Kit plays: the General MIDI lanes plus rim, crash and ride.
const DRUM_KIT_LANES: readonly DrumLane[] = [
  { id: "kick", label: "Kick", pitch: 36 },
  { id: "rim", label: "Rim", pitch: 37 },
  { id: "snare", label: "Snare", pitch: 38 },
  { id: "clap", label: "Clap", pitch: 39 },
  { id: "closed-hat", label: "Closed Hat", pitch: 42 },
  { id: "open-hat", label: "Open Hat", pitch: 46 },
  { id: "low-tom", label: "Low Tom", pitch: 45 },
  { id: "mid-tom", label: "Mid Tom", pitch: 47 },
  { id: "high-tom", label: "High Tom", pitch: 50 },
  { id: "crash", label: "Crash", pitch: 49 },
  { id: "ride", label: "Ride", pitch: 51 }
];

function isDrumDeviceType(deviceType: string): boolean {
  const type = deviceType.toLowerCase();
  return type.includes("drum") || type === DRUM_KIT_DEVICE_TYPE;
}

export function isDrumTrack(track: Track): boolean {
  return track.devices.some((device) => isDrumDeviceType(device.deviceType));
}

export function resolveDrumLanes(track: Track): DrumLane[] {
  const device = track.devices.find((candidate) => isDrumDeviceType(candidate.deviceType));
  if (!device) return [...GENERAL_MIDI_LANES];
  const lanes = device.deviceType === DRUM_KIT_DEVICE_TYPE ? DRUM_KIT_LANES : GENERAL_MIDI_LANES;

  return lanes.map((lane) => {
    const override = device.parameters.find(
      (parameter) => parameter.id === `drum-map.${lane.id}` || parameter.id === `drumMap.${lane.id}`
    );
    const pitch = override && Number.isInteger(override.value) && override.value >= 0 && override.value <= 127
      ? override.value
      : lane.pitch;
    return { ...lane, pitch };
  });
}

/**
 * What a note plays on a drum track, for the piano roll: its lane's name, or on the Drum Kit the
 * drum the kit plays for that note (the kernel's map: 36 and below kick, unmapped notes toms).
 * Null when the track isn't a drum track, or a drum synth plays the note as a plain pitch.
 */
export function drumNoteName(track: Track, pitch: number): string | null {
  if (!isDrumTrack(track)) return null;
  const lane = resolveDrumLanes(track).find((candidate) => candidate.pitch === pitch);
  if (lane) return lane.label;
  if (!track.devices.some((device) => device.deviceType === DRUM_KIT_DEVICE_TYPE)) return null;
  if (pitch <= 36) return "Kick";
  if (pitch === 40) return "Snare";
  if (pitch === 44) return "Closed Hat";
  if ([52, 55, 57].includes(pitch)) return "Crash";
  if ([53, 59].includes(pitch)) return "Ride";
  return "Tom";
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

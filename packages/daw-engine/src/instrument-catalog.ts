import type { Clip, Track } from "@synaptix/project-model";

export type InstrumentProfileKind =
  | "drums" | "bass" | "poly" | "lead"
  | "sub-bass" | "pad" | "pluck" | "keys" | "organ" | "strings" | "brass" | "bell";

export type InstrumentOscillator = "sine" | "square" | "triangle" | "sawtooth";

export interface InstrumentProfile {
  kind: InstrumentProfileKind;
  oscillator: InstrumentOscillator;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterFrequency: number;
  reverbSend: number;
  destinationBus: "music" | "drums";
}

/** One step of a one-bar starter phrase: beat offset, MIDI pitch, length in beats. */
export type StarterStep = readonly [beat: number, pitch: number, beats: number];

export interface InstrumentDefinition {
  /** Canonical device type persisted on the track's device. */
  deviceType: string;
  label: string;
  description: string;
  /** Substrings matched against a device type, then a track name, to pick this profile. */
  keywords: readonly string[];
  profile: InstrumentProfile;
  starterPattern: readonly StarterStep[];
}

const DEFAULT_REVERB_SEND = 0.16;

// Order matters: the first entry whose keyword matches wins, so more specific
// keywords ("sub-bass") come before the ones they contain ("bass").
export const INSTRUMENT_CATALOG: readonly InstrumentDefinition[] = [
  {
    deviceType: "synaptix-drum-synth", label: "Drum Synth", description: "Short sine hits routed to the drums bus.",
    keywords: ["drum"],
    profile: { kind: "drums", oscillator: "sine", attack: 0.001, decay: 0.08, sustain: 0.05, release: 0.08,
      filterFrequency: 12000, reverbSend: DEFAULT_REVERB_SEND, destinationBus: "drums" },
    starterPattern: [[0, 36, 0.25], [1, 38, 0.25], [2, 36, 0.25], [2.5, 36, 0.25], [3, 38, 0.25]]
  },
  {
    deviceType: "synaptix-sub-bass", label: "Sub Bass", description: "Pure sine low end with a tight low-pass.",
    keywords: ["sub-bass", "sub bass", "808"],
    profile: { kind: "sub-bass", oscillator: "sine", attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.12,
      filterFrequency: 600, reverbSend: 0, destinationBus: "music" },
    starterPattern: [[0, 33, 1.5], [2, 33, 0.75], [3, 36, 0.75]]
  },
  {
    deviceType: "synaptix-bass-synth", label: "Bass Synth", description: "Punchy square bass.",
    keywords: ["bass"],
    profile: { kind: "bass", oscillator: "square", attack: 0.005, decay: 0.14, sustain: 0.45, release: 0.18,
      filterFrequency: 1800, reverbSend: DEFAULT_REVERB_SEND, destinationBus: "music" },
    starterPattern: [[0, 45, 0.75], [1, 45, 0.75], [2, 48, 0.75], [3, 50, 0.75]]
  },
  {
    deviceType: "synaptix-lead-synth", label: "Lead Synth", description: "Bright sawtooth lead.",
    keywords: ["lead"],
    profile: { kind: "lead", oscillator: "sawtooth", attack: 0.008, decay: 0.1, sustain: 0.3, release: 0.16,
      filterFrequency: 7000, reverbSend: DEFAULT_REVERB_SEND, destinationBus: "music" },
    starterPattern: [[0, 72, 0.75], [1, 76, 0.75], [2, 79, 0.75], [3, 77, 0.75]]
  },
  {
    deviceType: "synaptix-pad", label: "Warm Pad", description: "Slow-swelling triangle pad with long release.",
    keywords: ["pad"],
    profile: { kind: "pad", oscillator: "triangle", attack: 0.6, decay: 0.8, sustain: 0.75, release: 1.4,
      filterFrequency: 2800, reverbSend: 0.35, destinationBus: "music" },
    starterPattern: [[0, 57, 4], [0, 60, 4], [0, 64, 4]]
  },
  {
    deviceType: "synaptix-pluck", label: "Pluck", description: "Short, percussive sawtooth pluck for arps and hooks.",
    keywords: ["pluck"],
    profile: { kind: "pluck", oscillator: "sawtooth", attack: 0.002, decay: 0.22, sustain: 0.02, release: 0.12,
      filterFrequency: 3200, reverbSend: 0.22, destinationBus: "music" },
    starterPattern: [[0, 69, 0.25], [0.5, 72, 0.25], [1, 76, 0.25], [1.5, 72, 0.25],
      [2, 69, 0.25], [2.5, 72, 0.25], [3, 76, 0.25], [3.5, 79, 0.25]]
  },
  {
    deviceType: "synaptix-electric-piano", label: "Electric Piano", description: "Soft sine keys with a natural decay.",
    keywords: ["piano", "keys", "rhodes"],
    profile: { kind: "keys", oscillator: "sine", attack: 0.004, decay: 0.6, sustain: 0.25, release: 0.45,
      filterFrequency: 6000, reverbSend: 0.2, destinationBus: "music" },
    starterPattern: [[0, 60, 1.5], [0, 64, 1.5], [0, 67, 1.5], [2, 59, 1.5], [2, 62, 1.5], [2, 67, 1.5]]
  },
  {
    deviceType: "synaptix-organ", label: "Organ", description: "Sustained square organ with a quick release.",
    keywords: ["organ"],
    profile: { kind: "organ", oscillator: "square", attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.08,
      filterFrequency: 3200, reverbSend: 0.18, destinationBus: "music" },
    starterPattern: [[0, 53, 2], [0, 57, 2], [0, 60, 2], [2, 55, 2], [2, 59, 2], [2, 62, 2]]
  },
  {
    deviceType: "synaptix-strings", label: "String Ensemble", description: "Bowed sawtooth strings with a soft attack.",
    keywords: ["string"],
    profile: { kind: "strings", oscillator: "sawtooth", attack: 0.35, decay: 0.4, sustain: 0.8, release: 0.9,
      filterFrequency: 3600, reverbSend: 0.3, destinationBus: "music" },
    starterPattern: [[0, 64, 2], [0, 69, 2], [2, 62, 2], [2, 67, 2]]
  },
  {
    deviceType: "synaptix-brass", label: "Brass Section", description: "Filtered sawtooth stabs with a brassy swell.",
    keywords: ["brass", "horn"],
    profile: { kind: "brass", oscillator: "sawtooth", attack: 0.06, decay: 0.2, sustain: 0.7, release: 0.2,
      filterFrequency: 2400, reverbSend: 0.18, destinationBus: "music" },
    starterPattern: [[0, 60, 0.5], [0, 64, 0.5], [1.5, 62, 0.5], [1.5, 65, 0.5], [3, 64, 0.75], [3, 67, 0.75]]
  },
  {
    deviceType: "synaptix-bell", label: "Bell", description: "Glassy sine bell with a long ring-out.",
    keywords: ["bell", "mallet", "chime"],
    profile: { kind: "bell", oscillator: "sine", attack: 0.001, decay: 1.2, sustain: 0.05, release: 1.6,
      filterFrequency: 9000, reverbSend: 0.3, destinationBus: "music" },
    starterPattern: [[0, 84, 1], [1.5, 88, 1], [3, 91, 1]]
  },
  {
    deviceType: "synaptix-poly-synth", label: "Poly Synth", description: "General-purpose triangle poly synth.",
    keywords: ["poly"],
    profile: { kind: "poly", oscillator: "triangle", attack: 0.015, decay: 0.18, sustain: 0.4, release: 0.3,
      filterFrequency: 5000, reverbSend: DEFAULT_REVERB_SEND, destinationBus: "music" },
    starterPattern: [[0, 57, 1], [1, 60, 1], [2, 64, 1], [3, 67, 1]]
  }
];

const FALLBACK_INSTRUMENT = INSTRUMENT_CATALOG.find((entry) => entry.profile.kind === "poly")!;

function matchKeyword(value: string): InstrumentDefinition | undefined {
  if (!value) return undefined;
  return INSTRUMENT_CATALOG.find((entry) => entry.keywords.some((keyword) => value.includes(keyword)));
}

/**
 * Device type wins over track name so an explicitly chosen instrument is never
 * overridden by what the track happens to be called; the name is a fallback for
 * generic devices (e.g. a poly synth on a track named "Bass").
 */
export function resolveInstrumentDefinition(deviceType: string, trackName: string): InstrumentDefinition {
  const type = deviceType.toLowerCase();
  const byType = matchKeyword(type);
  if (byType && byType !== FALLBACK_INSTRUMENT) return byType;
  return matchKeyword(trackName.toLowerCase()) ?? byType ?? FALLBACK_INSTRUMENT;
}

export function instrumentDefinition(deviceType: string): InstrumentDefinition | undefined {
  return INSTRUMENT_CATALOG.find((entry) => entry.deviceType === deviceType);
}

export interface CreateInstrumentTrackOptions {
  id?: string;
  bars?: number;
  beatsPerBar?: number;
  ticksPerQuarterNote?: number;
}

/** Builds a new instrument track with a looping starter phrase ready to edit in the piano roll. */
export function createInstrumentTrack(deviceType: string, options: CreateInstrumentTrackOptions = {}): Track {
  const definition = instrumentDefinition(deviceType);
  if (!definition) throw new Error(`Unknown instrument '${deviceType}'.`);
  const id = options.id ?? crypto.randomUUID();
  const bars = Math.max(1, Math.round(options.bars ?? 4));
  const beatsPerBar = options.beatsPerBar ?? 4;
  const ppq = options.ticksPerQuarterNote ?? 960;
  const ticksPerBar = beatsPerBar * ppq;
  const clipId = `clip-${id}`;
  const steps = definition.starterPattern.filter(([beat]) => beat < beatsPerBar);
  const clip: Clip = {
    id: clipId,
    kind: "midi",
    name: `${definition.label} Starter`,
    range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: bars * ticksPerBar },
    loop: true,
    notes: Array.from({ length: bars }, (_, bar) => steps.map(([beat, pitch, beats], step) => ({
      id: `${clipId}-note-${bar}-${step}`,
      pitch,
      velocity: beat === 0 ? 104 : 88,
      startTick: bar * ticksPerBar + Math.round(beat * ppq),
      durationTicks: Math.max(1, Math.round(Math.min(beats, beatsPerBar - beat) * ppq))
    }))).flat()
  };
  return {
    id: `track-${id}`,
    name: definition.label,
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: definition.profile.kind === "sub-bass" ? -6 : -10,
    pan: 0,
    devices: [{ id: `device-${id}`, deviceType: definition.deviceType, deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: [clip]
  };
}

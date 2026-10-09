import type { Clip, Track } from "@synaptix/project-model";

export type InstrumentProfileKind =
  | "drums" | "bass" | "poly" | "lead"
  | "sub-bass" | "pad" | "pluck" | "keys" | "organ" | "strings" | "brass" | "bell";

export type InstrumentOscillator = "sine" | "square" | "triangle" | "sawtooth" | "supersaw" | "plucked-string" | "fm-bell" | "fm-piano" | "drum-kit" | "808-bass" | "pulse-25";

export interface InstrumentProfile {
  kind: InstrumentProfileKind;
  oscillator: InstrumentOscillator;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterFrequency: number;
  /** Resonant filter amount, 0–1 (0, the default, is the plain one-pole low-pass). */
  resonance?: number;
  /** Modulation defaults (see device-parameters); omitted means none. */
  lfoRate?: number;
  vibratoCents?: number;
  lfoCutoffOctaves?: number;
  tremolo?: number;
  filterEnvOctaves?: number;
  filterEnvDecay?: number;
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
  },
  // Device types avoid other entries' keywords ("lead", "pad") so they match themselves.
  {
    deviceType: "synaptix-supersaw", label: "Supersaw Lead", description: "Seven detuned saws: a wide, bright trance lead.",
    keywords: ["supersaw", "trance"],
    profile: { kind: "lead", oscillator: "supersaw", attack: 0.01, decay: 0.25, sustain: 0.7, release: 0.3,
      filterFrequency: 6500, reverbSend: 0.25, destinationBus: "music" },
    starterPattern: [[0, 72, 0.75], [1, 74, 0.75], [2, 76, 0.75], [3, 79, 0.75]]
  },
  {
    deviceType: "synaptix-unison", label: "Unison Pad", description: "Slow, lush pad of seven detuned saws.",
    keywords: ["unison"],
    profile: { kind: "pad", oscillator: "supersaw", attack: 0.45, decay: 0.7, sustain: 0.8, release: 1.2,
      filterFrequency: 3200, reverbSend: 0.35, destinationBus: "music" },
    starterPattern: [[0, 57, 4], [0, 60, 4], [0, 64, 4], [0, 69, 4]]
  },
  {
    deviceType: "synaptix-guitar", label: "Plucked String", description: "Karplus–Strong string: guitar, harp and koto colours.",
    keywords: ["guitar", "harp", "koto", "karplus"],
    profile: { kind: "pluck", oscillator: "plucked-string", attack: 0.001, decay: 2, sustain: 0.6, release: 0.25,
      filterFrequency: 7000, reverbSend: 0.22, destinationBus: "music" },
    starterPattern: [[0, 52, 1], [0.5, 59, 1], [1, 64, 1], [1.5, 67, 1], [2, 71, 1], [2.5, 67, 1], [3, 64, 1], [3.5, 59, 0.5]]
  },
  {
    deviceType: "synaptix-fm-glass", label: "FM Bell", description: "Two-operator FM: glassy, inharmonic bell that mellows as it rings.",
    keywords: ["fm-glass", "fm bell"],
    profile: { kind: "bell", oscillator: "fm-bell", attack: 0.001, decay: 1.5, sustain: 0.25, release: 1.6,
      filterFrequency: 12000, reverbSend: 0.3, destinationBus: "music" },
    starterPattern: [[0, 76, 1], [1, 79, 1], [2, 84, 1.5], [3.5, 83, 0.5]]
  },
  {
    deviceType: "synaptix-fm-ep", label: "FM Electric Piano", description: "Two-operator FM keys: bright attack, mellow body.",
    keywords: ["fm-ep", "fm piano"],
    profile: { kind: "keys", oscillator: "fm-piano", attack: 0.002, decay: 1.2, sustain: 0.35, release: 0.4,
      filterFrequency: 9000, reverbSend: 0.18, destinationBus: "music" },
    starterPattern: [[0, 60, 1.5], [0, 64, 1.5], [0, 67, 1.5], [2, 62, 1.5], [2, 65, 1.5], [2, 69, 1.5]]
  },
  {
    // The note picks the drum (General MIDI): 36 kick, 37 rim, 38 snare, 39 clap, 42 closed hat,
    // 46 open hat, 49 crash, 51 ride; other notes are toms tuned to the note.
    deviceType: "synaptix-beat-kit", label: "Drum Kit", description: "Kick, snare, clap, hats, cymbals and toms on the General MIDI drum map.",
    keywords: ["beat-kit", "beat kit"],
    profile: { kind: "drums", oscillator: "drum-kit", attack: 0.001, decay: 0.01, sustain: 1, release: 0.6,
      filterFrequency: 16000, reverbSend: 0.1, destinationBus: "drums" },
    starterPattern: [[0, 36, 0.25], [0, 42, 0.25], [0.5, 42, 0.25], [1, 38, 0.25], [1, 42, 0.25], [1.5, 42, 0.25],
      [2, 36, 0.25], [2, 42, 0.25], [2.5, 36, 0.25], [2.5, 42, 0.25], [3, 38, 0.25], [3, 42, 0.25], [3.5, 46, 0.5]]
  },
  {
    // "808" and "bass" are Sub Bass / Bass Synth keywords, so the device type avoids both.
    deviceType: "synaptix-boom", label: "808 Bass", description: "Long, boomy sine bass that drops onto its note, with soft saturation.",
    keywords: ["synaptix-boom", "boom"],
    profile: { kind: "bass", oscillator: "808-bass", attack: 0.002, decay: 2, sustain: 0.3, release: 0.4,
      filterFrequency: 5000, reverbSend: 0.05, destinationBus: "music" },
    starterPattern: [[0, 33, 1.5], [1.5, 33, 0.5], [2, 36, 1], [3, 31, 1]]
  },
  {
    deviceType: "synaptix-chiptune", label: "Chiptune Lead", description: "Band-limited 25% pulse: the bright, nasal lead of retro game music.",
    keywords: ["chiptune", "8-bit", "retro"],
    profile: { kind: "lead", oscillator: "pulse-25", attack: 0.001, decay: 0.08, sustain: 0.7, release: 0.04,
      filterFrequency: 12000, reverbSend: 0.08, destinationBus: "music" },
    starterPattern: [[0, 72, 0.25], [0.25, 76, 0.25], [0.5, 79, 0.25], [0.75, 84, 0.25], [1, 83, 0.5], [1.5, 79, 0.5],
      [2, 81, 0.75], [3, 79, 0.5], [3.5, 76, 0.5]]
  },
  {
    // A squelchy 303-style line: a resonant saw whose cutoff snaps up on every note and falls
    // back (filter envelope). "acid" and "bass" are avoided in the device type (Bass Synth).
    deviceType: "synaptix-squelch", label: "Acid Bass", description: "Resonant saw with a snappy filter envelope: the 303 squelch.",
    keywords: ["squelch", "acid"],
    profile: { kind: "bass", oscillator: "sawtooth", attack: 0.002, decay: 0.3, sustain: 0.5, release: 0.08,
      filterFrequency: 350, resonance: 0.65, filterEnvOctaves: 3.5, filterEnvDecay: 0.12,
      reverbSend: 0.06, destinationBus: "music" },
    starterPattern: [[0, 36, 0.25], [0.5, 36, 0.25], [0.75, 48, 0.25], [1.25, 39, 0.25], [1.5, 36, 0.25],
      [2, 43, 0.5], [2.5, 36, 0.25], [3, 46, 0.25], [3.5, 41, 0.5]]
  },
  {
    // A slow, breathing pad: the LFO sweeps the cutoff and adds a touch of vibrato. "pad" is
    // avoided in the device type (Warm Pad).
    deviceType: "synaptix-motion", label: "Motion Pad", description: "Supersaw pad whose filter slowly breathes, with gentle vibrato.",
    keywords: ["motion"],
    profile: { kind: "pad", oscillator: "supersaw", attack: 0.5, decay: 0.6, sustain: 0.8, release: 1.4,
      filterFrequency: 1200, resonance: 0.25, lfoRate: 0.25, lfoCutoffOctaves: 1.2, vibratoCents: 6,
      reverbSend: 0.35, destinationBus: "music" },
    starterPattern: [[0, 53, 4], [0, 57, 4], [0, 60, 4], [0, 64, 4]]
  },
  // Slice 3: instruments made only from existing kernel features (no new synthesis code).
  {
    deviceType: "synaptix-wobble", label: "Wobble Bass", description: "Resonant saw whose filter wobbles: the dubstep wub.",
    keywords: ["wobble", "dubstep"],
    profile: { kind: "bass", oscillator: "sawtooth", attack: 0.005, decay: 0.2, sustain: 0.85, release: 0.12,
      filterFrequency: 260, resonance: 0.55, lfoRate: 2, lfoCutoffOctaves: 2.5,
      reverbSend: 0.06, destinationBus: "music" },
    starterPattern: [[0, 33, 1.5], [1.5, 33, 0.5], [2, 36, 1], [3, 31, 1]]
  },
  {
    deviceType: "synaptix-reese", label: "Reese Bass", description: "Detuned saws with a slowly drifting filter: dark, moving bass.",
    keywords: ["reese"],
    profile: { kind: "bass", oscillator: "supersaw", attack: 0.01, decay: 0.3, sustain: 0.9, release: 0.2,
      filterFrequency: 650, resonance: 0.2, lfoRate: 0.3, lfoCutoffOctaves: 1,
      reverbSend: 0.06, destinationBus: "music" },
    starterPattern: [[0, 31, 2], [2, 34, 1], [3, 29, 1]]
  },
  {
    deviceType: "synaptix-ensemble", label: "Ensemble Strings", description: "Wide, singing string section with gentle vibrato.",
    keywords: ["ensemble"],
    profile: { kind: "strings", oscillator: "supersaw", attack: 0.35, decay: 0.5, sustain: 0.85, release: 0.9,
      filterFrequency: 4200, lfoRate: 5, vibratoCents: 8,
      reverbSend: 0.3, destinationBus: "music" },
    starterPattern: [[0, 55, 2], [0, 59, 2], [0, 62, 2], [2, 57, 2], [2, 60, 2], [2, 64, 2]]
  },
  {
    // "trance" and "pluck" are other instruments' keywords, so the device type avoids both.
    deviceType: "synaptix-uplift", label: "Trance Pluck", description: "Short, bright supersaw stab with a snappy filter.",
    keywords: ["uplift"],
    profile: { kind: "pluck", oscillator: "supersaw", attack: 0.002, decay: 0.25, sustain: 0, release: 0.2,
      filterFrequency: 700, resonance: 0.3, filterEnvOctaves: 4, filterEnvDecay: 0.12,
      reverbSend: 0.25, destinationBus: "music" },
    starterPattern: [[0, 69, 0.25], [0.5, 72, 0.25], [1, 76, 0.25], [1.5, 72, 0.25], [2, 69, 0.25], [2.5, 76, 0.25], [3, 74, 0.5]]
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

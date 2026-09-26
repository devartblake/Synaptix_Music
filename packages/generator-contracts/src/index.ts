import { z } from "zod";

const MusicalPositionSchema = z.object({
  bar: z.number().int().nonnegative(),
  beat: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative()
});

const MusicalRangeSchema = z.object({
  start: MusicalPositionSchema,
  durationTicks: z.number().int().positive()
});

const MidiNoteSchema = z.object({
  id: z.string().min(1),
  pitch: z.number().int().min(0).max(127),
  velocity: z.number().int().min(1).max(127),
  startTick: z.number().int().nonnegative(),
  durationTicks: z.number().int().positive()
});

/** Key tonics, spelled as the generation service and studio display them. */
export const KEY_TONICS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

/** Scale modes, with how each tends to feel. Mirrors app/generation/theory.py. */
export const KEY_MODES = [
  { id: "major", label: "Major", character: "Bright, heroic, optimistic" },
  { id: "minor", label: "Minor", character: "Serious, driven, a little melancholy" },
  { id: "dorian", label: "Dorian", character: "Cool and adventurous" },
  { id: "phrygian", label: "Phrygian", character: "Dark, exotic, menacing" },
  { id: "lydian", label: "Lydian", character: "Dreamy, magical, floating" },
  { id: "mixolydian", label: "Mixolydian", character: "Bluesy, playful, upbeat" },
  { id: "harmonic minor", label: "Harmonic minor", character: "Dramatic, villainous" }
] as const;

export type KeyTonic = (typeof KEY_TONICS)[number];
export type KeyMode = (typeof KEY_MODES)[number]["id"];
export type GenerationKey = `${KeyTonic} ${KeyMode}`;

export const GENERATION_KEYS = KEY_MODES.flatMap((mode) =>
  KEY_TONICS.map((tonic) => `${tonic} ${mode.id}` as GenerationKey)
) as [GenerationKey, ...GenerationKey[]];

export function composeKey(tonic: KeyTonic, mode: KeyMode): GenerationKey {
  return `${tonic} ${mode}`;
}

/** Splits "F# harmonic minor" into its tonic and mode. */
export function splitKey(key: GenerationKey): { tonic: KeyTonic; mode: KeyMode } {
  const space = key.indexOf(" ");
  return { tonic: key.slice(0, space) as KeyTonic, mode: key.slice(space + 1) as KeyMode };
}

export const GenerationRequestSchema = z.object({
  projectId: z.string().min(1),
  genre: z.literal("electronic-trivia").default("electronic-trivia"),
  mood: z.enum(["upbeat", "tense", "triumphant"]).default("upbeat"),
  tempo: z.number().int().min(60).max(200).default(120),
  key: z.enum(GENERATION_KEYS).default("D minor"),
  durationBars: z.number().int().min(8).max(64).default(16),
  energy: z.number().min(0).max(1).default(0.6),
  complexity: z.number().min(0).max(1).default(0.5),
  seed: z.number().int().min(0).max(2_147_483_647).default(1),
  /** Free-text creative direction; AI composers read it, the procedural one ignores it. */
  brief: z.string().max(2000).optional()
});

export const GeneratorIdSchema = z.enum([
  "synaptix-procedural-composer",
  "synaptix-claude-composer",
  "synaptix-local-composer"
]);

export const GeneratedSectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["intro", "main", "tension", "victory"]),
  name: z.string().min(1),
  startBar: z.number().int().nonnegative(),
  bars: z.number().int().positive()
});

export const GeneratedMidiClipSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  range: MusicalRangeSchema,
  loop: z.boolean(),
  notes: z.array(MidiNoteSchema)
});

/** Track roles: the four core parts plus supporting layers written from the chords. */
export const GeneratedTrackRoleSchema = z.enum([
  "drums",
  "bass",
  "sub-bass",
  "harmony",
  "pad",
  "arpeggio",
  "melody",
  "countermelody",
  "stabs",
  "sparkle"
]);

export const GeneratedTrackSchema = z.object({
  id: z.string().min(1),
  role: GeneratedTrackRoleSchema,
  name: z.string().min(1),
  /** A studio instrument catalog device type. */
  instrumentId: z.string().min(1),
  clips: z.array(GeneratedMidiClipSchema),
  /** Suggested mix; the studio uses 0 dB, centre and no send when absent. */
  volumeDb: z.number().min(-60).max(6).nullable().optional(),
  pan: z.number().min(-1).max(1).nullable().optional(),
  reverbSend: z.number().min(0).max(1).nullable().optional()
});

export const GenerationProposalSchema = z.object({
  operation: z.literal("create-arrangement"),
  projectId: z.string().min(1),
  genre: z.literal("electronic-trivia"),
  mood: z.enum(["upbeat", "tense", "triumphant"]),
  tempo: z.number().int().min(90).max(140),
  key: z.string().min(1),
  ticksPerQuarterNote: z.literal(960),
  sections: z.array(GeneratedSectionSchema).min(3),
  tracks: z.array(GeneratedTrackSchema).min(4),
  provenance: z.object({
    generatorId: GeneratorIdSchema,
    generatorVersion: z.string().min(1),
    seed: z.number().int(),
    /** The model that composed the plan, for AI composers. */
    model: z.string().nullable().optional()
  }),
  warnings: z.array(z.string())
});

export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;
export type GenerationProposal = z.infer<typeof GenerationProposalSchema>;
export type GeneratedTrack = z.infer<typeof GeneratedTrackSchema>;

export * from "./to-project-transaction.ts";

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

export const GenerationRequestSchema = z.object({
  projectId: z.string().min(1),
  genre: z.literal("electronic-trivia").default("electronic-trivia"),
  mood: z.enum(["upbeat", "tense", "triumphant"]).default("upbeat"),
  tempo: z.number().int().min(90).max(140).default(120),
  key: z
    .enum(["C minor", "D minor", "E minor", "F minor", "G minor", "A minor"])
    .default("D minor"),
  durationBars: z.number().int().min(8).max(64).default(16),
  energy: z.number().min(0).max(1).default(0.6),
  complexity: z.number().min(0).max(1).default(0.5),
  seed: z.number().int().min(0).max(2_147_483_647).default(1)
});

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

export const GeneratedTrackSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["drums", "bass", "harmony", "melody"]),
  name: z.string().min(1),
  instrumentId: z.string().min(1),
  clips: z.array(GeneratedMidiClipSchema)
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
    generatorId: z.literal("synaptix-procedural-composer"),
    generatorVersion: z.literal("0.1.0"),
    seed: z.number().int()
  }),
  warnings: z.array(z.string())
});

export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;
export type GenerationProposal = z.infer<typeof GenerationProposalSchema>;
export type GeneratedTrack = z.infer<typeof GeneratedTrackSchema>;

import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = 1 as const;

const IdSchema = z.string().min(1);
const IsoDateSchema = z.string().datetime({ offset: true });

export const MusicalPositionSchema = z.object({
  bar: z.number().int().nonnegative(),
  beat: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative()
});

export const MusicalRangeSchema = z.object({
  start: MusicalPositionSchema,
  durationTicks: z.number().int().positive()
});

export const TempoEventSchema = z.object({
  id: IdSchema,
  position: MusicalPositionSchema,
  bpm: z.number().min(20).max(400)
});

export const TimeSignatureEventSchema = z.object({
  id: IdSchema,
  position: MusicalPositionSchema,
  numerator: z.number().int().min(1).max(32),
  denominator: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32)])
});

export const MidiNoteSchema = z.object({
  id: IdSchema,
  pitch: z.number().int().min(0).max(127),
  velocity: z.number().int().min(1).max(127),
  startTick: z.number().int().nonnegative(),
  durationTicks: z.number().int().positive()
});

export const MidiClipSchema = z.object({
  id: IdSchema,
  kind: z.literal("midi"),
  name: z.string().min(1),
  range: MusicalRangeSchema,
  loop: z.boolean().default(false),
  notes: z.array(MidiNoteSchema)
});

export const AudioClipSchema = z.object({
  id: IdSchema,
  kind: z.literal("audio"),
  name: z.string().min(1),
  range: MusicalRangeSchema,
  loop: z.boolean().default(false),
  assetId: IdSchema,
  sourceOffsetSeconds: z.number().nonnegative().default(0),
  gainDb: z.number().min(-96).max(24).default(0)
});

export const ClipSchema = z.discriminatedUnion("kind", [MidiClipSchema, AudioClipSchema]);

export const DeviceParameterSchema = z.object({
  id: IdSchema,
  value: z.number()
});

export const DeviceSchema = z.object({
  id: IdSchema,
  deviceType: IdSchema,
  deviceVersion: z.string().min(1),
  enabled: z.boolean().default(true),
  parameters: z.array(DeviceParameterSchema).default([])
});

export const TrackSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: z.enum(["instrument", "audio", "bus"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  volumeDb: z.number().min(-96).max(24).default(0),
  pan: z.number().min(-1).max(1).default(0),
  outputBusId: IdSchema.optional(),
  devices: z.array(DeviceSchema).default([]),
  clips: z.array(ClipSchema).default([])
});

export const AssetReferenceSchema = z.object({
  id: IdSchema,
  kind: z.enum(["audio", "soundfont", "impulse-response"]),
  uri: z.string().min(1),
  mediaType: z.string().min(1),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  durationSeconds: z.number().positive().optional(),
  licenseId: IdSchema.optional()
});

export const MarkerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  position: MusicalPositionSchema,
  kind: z.enum(["section", "cue", "loop-start", "loop-end"])
});

export const GenerationMetadataSchema = z.object({
  generatorId: IdSchema,
  generatorVersion: z.string().min(1),
  seed: z.number().int(),
  createdAt: IsoDateSchema,
  prompt: z.string().optional()
});

export const MusicProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  projectId: IdSchema,
  revisionId: IdSchema,
  parentRevisionId: IdSchema.nullable().default(null),
  metadata: z.object({
    name: z.string().min(1),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema
  }),
  transport: z.object({
    ticksPerQuarterNote: z.number().int().positive().default(960),
    loopEnabled: z.boolean().default(false),
    loopRange: MusicalRangeSchema.nullable().default(null)
  }),
  tempoMap: z.array(TempoEventSchema).min(1),
  timeSignatureMap: z.array(TimeSignatureEventSchema).min(1),
  tracks: z.array(TrackSchema),
  assets: z.array(AssetReferenceSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
  generationMetadata: GenerationMetadataSchema.optional()
});

export type MusicalPosition = z.infer<typeof MusicalPositionSchema>;
export type MusicProject = z.infer<typeof MusicProjectSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type DeviceParameter = z.infer<typeof DeviceParameterSchema>;

export interface CreateEmptyProjectOptions {
  revisionId?: string;
  now?: string;
  name?: string;
}

export function createEmptyProject(
  projectId: string,
  options: CreateEmptyProjectOptions = {}
): MusicProject {
  const now = options.now ?? new Date().toISOString();
  const revisionId = options.revisionId ?? crypto.randomUUID();
  const origin = { bar: 0, beat: 0, tick: 0 } as const;

  return MusicProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId,
    revisionId,
    parentRevisionId: null,
    metadata: {
      name: options.name ?? "Untitled Project",
      createdAt: now,
      updatedAt: now
    },
    transport: {
      ticksPerQuarterNote: 960,
      loopEnabled: false,
      loopRange: null
    },
    tempoMap: [{ id: "tempo-1", position: origin, bpm: 120 }],
    timeSignatureMap: [
      { id: "time-signature-1", position: origin, numerator: 4, denominator: 4 }
    ],
    tracks: [],
    assets: [],
    markers: []
  });
}

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

export const MIDI_NOTE_LABEL_MAX_LENGTH = 32;

export const MidiNoteSchema = z.object({
  id: IdSchema,
  pitch: z.number().int().min(0).max(127),
  velocity: z.number().int().min(1).max(127),
  startTick: z.number().int().nonnegative(),
  durationTicks: z.number().int().positive(),
  // A user-chosen name shown on the note (FL Studio's note labels). Optional, and absent when unset,
  // so projects without labels keep their canonical checksum.
  label: z.string().min(1).max(MIDI_NOTE_LABEL_MAX_LENGTH).optional()
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

/**
 * A sticky note: a short piece of text pinned to a track or to the project (in the studio's
 * Notes setting). Notes aren't music, so they are left out of the arrangement fingerprint.
 */
export const STICKY_NOTE_TEXT_MAX_LENGTH = 500;
export const StickyNoteSchema = z.object({
  id: IdSchema,
  text: z.string().min(1).max(STICKY_NOTE_TEXT_MAX_LENGTH)
});
export type StickyNote = z.infer<typeof StickyNoteSchema>;

/** A page of the project's notebook: a title and plain text ("[ ] " and "[x] " lines are a checklist). */
export const NOTEBOOK_TITLE_MAX_LENGTH = 80;
export const NOTEBOOK_BODY_MAX_LENGTH = 20000;
export const NotebookPageSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(NOTEBOOK_TITLE_MAX_LENGTH),
  body: z.string().max(NOTEBOOK_BODY_MAX_LENGTH)
});
export type NotebookPage = z.infer<typeof NotebookPageSchema>;

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
  reverbSend: z.number().min(0).max(1).optional(),
  devices: z.array(DeviceSchema).default([]),
  clips: z.array(ClipSchema).default([]),
  // Optional, and absent when the track has none, so existing tracks keep their checksum.
  stickyNotes: z.array(StickyNoteSchema).min(1).optional()
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

/** The project's key: tonic as a pitch class (0 = C … 11 = B) and one of the generator's seven modes. */
export const MUSICAL_KEY_MODES = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "harmonic minor"] as const;
export const MusicalKeySchema = z.object({
  tonic: z.number().int().min(0).max(11),
  mode: z.enum(MUSICAL_KEY_MODES)
});
export type MusicalKey = z.infer<typeof MusicalKeySchema>;

/** Whether a model's licence lets its output be used commercially (docs/plans/implementation/publication-rules-v1.md). */
export const COMMERCIAL_USE = ["allowed", "not-allowed", "conditional"] as const;
/**
 * The licence facts for generated music. The generation API fills them from its reviewed licence
 * table, never from what a model says about itself; publishing refuses `not-allowed`.
 */
export const GenerationProvenanceSchema = z.object({
  /** The model that actually ran, for AI composers (e.g. a Claude model, or "qwen2.5:7b"). */
  model: z.string().min(1).optional(),
  /** An SPDX identifier or a named licence, e.g. "Apache-2.0", "Anthropic-Commercial-Terms", or "none". */
  licence: z.string().min(1),
  commercialUse: z.enum(COMMERCIAL_USE),
  /** SHA-256 of the request and the arrangement it produced: proves the exact input later without storing it. */
  planSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Credit lines the licence requires, e.g. "Powered by Stability AI". */
  credits: z.array(z.string().min(1)).optional()
});
export type GenerationProvenance = z.infer<typeof GenerationProvenanceSchema>;

export const GenerationMetadataSchema = z.object({
  generatorId: IdSchema,
  generatorVersion: z.string().min(1),
  seed: z.number().int(),
  createdAt: IsoDateSchema,
  prompt: z.string().optional(),
  // The arrangement as generated (see arrangementFingerprint). Optional, and absent on projects
  // generated before it existed, so their checksums don't change.
  arrangementFingerprint: z.string().regex(/^fnv1a64:[0-9a-f]{16}$/).optional(),
  // Licence facts for the generated music. Optional: absent on projects generated before it existed.
  provenance: GenerationProvenanceSchema.optional(),
  // Per clip, each generated note's id and a hash of its pitch, timing and velocity (see editShare).
  generatedNotes: z.record(IdSchema, z.record(IdSchema, z.string().regex(/^[0-9a-f]{8}$/))).optional()
});

export const MixerChannelSchema = z.object({
  volumeDb: z.number().min(-96).max(12).default(0),
  muted: z.boolean().default(false)
});
export const MixerSchema = z.object({
  music: MixerChannelSchema,
  drums: MixerChannelSchema,
  reverb: MixerChannelSchema,
  master: MixerChannelSchema
});
export type MixerChannelId = "music" | "drums" | "reverb" | "master";
export type MixerChannel = z.infer<typeof MixerChannelSchema>;
export function defaultMixer(): z.infer<typeof MixerSchema> {
  return { music: { volumeDb: 0, muted: false }, drums: { volumeDb: 0, muted: false },
    reverb: { volumeDb: 0, muted: false }, master: { volumeDb: 0, muted: false } };
}

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
  // Optional so legacy snapshots retain their canonical checksum.
  mixer: MixerSchema.optional(),
  assets: z.array(AssetReferenceSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
  // Optional, and absent when unset, so projects without a key keep their canonical checksum.
  key: MusicalKeySchema.optional(),
  // The notebook and the project's own sticky notes: optional, and absent when empty.
  notebook: z.array(NotebookPageSchema).min(1).optional(),
  stickyNotes: z.array(StickyNoteSchema).min(1).optional(),
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

/** JSON with object keys sorted at every level and undefined properties left out. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** 64-bit FNV-1a over UTF-16 code units: a fast, deterministic change detector, not a security hash. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The parts of a project, v1 or v2, that make up its music. */
export interface ArrangementSource {
  tracks: ReadonlyArray<Omit<Track, "devices"> & {
    devices: ReadonlyArray<{ id: string; deviceType: string; deviceVersion: string; enabled: boolean; parameters: ReadonlyArray<unknown> }>;
  }>;
  tempoMap: unknown;
  timeSignatureMap: unknown;
  markers: unknown;
  key?: unknown;
  generationMetadata?: z.infer<typeof GenerationMetadataSchema>;
}

/**
 * A fingerprint of the music: tracks (with devices reduced to the fields v1 and v2 share, so a
 * project gets the same fingerprint in either schema), clips and notes, tempo, time signature,
 * markers and key. The name, cover art, metadata, notebook and sticky notes are left out: renaming
 * or annotating isn't editing the music.
 */
export function arrangementFingerprint(project: ArrangementSource): string {
  const tracks = project.tracks.map(({ devices, stickyNotes: _notes, ...track }) => ({
    ...track,
    devices: devices.map(({ id, deviceType, deviceVersion, enabled, parameters }) => ({ id, deviceType, deviceVersion, enabled, parameters }))
  }));
  const music = { tracks, tempoMap: project.tempoMap, timeSignatureMap: project.timeSignatureMap, markers: project.markers, key: project.key };
  return `fnv1a64:${fnv1a64(canonicalJson(music))}`;
}

/** A short hash of what a note plays: pitch, timing and velocity (its id is the key it is stored under). */
export function noteHash(note: { pitch: number; startTick: number; durationTicks: number; velocity: number }): string {
  return fnv1a64(`${note.pitch}:${note.startTick}:${note.durationTicks}:${note.velocity}`).slice(0, 8);
}

/** Every MIDI note in the project, by clip: the record kept when a generated arrangement is applied. */
export function generatedNoteHashes(project: ArrangementSource): Record<string, Record<string, string>> {
  const clips: Record<string, Record<string, string>> = {};
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind !== "midi") continue;
      clips[clip.id] = Object.fromEntries(clip.notes.map((note) => [note.id, noteHash(note)]));
    }
  }
  return clips;
}

/**
 * How much of the music a person changed, from 0 (as generated) to 1:
 * (generated notes removed or changed + notes added) ÷ (generated notes + notes added).
 * Null when there is no generated-notes record (hand-composed, or generated before it existed).
 */
export function editShare(project: ArrangementSource): number | null {
  const generated = project.generationMetadata?.generatedNotes;
  if (!generated) return null;
  const current = new Map<string, string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind !== "midi") continue;
      for (const note of clip.notes) current.set(`${clip.id}/${note.id}`, noteHash(note));
    }
  }
  let generatedCount = 0;
  let changed = 0;
  const generatedKeys = new Set<string>();
  for (const [clipId, notes] of Object.entries(generated)) {
    for (const [noteId, hash] of Object.entries(notes)) {
      const key = `${clipId}/${noteId}`;
      generatedKeys.add(key);
      generatedCount += 1;
      if (current.get(key) !== hash) changed += 1;
    }
  }
  let added = 0;
  for (const key of current.keys()) if (!generatedKeys.has(key)) added += 1;
  const total = generatedCount + added;
  return total === 0 ? 0 : (changed + added) / total;
}

/**
 * Where a project's music came from: "generated" when a generated arrangement was applied and the
 * music still matches it, "edited" when it was generated and has changed since, "hand" when no
 * generated arrangement was ever applied. Projects generated before the fingerprint existed count as
 * "generated", since their later edits can't be told apart.
 */
export type ProjectOrigin = "generated" | "edited" | "hand";
export function projectOrigin(project: ArrangementSource): ProjectOrigin {
  const generation = project.generationMetadata;
  if (!generation) return "hand";
  if (!generation.arrangementFingerprint) return "generated";
  return arrangementFingerprint(project) === generation.arrangementFingerprint ? "generated" : "edited";
}

/**
 * The provenance record a published package carries (publication-rules-v1, phase 1): where the
 * music came from, its licence and how much a person changed. Built by `packageProvenance`.
 */
export const PackageProvenanceSchema = z.object({
  origin: z.enum(["generated", "edited", "hand"]),
  generatorId: IdSchema.optional(),
  generatorVersion: z.string().min(1).optional(),
  generatedAt: IsoDateSchema.optional(),
  model: z.string().min(1).optional(),
  licence: z.string().min(1).optional(),
  commercialUse: z.enum(COMMERCIAL_USE).optional(),
  planSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  credits: z.array(z.string().min(1)).optional(),
  /** 0 (as generated) to 1; absent when there is no generated-notes record. */
  editShare: z.number().min(0).max(1).optional()
}).strict();
export type PackageProvenance = z.infer<typeof PackageProvenanceSchema>;

/** The provenance record for publishing a project as it stands. */
export function packageProvenance(project: ArrangementSource): PackageProvenance {
  const generation = project.generationMetadata;
  const origin = projectOrigin(project);
  if (!generation) return { origin };
  const share = editShare(project);
  return {
    origin,
    generatorId: generation.generatorId,
    generatorVersion: generation.generatorVersion,
    generatedAt: generation.createdAt,
    ...(generation.provenance ?? {}),
    ...(share === null ? {} : { editShare: share })
  };
}

/** Store disclosure for a package's music (publication-rules-v1, decision 5) and its credits (decision 6). */
export interface MusicDisclosure {
  /** For Steam's Content Survey and similar long-form fields. */
  long: string;
  /** For stores and pages with room for one line. */
  short: string;
  /** Steam's AI category: music made in the studio and shipped is pre-generated; hand-composed music needs none. */
  steamCategory: "Pre-generated" | null;
  /** Attributions the model's licence requires (e.g. "Powered by Stability AI"); empty when none. */
  credits: string[];
}

function composerDescription(record: PackageProvenance): { long: string; short: string } {
  if (record.generatorId === "synaptix-claude-composer")
    return { long: "which uses Anthropic's Claude to plan arrangements", short: "with AI (Anthropic's Claude)" };
  if (record.generatorId === "synaptix-local-composer")
    return {
      long: `which uses a locally run open-weight AI model${record.model ? ` (${record.model})` : ""} to plan arrangements`,
      short: `with AI (${record.model ?? "a local open-weight model"})`
    };
  return {
    long: "using its procedural composer, which follows musical rules and uses no machine-learning model",
    short: "with a rule-based composer (no AI model)"
  };
}

/**
 * Disclosure text built from the provenance record, so it says exactly what the platform knows.
 * Pass `screened: true` only when the music passed the melody similarity check; the text claims
 * the screening only then.
 */
export function disclosureText(record: PackageProvenance, options: { screened?: boolean } = {}): MusicDisclosure {
  const credits = record.credits ?? [];
  const runtime = "No music is generated while the game runs.";
  if (record.origin === "hand") {
    return {
      long: `The music in this game was composed by hand in Synaptix Music, without AI or generative tools. ${runtime}`,
      short: "Music composed by hand, without AI.",
      steamCategory: null,
      credits
    };
  }
  const composer = composerDescription(record);
  const percent = record.editShare === undefined ? null : Math.round(record.editShare * 100);
  const edits =
    record.origin === "generated" || percent === 0
      ? "it was not edited by hand after it was generated"
      : percent === null ? "it was then edited by hand" : `about ${percent}% of the notes were edited by hand`;
  const shortEdits =
    record.origin === "generated" || percent === 0 ? "" : percent === null ? ", edited by hand" : `, ${percent}% edited by hand`;
  const screening = options.screened ? ", and every track was screened for melodic similarity to known songs" : "";
  return {
    long:
      `The music in this game was composed with Synaptix Music, ${composer.long}. ` +
      `The music is note-based and was rendered to audio before release; ${edits}. ` +
      `No lyrics or voice cloning were used${screening}. ${runtime}`,
    short: `Music pre-generated ${composer.short}${shortEdits}.`,
    steamCategory: "Pre-generated",
    credits
  };
}

/**
 * Why publishing must refuse a package, or null when its licence allows it. Hand-composed music is
 * always fine; generated music needs a licence record that doesn't say `not-allowed`. The platform
 * enforces the same rule on its own copy of the revision; this is the studio's early check.
 */
export function licenceRefusal(record: PackageProvenance | undefined): string | null {
  if (!record) return "This package has no provenance record, so its licence can't be checked.";
  if (record.origin === "hand") return null;
  if (!record.commercialUse)
    return "This music was generated before licence records were kept, so it can't be published. Generate it again.";
  if (record.commercialUse === "not-allowed")
    return `This music was made with ${record.model ?? record.generatorId ?? "a generator"}, whose licence (${record.licence ?? "unknown"}) doesn't allow commercial use, so it can't be published.`;
  return null;
}

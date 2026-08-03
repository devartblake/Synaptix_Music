import type { Clip, MusicProject, Track } from "@synaptix/project-model";

export type SerializedCommand =
  | { type: "add-track"; commandId: string; track: Track; index: number }
  | { type: "remove-track"; commandId: string; trackId: string }
  | { type: "rename-track"; commandId: string; trackId: string; name: string }
  | { type: "set-track-volume"; commandId: string; trackId: string; volumeDb: number }
  | { type: "set-track-pan"; commandId: string; trackId: string; pan: number }
  | { type: "add-clip"; commandId: string; trackId: string; clip: Clip; index: number }
  | { type: "remove-clip"; commandId: string; trackId: string; clipId: string }
  | {
      type: "move-clip";
      commandId: string;
      trackId: string;
      clipId: string;
      bar: number;
      beat: number;
      tick: number;
    }
  | {
      type: "resize-clip";
      commandId: string;
      trackId: string;
      clipId: string;
      durationTicks: number;
    };

export interface StudioCommand {
  readonly id: string;
  readonly type: SerializedCommand["type"];
  execute(project: MusicProject): MusicProject;
  undo(project: MusicProject): MusicProject;
  serialize(): SerializedCommand;
}

export interface CommandMetadata {
  id?: string;
}

function commandId(metadata: CommandMetadata): string {
  return metadata.id ?? crypto.randomUUID();
}

function cloneProject(project: MusicProject): MusicProject {
  return structuredClone(project);
}

function requireTrack(project: MusicProject, trackId: string): Track {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    throw new Error(`Track '${trackId}' was not found.`);
  }
  return track;
}

function requireClip(track: Track, clipId: string): Clip {
  const clip = track.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new Error(`Clip '${clipId}' was not found on track '${track.id}'.`);
  }
  return clip;
}

function validateTrackName(name: string): void {
  if (name.trim().length === 0) {
    throw new Error("Track name must not be empty.");
  }
}

function validateVolume(volumeDb: number): void {
  if (volumeDb < -96 || volumeDb > 24) {
    throw new RangeError("Track volume must be between -96 dB and 24 dB.");
  }
}

function validatePan(pan: number): void {
  if (pan < -1 || pan > 1) {
    throw new RangeError("Track pan must be between -1 and 1.");
  }
}

export class AddTrackCommand implements StudioCommand {
  readonly id: string;
  readonly type = "add-track" as const;
  readonly track: Track;
  readonly index: number;

  constructor(track: Track, index: number, metadata: CommandMetadata = {}) {
    this.id = commandId(metadata);
    this.track = structuredClone(track);
    this.index = index;
  }

  execute(project: MusicProject): MusicProject {
    if (project.tracks.some((track) => track.id === this.track.id)) {
      throw new Error(`Track '${this.track.id}' already exists.`);
    }
    if (this.index < 0 || this.index > project.tracks.length) {
      throw new RangeError("Track insertion index is outside the project track list.");
    }

    const next = cloneProject(project);
    next.tracks.splice(this.index, 0, structuredClone(this.track));
    return next;
  }

  undo(project: MusicProject): MusicProject {
    const next = cloneProject(project);
    const index = next.tracks.findIndex((track) => track.id === this.track.id);
    if (index < 0) {
      throw new Error(`Track '${this.track.id}' cannot be removed during undo.`);
    }
    next.tracks.splice(index, 1);
    return next;
  }

  serialize(): SerializedCommand {
    return { type: this.type, commandId: this.id, track: structuredClone(this.track), index: this.index };
  }
}

export class RemoveTrackCommand implements StudioCommand {
  readonly id: string;
  readonly type = "remove-track" as const;
  private removedTrack: Track | null = null;
  private removedIndex = -1;

  constructor(readonly trackId: string, metadata: CommandMetadata = {}) {
    this.id = commandId(metadata);
  }

  execute(project: MusicProject): MusicProject {
    const next = cloneProject(project);
    const index = next.tracks.findIndex((track) => track.id === this.trackId);
    if (index < 0) {
      throw new Error(`Track '${this.trackId}' was not found.`);
    }
    this.removedTrack = structuredClone(next.tracks[index]);
    this.removedIndex = index;
    next.tracks.splice(index, 1);
    return next;
  }

  undo(project: MusicProject): MusicProject {
    if (!this.removedTrack || this.removedIndex < 0) {
      throw new Error("RemoveTrackCommand must execute before it can be undone.");
    }
    return new AddTrackCommand(this.removedTrack, this.removedIndex, { id: this.id }).execute(project);
  }

  serialize(): SerializedCommand {
    return { type: this.type, commandId: this.id, trackId: this.trackId };
  }
}

abstract class TrackValueCommand<T> implements StudioCommand {
  abstract readonly type: SerializedCommand["type"];
  readonly id: string;
  private previousValue: T | undefined;

  protected constructor(
    readonly trackId: string,
    readonly value: T,
    metadata: CommandMetadata = {}
  ) {
    this.id = commandId(metadata);
  }

  protected abstract read(track: Track): T;
  protected abstract write(track: Track, value: T): void;

  execute(project: MusicProject): MusicProject {
    const next = cloneProject(project);
    const track = requireTrack(next, this.trackId);
    this.previousValue = this.read(track);
    this.write(track, this.value);
    return next;
  }

  undo(project: MusicProject): MusicProject {
    if (this.previousValue === undefined) {
      throw new Error(`${this.constructor.name} must execute before it can be undone.`);
    }
    const next = cloneProject(project);
    this.write(requireTrack(next, this.trackId), this.previousValue);
    return next;
  }

  abstract serialize(): SerializedCommand;
}

export class RenameTrackCommand extends TrackValueCommand<string> {
  readonly type = "rename-track" as const;

  constructor(trackId: string, name: string, metadata: CommandMetadata = {}) {
    validateTrackName(name);
    super(trackId, name, metadata);
  }

  protected read(track: Track): string {
    return track.name;
  }

  protected write(track: Track, value: string): void {
    track.name = value;
  }

  serialize(): SerializedCommand {
    return { type: this.type, commandId: this.id, trackId: this.trackId, name: this.value };
  }
}

export class SetTrackVolumeCommand extends TrackValueCommand<number> {
  readonly type = "set-track-volume" as const;

  constructor(trackId: string, volumeDb: number, metadata: CommandMetadata = {}) {
    validateVolume(volumeDb);
    super(trackId, volumeDb, metadata);
  }

  protected read(track: Track): number {
    return track.volumeDb;
  }

  protected write(track: Track, value: number): void {
    track.volumeDb = value;
  }

  serialize(): SerializedCommand {
    return { type: this.type, commandId: this.id, trackId: this.trackId, volumeDb: this.value };
  }
}

export class SetTrackPanCommand extends TrackValueCommand<number> {
  readonly type = "set-track-pan" as const;

  constructor(trackId: string, pan: number, metadata: CommandMetadata = {}) {
    validatePan(pan);
    super(trackId, pan, metadata);
  }

  protected read(track: Track): number {
    return track.pan;
  }

  protected write(track: Track, value: number): void {
    track.pan = value;
  }

  serialize(): SerializedCommand {
    return { type: this.type, commandId: this.id, trackId: this.trackId, pan: this.value };
  }
}

export class AddClipCommand implements StudioCommand {
  readonly id: string;
  readonly type = "add-clip" as const;
  readonly clip: Clip;

  constructor(
    readonly trackId: string,
    clip: Clip,
    readonly index: number,
    metadata: CommandMetadata = {}
  ) {
    this.id = commandId(metadata);
    this.clip = structuredClone(clip);
  }

  execute(project: MusicProject): MusicProject {
    const next = cloneProject(project);
    const track = requireTrack(next, this.trackId);
    if (track.clips.some((clip) => clip.id === this.clip.id)) {
      throw new Error(`Clip '${this.clip.id}' already exists on track '${this.trackId}'.`);
    }
    if (this.index < 0 || this.index > track.clips.length) {
      throw new RangeError("Clip insertion index is outside the track clip list.");
    }
    track.clips.splice(this.index, 0, structuredClone(this.clip));
    return next;
  }

  undo(project: MusicProject): MusicProject {
    const next = cloneProject(project);
    const track = requireTrack(next, this.trackId);
    const index = track.clips.findIndex((clip) => clip.id === this.clip.id);
    if (index < 0) {
      throw new Error(`Clip '${this.clip.id}' cannot be removed during undo.`);
    }
    track.clips.splice(index, 1);
    return next;
  }

  serialize(): SerializedCommand {
    return {
      type: this.type,
      commandId: this.id,
      trackId: this.trackId,
      clip: structuredClone(this.clip),
      index: this.index
    };
  }
}

export class RemoveClipCommand implements StudioCommand {
  readonly id: string;
  readonly type = "remove-clip" as const;
  private removedClip: Clip | null = null;
  private removedIndex = -1;

  constructor(
    readonly trackId: string,
    readonly clipId: string,
    metadata: CommandMetadata = {}
  ) {
    this.id = commandId(metadata);
  }

  execute(project: MusicProject): MusicProject {
    const next = cloneProject(project);
    const track = requireTrack(next, this.trackId);
    const index = track.clips.findIndex((clip) => clip.id === this.clipId);
    if (index < 0) {
      throw new Error(`Clip '${this.clipId}' was not found on track '${this.trackId}'.`);
    }
    this.removedClip = structuredClone(track.clips[index]);
    this.removedIndex = index;
    track.clips.splice(index, 1);
    return next;
  }

  undo(project: MusicProject): MusicProject {
    if (!this.removedClip || this.removedIndex < 0) {
      throw new Error("RemoveClipCommand must execute before it can be undone.");
    }
    return new AddClipCommand(this.trackId, this.removedClip, this.removedIndex, {
      id: this.id
    }).execute(project);
  }

  serialize(): SerializedCommand {
    return { type: this.type, commandId: this.id, trackId: this.trackId, clipId: this.clipId };
  }
}

export class MoveClipCommand implements StudioCommand {
  readonly id: string;
  readonly type = "move-clip" as const;
  private previousPosition: Clip["range"]["start"] | null = null;

  constructor(
    readonly trackId: string,
    readonly clipId: string,
    readonly position: Clip["range"]["start"],
    metadata: CommandMetadata = {}
  ) {
    this.id = commandId(metadata);
  }

  execute(project: MusicProject): MusicProject {
    const next = cloneProject(project);
    const clip = requireClip(requireTrack(next, this.trackId), this.clipId);
    this.previousPosition = structuredClone(clip.range.start);
    clip.range.start = structuredClone(this.position);
    return next;
  }

  undo(project: MusicProject): MusicProject {
    if (!this.previousPosition) {
      throw new Error("MoveClipCommand must execute before it can be undone.");
    }
    const next = cloneProject(project);
    requireClip(requireTrack(next, this.trackId), this.clipId).range.start = structuredClone(
      this.previousPosition
    );
    return next;
  }

  serialize(): SerializedCommand {
    return {
      type: this.type,
      commandId: this.id,
      trackId: this.trackId,
      clipId: this.clipId,
      ...this.position
    };
  }
}

export class ResizeClipCommand implements StudioCommand {
  readonly id: string;
  readonly type = "resize-clip" as const;
  private previousDuration: number | null = null;

  constructor(
    readonly trackId: string,
    readonly clipId: string,
    readonly durationTicks: number,
    metadata: CommandMetadata = {}
  ) {
    if (!Number.isInteger(durationTicks) || durationTicks <= 0) {
      throw new RangeError("Clip duration must be a positive integer number of ticks.");
    }
    this.id = commandId(metadata);
  }

  execute(project: MusicProject): MusicProject {
    const next = cloneProject(project);
    const clip = requireClip(requireTrack(next, this.trackId), this.clipId);
    this.previousDuration = clip.range.durationTicks;
    clip.range.durationTicks = this.durationTicks;
    return next;
  }

  undo(project: MusicProject): MusicProject {
    if (this.previousDuration === null) {
      throw new Error("ResizeClipCommand must execute before it can be undone.");
    }
    const next = cloneProject(project);
    requireClip(requireTrack(next, this.trackId), this.clipId).range.durationTicks =
      this.previousDuration;
    return next;
  }

  serialize(): SerializedCommand {
    return {
      type: this.type,
      commandId: this.id,
      trackId: this.trackId,
      clipId: this.clipId,
      durationTicks: this.durationTicks
    };
  }
}

export interface TransactionOptions {
  id?: string;
  timestamp?: string;
}

export class CommandTransaction {
  readonly id: string;
  readonly timestamp: string;
  readonly commands: readonly StudioCommand[];

  constructor(commands: readonly StudioCommand[], options: TransactionOptions = {}) {
    if (commands.length === 0) {
      throw new Error("A transaction must contain at least one command.");
    }
    this.id = options.id ?? crypto.randomUUID();
    this.timestamp = options.timestamp ?? new Date().toISOString();
    this.commands = [...commands];
  }

  execute(project: MusicProject): MusicProject {
    let current = project;
    const completed: StudioCommand[] = [];
    try {
      for (const command of this.commands) {
        current = command.execute(current);
        completed.push(command);
      }
      return current;
    } catch (error) {
      for (const command of completed.reverse()) {
        current = command.undo(current);
      }
      throw error;
    }
  }

  undo(project: MusicProject): MusicProject {
    return [...this.commands].reverse().reduce((current, command) => command.undo(current), project);
  }

  serialize(): readonly SerializedCommand[] {
    return this.commands.map((command) => command.serialize());
  }
}

export interface ProjectRevision {
  revisionId: string;
  parentRevisionId: string | null;
  transactionId: string;
  commandIds: string[];
  createdAt: string;
  checksumSha256: string;
}

export interface CommitOptions {
  revisionId?: string;
  timestamp?: string;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalizeProject(project: MusicProject): string {
  return canonicalize(project);
}

export async function computeProjectChecksum(project: MusicProject): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeProject(project));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function commitTransaction(
  project: MusicProject,
  transaction: CommandTransaction,
  options: CommitOptions = {}
): Promise<{ project: MusicProject; revision: ProjectRevision }> {
  const timestamp = options.timestamp ?? transaction.timestamp;
  const revisionId = options.revisionId ?? crypto.randomUUID();
  const parentRevisionId = project.revisionId;
  const executed = transaction.execute(project);
  const committed = cloneProject(executed);
  committed.parentRevisionId = parentRevisionId;
  committed.revisionId = revisionId;
  committed.metadata.updatedAt = timestamp;

  const checksumSha256 = await computeProjectChecksum(committed);
  return {
    project: committed,
    revision: {
      revisionId,
      parentRevisionId,
      transactionId: transaction.id,
      commandIds: transaction.commands.map((command) => command.id),
      createdAt: timestamp,
      checksumSha256
    }
  };
}

interface HistoryEntry {
  transaction: CommandTransaction;
  before: MusicProject;
  after: MusicProject;
  revision: ProjectRevision;
}

export class CommandHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  async execute(
    project: MusicProject,
    transaction: CommandTransaction,
    options: CommitOptions = {}
  ): Promise<{ project: MusicProject; revision: ProjectRevision }> {
    const before = cloneProject(project);
    const result = await commitTransaction(project, transaction, options);
    this.undoStack.push({
      transaction,
      before,
      after: cloneProject(result.project),
      revision: result.revision
    });
    this.redoStack.length = 0;
    return result;
  }

  undo(project: MusicProject): MusicProject {
    const entry = this.undoStack.pop();
    if (!entry) {
      return project;
    }
    this.redoStack.push(entry);
    return cloneProject(entry.before);
  }

  redo(project: MusicProject): MusicProject {
    const entry = this.redoStack.pop();
    if (!entry) {
      return project;
    }
    this.undoStack.push(entry);
    return cloneProject(entry.after);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  revisions(): readonly ProjectRevision[] {
    return this.undoStack.map((entry) => ({ ...entry.revision, commandIds: [...entry.revision.commandIds] }));
  }
}

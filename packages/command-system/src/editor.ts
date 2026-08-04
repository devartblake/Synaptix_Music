import type { MusicProject, Track } from "@synaptix/project-model";

import { computeProjectChecksum, type ProjectRevision } from "./index.ts";

export interface EditorCommand {
  readonly id: string;
  readonly kind: string;
  execute(project: MusicProject): MusicProject;
  undo(project: MusicProject): MusicProject;
}

interface CommandOptions {
  id?: string;
}

function commandId(options: CommandOptions): string {
  return options.id ?? crypto.randomUUID();
}

function clone(project: MusicProject): MusicProject {
  return structuredClone(project);
}

function track(project: MusicProject, trackId: string): Track {
  const value = project.tracks.find((candidate) => candidate.id === trackId);
  if (!value) throw new Error(`Track '${trackId}' was not found.`);
  return value;
}

abstract class TrackFieldCommand<T> implements EditorCommand {
  readonly id: string;
  abstract readonly kind: string;

  protected constructor(
    readonly trackId: string,
    readonly previousValue: T,
    readonly nextValue: T,
    options: CommandOptions = {}
  ) {
    this.id = commandId(options);
  }

  protected abstract write(value: Track, next: T): void;

  execute(project: MusicProject): MusicProject {
    const next = clone(project);
    this.write(track(next, this.trackId), this.nextValue);
    return next;
  }

  undo(project: MusicProject): MusicProject {
    const next = clone(project);
    this.write(track(next, this.trackId), this.previousValue);
    return next;
  }
}

export class SetTrackMutedEditorCommand extends TrackFieldCommand<boolean> {
  readonly kind = "set-track-muted";
  protected write(value: Track, next: boolean): void { value.muted = next; }
}

export class SetTrackSoloEditorCommand extends TrackFieldCommand<boolean> {
  readonly kind = "set-track-solo";
  protected write(value: Track, next: boolean): void { value.solo = next; }
}

export class SetTrackVolumeEditorCommand extends TrackFieldCommand<number> {
  readonly kind = "set-track-volume";
  protected write(value: Track, next: number): void { value.volumeDb = next; }
}

export class SetTrackPanEditorCommand extends TrackFieldCommand<number> {
  readonly kind = "set-track-pan";
  protected write(value: Track, next: number): void { value.pan = next; }
}

export class SetLoopEnabledEditorCommand implements EditorCommand {
  readonly id: string;
  readonly kind = "set-loop-enabled";

  constructor(
    readonly previousValue: boolean,
    readonly nextValue: boolean,
    options: CommandOptions = {}
  ) {
    this.id = commandId(options);
  }

  execute(project: MusicProject): MusicProject {
    const next = clone(project);
    next.transport.loopEnabled = this.nextValue;
    return next;
  }

  undo(project: MusicProject): MusicProject {
    const next = clone(project);
    next.transport.loopEnabled = this.previousValue;
    return next;
  }
}

export class SetTempoEditorCommand implements EditorCommand {
  readonly id: string;
  readonly kind = "set-tempo";

  constructor(
    readonly previousBpm: number,
    readonly nextBpm: number,
    options: CommandOptions = {}
  ) {
    if (nextBpm < 20 || nextBpm > 300) throw new RangeError("Tempo must be between 20 and 300 BPM.");
    this.id = commandId(options);
  }

  execute(project: MusicProject): MusicProject {
    const next = clone(project);
    if (next.tempoMap.length === 0) throw new Error("Project tempo map is empty.");
    next.tempoMap[0] = { ...next.tempoMap[0], bpm: this.nextBpm };
    return next;
  }

  undo(project: MusicProject): MusicProject {
    const next = clone(project);
    if (next.tempoMap.length === 0) throw new Error("Project tempo map is empty.");
    next.tempoMap[0] = { ...next.tempoMap[0], bpm: this.previousBpm };
    return next;
  }
}

interface HistoryEntry {
  command: EditorCommand;
  before: MusicProject;
  after: MusicProject;
}

async function revisionFor(
  project: MusicProject,
  parentRevisionId: string | null,
  transactionId: string,
  commandIdValue: string
): Promise<{ project: MusicProject; revision: ProjectRevision }> {
  const createdAt = new Date().toISOString();
  const revisionId = crypto.randomUUID();
  const committed = clone(project);
  committed.parentRevisionId = parentRevisionId;
  committed.revisionId = revisionId;
  committed.metadata.updatedAt = createdAt;
  return {
    project: committed,
    revision: {
      revisionId,
      parentRevisionId,
      transactionId,
      commandIds: [commandIdValue],
      createdAt,
      checksumSha256: await computeProjectChecksum(committed)
    }
  };
}

export class EditorCommandHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  async execute(project: MusicProject, command: EditorCommand) {
    const before = clone(project);
    const executed = command.execute(project);
    const result = await revisionFor(executed, project.revisionId, crypto.randomUUID(), command.id);
    this.undoStack.push({ command, before, after: clone(result.project) });
    this.redoStack.length = 0;
    return result;
  }

  async undo(project: MusicProject) {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const reverted = entry.command.undo(project);
    const result = await revisionFor(reverted, project.revisionId, crypto.randomUUID(), `undo:${entry.command.id}`);
    this.redoStack.push(entry);
    return result;
  }

  async redo(project: MusicProject) {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const replayed = entry.command.execute(project);
    const result = await revisionFor(replayed, project.revisionId, crypto.randomUUID(), `redo:${entry.command.id}`);
    this.undoStack.push(entry);
    return result;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

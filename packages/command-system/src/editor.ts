import type { MusicProject, Track } from "@synaptix/project-model";

import { computeProjectChecksum, type ProjectRevision } from "./index";

export interface EditorCommand {
  readonly id: string;
  readonly kind: string;
  execute(project: MusicProject): MusicProject;
  undo(project: MusicProject): MusicProject;
}

interface CommandOptions {
  id?: string;
}

export interface EditorCommandHistoryOptions {
  maxDepth?: number;
}

export interface EditorHistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
  busy: boolean;
  projectId: string | null;
  revisionId: string | null;
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

  constructor(
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
  private readonly maxDepth: number;
  private busy = false;
  private projectId: string | null = null;
  private revisionId: string | null = null;

  constructor(options: EditorCommandHistoryOptions = {}) {
    const maxDepth = options.maxDepth ?? 100;
    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new RangeError("Editor history maxDepth must be a positive integer.");
    }
    this.maxDepth = maxDepth;
  }

  get canUndo(): boolean { return !this.busy && this.undoStack.length > 0; }
  get canRedo(): boolean { return !this.busy && this.redoStack.length > 0; }
  get isBusy(): boolean { return this.busy; }

  snapshot(): EditorHistorySnapshot {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      busy: this.busy,
      projectId: this.projectId,
      revisionId: this.revisionId
    };
  }

  reset(project?: MusicProject): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.projectId = project?.projectId ?? null;
    this.revisionId = project?.revisionId ?? null;
  }

  private assertProject(project: MusicProject): void {
    if (this.projectId !== null && this.projectId !== project.projectId) {
      throw new Error("Editor history belongs to a different project. Reset it before editing.");
    }
    this.projectId ??= project.projectId;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("An editor history operation is already in progress.");
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }

  private trimUndoStack(): void {
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.splice(0, this.undoStack.length - this.maxDepth);
    }
  }

  async execute(project: MusicProject, command: EditorCommand) {
    this.assertProject(project);
    return this.exclusive(async () => {
      const before = clone(project);
      const executed = command.execute(project);
      const result = await revisionFor(executed, project.revisionId, crypto.randomUUID(), command.id);
      this.undoStack.push({ command, before, after: clone(result.project) });
      this.trimUndoStack();
      this.redoStack.length = 0;
      this.revisionId = result.project.revisionId;
      return result;
    });
  }

  async undo(project: MusicProject) {
    this.assertProject(project);
    return this.exclusive(async () => {
      const entry = this.undoStack.at(-1);
      if (!entry) return null;
      const reverted = entry.command.undo(project);
      const result = await revisionFor(reverted, project.revisionId, crypto.randomUUID(), `undo:${entry.command.id}`);
      this.undoStack.pop();
      this.redoStack.push(entry);
      this.revisionId = result.project.revisionId;
      return result;
    });
  }

  async redo(project: MusicProject) {
    this.assertProject(project);
    return this.exclusive(async () => {
      const entry = this.redoStack.at(-1);
      if (!entry) return null;
      const replayed = entry.command.execute(project);
      const result = await revisionFor(replayed, project.revisionId, crypto.randomUUID(), `redo:${entry.command.id}`);
      this.redoStack.pop();
      this.undoStack.push(entry);
      this.trimUndoStack();
      this.revisionId = result.project.revisionId;
      return result;
    });
  }

  clear(): void {
    this.reset();
  }
}

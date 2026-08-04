import type { Clip, MusicProject } from "@synaptix/project-model";

import type { EditorCommand } from "./editor";

type MidiClip = Extract<Clip, { kind: "midi" }>;
type MidiNote = MidiClip["notes"][number];

export interface MidiCommandOptions {
  id?: string;
}

function commandId(options: MidiCommandOptions): string {
  return options.id ?? crypto.randomUUID();
}

function clone(project: MusicProject): MusicProject {
  return structuredClone(project);
}

function requireMidiClip(project: MusicProject, trackId: string, clipId: string): MidiClip {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error(`Track '${trackId}' was not found.`);
  const clip = track.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error(`Clip '${clipId}' was not found on track '${trackId}'.`);
  if (clip.kind !== "midi") throw new Error(`Clip '${clipId}' is not a MIDI clip.`);
  return clip;
}

function validateNote(note: MidiNote, clip: MidiClip): void {
  if (!note.id) throw new Error("MIDI note ID must not be empty.");
  if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) {
    throw new RangeError("MIDI pitch must be an integer from 0 to 127.");
  }
  if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) {
    throw new RangeError("MIDI velocity must be an integer from 1 to 127.");
  }
  if (!Number.isInteger(note.startTick) || note.startTick < 0) {
    throw new RangeError("MIDI note startTick must be a nonnegative integer.");
  }
  if (!Number.isInteger(note.durationTicks) || note.durationTicks <= 0) {
    throw new RangeError("MIDI note durationTicks must be a positive integer.");
  }
  if (note.startTick + note.durationTicks > clip.range.durationTicks) {
    throw new RangeError("MIDI note must remain inside the clip duration.");
  }
}

abstract class MidiNotesCommand implements EditorCommand {
  readonly id: string;
  abstract readonly kind: string;
  private previousNotes: MidiNote[] | null = null;

  protected constructor(
    readonly trackId: string,
    readonly clipId: string,
    options: MidiCommandOptions = {}
  ) {
    this.id = commandId(options);
  }

  protected abstract mutate(notes: MidiNote[], clip: MidiClip): MidiNote[];

  execute(project: MusicProject): MusicProject {
    const next = clone(project);
    const clip = requireMidiClip(next, this.trackId, this.clipId);
    if (this.previousNotes === null) this.previousNotes = structuredClone(clip.notes);
    const notes = this.mutate(structuredClone(clip.notes), clip);
    const ids = new Set<string>();
    for (const note of notes) {
      validateNote(note, clip);
      if (ids.has(note.id)) throw new Error(`Duplicate MIDI note ID '${note.id}'.`);
      ids.add(note.id);
    }
    clip.notes = notes.sort((left, right) => left.startTick - right.startTick || left.pitch - right.pitch);
    return next;
  }

  undo(project: MusicProject): MusicProject {
    if (this.previousNotes === null) throw new Error(`${this.constructor.name} must execute before undo.`);
    const next = clone(project);
    requireMidiClip(next, this.trackId, this.clipId).notes = structuredClone(this.previousNotes);
    return next;
  }
}

export class AddMidiNoteCommand extends MidiNotesCommand {
  readonly kind = "add-midi-note";
  constructor(trackId: string, clipId: string, readonly note: MidiNote, options: MidiCommandOptions = {}) {
    super(trackId, clipId, options);
  }
  protected mutate(notes: MidiNote[], clip: MidiClip): MidiNote[] {
    if (notes.some((note) => note.id === this.note.id)) throw new Error(`MIDI note '${this.note.id}' already exists.`);
    validateNote(this.note, clip);
    return [...notes, structuredClone(this.note)];
  }
}

export class RemoveMidiNotesCommand extends MidiNotesCommand {
  readonly kind = "remove-midi-notes";
  readonly noteIds: ReadonlySet<string>;
  constructor(trackId: string, clipId: string, noteIds: readonly string[], options: MidiCommandOptions = {}) {
    if (noteIds.length === 0) throw new Error("At least one MIDI note ID is required.");
    super(trackId, clipId, options);
    this.noteIds = new Set(noteIds);
  }
  protected mutate(notes: MidiNote[]): MidiNote[] {
    const remaining = notes.filter((note) => !this.noteIds.has(note.id));
    if (remaining.length === notes.length) throw new Error("None of the requested MIDI notes were found.");
    return remaining;
  }
}

export class MoveMidiNotesCommand extends MidiNotesCommand {
  readonly kind: string = "move-midi-notes";
  readonly noteIds: ReadonlySet<string>;
  constructor(
    trackId: string,
    clipId: string,
    noteIds: readonly string[],
    readonly deltaTicks: number,
    readonly deltaPitch: number,
    options: MidiCommandOptions = {}
  ) {
    if (noteIds.length === 0) throw new Error("At least one MIDI note ID is required.");
    if (!Number.isInteger(deltaTicks) || !Number.isInteger(deltaPitch)) throw new RangeError("MIDI movement deltas must be integers.");
    super(trackId, clipId, options);
    this.noteIds = new Set(noteIds);
  }
  protected mutate(notes: MidiNote[]): MidiNote[] {
    let changed = false;
    const next = notes.map((note) => {
      if (!this.noteIds.has(note.id)) return note;
      changed = true;
      return { ...note, startTick: note.startTick + this.deltaTicks, pitch: note.pitch + this.deltaPitch };
    });
    if (!changed) throw new Error("None of the requested MIDI notes were found.");
    return next;
  }
}

export class ResizeMidiNotesCommand extends MidiNotesCommand {
  readonly kind = "resize-midi-notes";
  readonly noteIds: ReadonlySet<string>;
  constructor(trackId: string, clipId: string, noteIds: readonly string[], readonly deltaTicks: number, options: MidiCommandOptions = {}) {
    if (noteIds.length === 0) throw new Error("At least one MIDI note ID is required.");
    if (!Number.isInteger(deltaTicks)) throw new RangeError("MIDI resize delta must be an integer.");
    super(trackId, clipId, options);
    this.noteIds = new Set(noteIds);
  }
  protected mutate(notes: MidiNote[]): MidiNote[] {
    return notes.map((note) => this.noteIds.has(note.id) ? { ...note, durationTicks: note.durationTicks + this.deltaTicks } : note);
  }
}

export class SetMidiVelocityCommand extends MidiNotesCommand {
  readonly kind = "set-midi-velocity";
  readonly noteIds: ReadonlySet<string>;
  constructor(trackId: string, clipId: string, noteIds: readonly string[], readonly velocity: number, options: MidiCommandOptions = {}) {
    if (noteIds.length === 0) throw new Error("At least one MIDI note ID is required.");
    if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) throw new RangeError("MIDI velocity must be an integer from 1 to 127.");
    super(trackId, clipId, options);
    this.noteIds = new Set(noteIds);
  }
  protected mutate(notes: MidiNote[]): MidiNote[] {
    return notes.map((note) => this.noteIds.has(note.id) ? { ...note, velocity: this.velocity } : note);
  }
}

export class TransposeMidiNotesCommand extends MoveMidiNotesCommand {
  readonly kind = "transpose-midi-notes";
  constructor(trackId: string, clipId: string, noteIds: readonly string[], semitones: number, options: MidiCommandOptions = {}) {
    super(trackId, clipId, noteIds, 0, semitones, options);
  }
}

export class QuantizeMidiNotesCommand extends MidiNotesCommand {
  readonly kind = "quantize-midi-notes";
  readonly noteIds: ReadonlySet<string>;
  constructor(trackId: string, clipId: string, noteIds: readonly string[], readonly gridTicks: number, options: MidiCommandOptions = {}) {
    if (noteIds.length === 0) throw new Error("At least one MIDI note ID is required.");
    if (!Number.isInteger(gridTicks) || gridTicks <= 0) throw new RangeError("Quantization grid must be a positive integer.");
    super(trackId, clipId, options);
    this.noteIds = new Set(noteIds);
  }
  protected mutate(notes: MidiNote[], clip: MidiClip): MidiNote[] {
    return notes.map((note) => {
      if (!this.noteIds.has(note.id)) return note;
      const startTick = Math.min(
        Math.round(note.startTick / this.gridTicks) * this.gridTicks,
        clip.range.durationTicks - note.durationTicks
      );
      return { ...note, startTick: Math.max(0, startTick) };
    });
  }
}

export class DuplicateMidiNotesCommand extends MidiNotesCommand {
  readonly kind = "duplicate-midi-notes";
  readonly noteIds: ReadonlySet<string>;
  constructor(
    trackId: string,
    clipId: string,
    noteIds: readonly string[],
    readonly deltaTicks: number,
    readonly idFactory: (source: MidiNote) => string = () => crypto.randomUUID(),
    options: MidiCommandOptions = {}
  ) {
    if (noteIds.length === 0) throw new Error("At least one MIDI note ID is required.");
    if (!Number.isInteger(deltaTicks)) throw new RangeError("Duplicate offset must be an integer.");
    super(trackId, clipId, options);
    this.noteIds = new Set(noteIds);
  }
  protected mutate(notes: MidiNote[]): MidiNote[] {
    const selected = notes.filter((note) => this.noteIds.has(note.id));
    if (selected.length === 0) throw new Error("None of the requested MIDI notes were found.");
    return [...notes, ...selected.map((note) => ({ ...note, id: this.idFactory(note), startTick: note.startTick + this.deltaTicks }))];
  }
}

export class ToggleDrumStepCommand extends MidiNotesCommand {
  readonly kind = "toggle-drum-step";
  constructor(
    trackId: string,
    clipId: string,
    readonly pitch: number,
    readonly startTick: number,
    readonly durationTicks: number,
    readonly velocity = 100,
    options: MidiCommandOptions = {}
  ) {
    super(trackId, clipId, options);
  }
  protected mutate(notes: MidiNote[], clip: MidiClip): MidiNote[] {
    const existing = notes.find((note) => note.pitch === this.pitch && note.startTick === this.startTick);
    if (existing) return notes.filter((note) => note.id !== existing.id);
    const note: MidiNote = {
      id: crypto.randomUUID(),
      pitch: this.pitch,
      velocity: this.velocity,
      startTick: this.startTick,
      durationTicks: this.durationTicks
    };
    validateNote(note, clip);
    return [...notes, note];
  }
}

export class ClearDrumPatternCommand extends MidiNotesCommand {
  readonly kind = "clear-drum-pattern";
  readonly pitches: ReadonlySet<number>;
  constructor(trackId: string, clipId: string, pitches: readonly number[], options: MidiCommandOptions = {}) {
    if (pitches.length === 0) throw new Error("At least one drum pitch is required.");
    super(trackId, clipId, options);
    this.pitches = new Set(pitches);
  }
  protected mutate(notes: MidiNote[]): MidiNote[] {
    return notes.filter((note) => !this.pitches.has(note.pitch));
  }
}

export class SetMidiClipLoopCommand implements EditorCommand {
  readonly id: string;
  readonly kind = "set-midi-clip-loop";
  constructor(
    readonly trackId: string,
    readonly clipId: string,
    readonly previousValue: boolean,
    readonly nextValue: boolean,
    options: MidiCommandOptions = {}
  ) {
    this.id = commandId(options);
  }
  execute(project: MusicProject): MusicProject {
    const next = clone(project);
    requireMidiClip(next, this.trackId, this.clipId).loop = this.nextValue;
    return next;
  }
  undo(project: MusicProject): MusicProject {
    const next = clone(project);
    requireMidiClip(next, this.trackId, this.clipId).loop = this.previousValue;
    return next;
  }
}

import type { Clip } from "@synaptix/project-model";

type MidiNote = Extract<Clip, { kind: "midi" }>["notes"][number];

/** Copied notes, positioned relative to the earliest copied note. */
export interface NoteClipboard {
  notes: { pitch: number; velocity: number; offsetTicks: number; durationTicks: number }[];
  spanTicks: number;
}

// One clipboard for the whole studio session, so notes can move between clips.
let current: NoteClipboard | null = null;

export function readNoteClipboard(): NoteClipboard | null {
  return current;
}

export function writeNoteClipboard(value: NoteClipboard | null): void {
  current = value;
}

export function copyNotes(notes: readonly MidiNote[], ids: readonly string[]): NoteClipboard | null {
  const wanted = new Set(ids);
  const selected = notes.filter((note) => wanted.has(note.id));
  if (!selected.length) return null;
  const start = Math.min(...selected.map((note) => note.startTick));
  const end = Math.max(...selected.map((note) => note.startTick + note.durationTicks));
  return {
    notes: selected.map((note) => ({
      pitch: note.pitch,
      velocity: note.velocity,
      offsetTicks: note.startTick - start,
      durationTicks: note.durationTicks
    })),
    spanTicks: end - start
  };
}

/**
 * New notes for pasting [clipboard] at [atTick]. Notes that would start past
 * the clip end are dropped, and durations are trimmed to fit the clip.
 */
export function pasteNotes(
  clipboard: NoteClipboard,
  clipDurationTicks: number,
  atTick: number,
  idFactory: () => string = () => crypto.randomUUID()
): MidiNote[] {
  const origin = Math.max(0, Math.round(atTick));
  return clipboard.notes
    .map((note) => ({ ...note, startTick: origin + note.offsetTicks }))
    .filter((note) => note.startTick < clipDurationTicks)
    .map((note) => ({
      id: idFactory(),
      pitch: note.pitch,
      velocity: note.velocity,
      startTick: note.startTick,
      durationTicks: Math.max(1, Math.min(note.durationTicks, clipDurationTicks - note.startTick))
    }));
}

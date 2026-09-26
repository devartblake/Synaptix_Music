import type { Clip } from "@synaptix/project-model";
type MidiClip = Extract<Clip, { kind: "midi" }>;

/** Clamp the selection together, preserving intervals and note spacing. */
export function boundedNoteMove(
  clip: MidiClip,
  ids: readonly string[],
  ticks: number,
  pitch: number
) {
  const notes = clip.notes.filter((note) => ids.includes(note.id));
  if (!notes.length) return { ticks: 0, pitch: 0 };
  return {
    ticks:
      0 +
      Math.max(
        -Math.min(...notes.map((note) => note.startTick)),
        Math.min(
          ticks,
          Math.min(
            ...notes.map((note) => clip.range.durationTicks - note.startTick - note.durationTicks)
          )
        )
      ),
    pitch:
      0 +
      Math.max(
        -Math.min(...notes.map((note) => note.pitch)),
        Math.min(pitch, 127 - Math.max(...notes.map((note) => note.pitch)))
      )
  };
}

export function boundedNoteResize(clip: MidiClip, ids: readonly string[], delta: number) {
  const notes = clip.notes.filter((note) => ids.includes(note.id));
  if (!notes.length) return 0;
  return Math.max(
    Math.max(...notes.map((note) => 1 - note.durationTicks)),
    Math.min(
      delta,
      Math.min(
        ...notes.map((note) => clip.range.durationTicks - note.startTick - note.durationTicks)
      )
    )
  );
}

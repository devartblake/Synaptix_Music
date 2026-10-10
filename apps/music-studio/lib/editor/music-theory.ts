// Scales, key detection and chord names for the piano roll (Studio UI v2, step 4).

export const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Semitones above the tonic. The modes match the generation API's (12 keys × 7 modes). */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11]
} as const;
export type ScaleMode = keyof typeof SCALES;
export interface MusicalKey { tonic: number; mode: ScaleMode }

export function keyLabel(key: MusicalKey): string {
  return `${PITCH_NAMES[key.tonic]} ${key.mode}`;
}

/** Whether a MIDI pitch is in the key's scale. */
export function inScale(key: MusicalKey, pitch: number): boolean {
  return (SCALES[key.mode] as readonly number[]).includes((((pitch - key.tonic) % 12) + 12) % 12);
}

/**
 * The key whose scale holds the most note time. Ties (relative keys share every note) go to the
 * key whose tonic triad is present, then to major and minor, then to the tonic the clip starts on.
 * Null when there are no notes.
 */
export function detectKey(notes: readonly { pitch: number; durationTicks: number; startTick: number }[]): MusicalKey | null {
  if (!notes.length) return null;
  const weight = new Array<number>(12).fill(0);
  for (const note of notes) weight[note.pitch % 12]! += note.durationTicks;
  const first = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)[0]!.pitch % 12;
  const preference: Record<ScaleMode, number> = { major: 2, minor: 2, dorian: 1, mixolydian: 1, phrygian: 0, lydian: 0, "harmonic minor": 0 };
  let best: { key: MusicalKey; score: number } | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of Object.keys(SCALES) as ScaleMode[]) {
      const key = { tonic, mode };
      const fit = weight.reduce((sum, w, pc) => sum + (inScale(key, pc) ? w : -w), 0);
      const [, , third, , fifth] = SCALES[mode];
      const triad = [0, third, fifth].every((step) => weight[(tonic + step) % 12]! > 0);
      // Fit dominates; the rest only break ties, in this order.
      const score = fit * 1000 + (triad ? 100 : 0) + preference[mode] * 10 + (tonic === first ? 5 : 0);
      if (!best || score > best.score) best = { key, score };
    }
  }
  return best!.key;
}

// Chord shapes as intervals above the root, most specific first.
const CHORDS: readonly [readonly number[], string][] = [
  [[0, 4, 7, 11], "maj7"],
  [[0, 3, 7, 10], "m7"],
  [[0, 4, 7, 10], "7"],
  [[0, 3, 6, 10], "m7b5"],
  [[0, 3, 6, 9], "dim7"],
  [[0, 4, 7], ""],
  [[0, 3, 7], "m"],
  [[0, 3, 6], "dim"],
  [[0, 4, 8], "aug"],
  [[0, 2, 7], "sus2"],
  [[0, 5, 7], "sus4"]
];

/**
 * The chord a set of pitches spells, e.g. "C", "Am7", "G7", "C/E" (a slash when the lowest note
 * isn't the root). Null for fewer than three pitch classes or shapes it doesn't know.
 */
export function chordName(pitches: readonly number[]): string | null {
  const classes = [...new Set(pitches.map((pitch) => pitch % 12))];
  if (classes.length < 3) return null;
  const bass = Math.min(...pitches) % 12;
  // Prefer the bass note as root; otherwise any root that spells a known shape.
  for (const root of [bass, ...classes.filter((pc) => pc !== bass)]) {
    const intervals = classes.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b);
    const match = CHORDS.find(([shape]) => shape.length === intervals.length && shape.every((step, i) => step === intervals[i]));
    if (match) return `${PITCH_NAMES[root]}${match[1]}${root === bass ? "" : `/${PITCH_NAMES[bass]}`}`;
  }
  return null;
}

/** Chord names along a clip, one per stretch where the sounding chord stays the same. */
export function chordTimeline(
  notes: readonly { pitch: number; startTick: number; durationTicks: number }[],
  stepTicks: number,
  lengthTicks: number
): { startTick: number; endTick: number; name: string }[] {
  const out: { startTick: number; endTick: number; name: string }[] = [];
  for (let tick = 0; tick < lengthTicks; tick += stepTicks) {
    const sounding = notes.filter((note) => note.startTick <= tick && tick < note.startTick + note.durationTicks).map((note) => note.pitch);
    const name = chordName(sounding);
    const last = out[out.length - 1];
    if (name && last && last.name === name && last.endTick === tick) last.endTick = Math.min(lengthTicks, tick + stepTicks);
    else if (name) out.push({ startTick: tick, endTick: Math.min(lengthTicks, tick + stepTicks), name });
  }
  return out;
}

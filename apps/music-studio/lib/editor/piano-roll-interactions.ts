export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NoteRectangle extends Rectangle {
  id: string;
}

export function rectangleFromPoints(start: Point, end: Point): Rectangle {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y)
  };
}

export function rectanglesIntersect(left: Rectangle, right: Rectangle): boolean {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

export function notesInsideMarquee(
  marquee: Rectangle,
  notes: readonly NoteRectangle[]
): Set<string> {
  return new Set(notes.filter((note) => rectanglesIntersect(marquee, note)).map((note) => note.id));
}

export function clampZoom(value: number, minimum = 0.5, maximum = 4): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function nextClipboardStart(
  sourceStartTick: number,
  sourceMinimumTick: number,
  destinationTick: number
): number {
  return destinationTick + (sourceStartTick - sourceMinimumTick);
}

export function clampNoteToClip(
  startTick: number,
  durationTicks: number,
  clipDurationTicks: number
): { startTick: number; durationTicks: number } {
  const safeDuration = Math.max(1, Math.min(durationTicks, clipDurationTicks));
  const safeStart = Math.max(0, Math.min(startTick, clipDurationTicks - safeDuration));
  return { startTick: safeStart, durationTicks: safeDuration };
}

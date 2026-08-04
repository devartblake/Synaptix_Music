export const PIANO_ROLL_GRIDS = [
  { label: "1/4", ticks: 960 },
  { label: "1/8", ticks: 480 },
  { label: "1/16", ticks: 240 },
  { label: "1/32", ticks: 120 },
  { label: "1/8T", ticks: 320 },
  { label: "1/16T", ticks: 160 }
] as const;

export function snapTick(value: number, gridTicks: number, maximum: number): number {
  if (!Number.isInteger(gridTicks) || gridTicks <= 0) {
    throw new RangeError("Grid ticks must be a positive integer.");
  }
  return Math.max(0, Math.min(maximum, Math.round(value / gridTicks) * gridTicks));
}

export function toggleSelection(
  selected: ReadonlySet<string>,
  noteId: string,
  additive: boolean
): Set<string> {
  if (!additive) return new Set([noteId]);
  const next = new Set(selected);
  if (next.has(noteId)) next.delete(noteId);
  else next.add(noteId);
  return next;
}

export function pitchFromPointer(
  pointerY: number,
  height: number,
  highestPitch: number,
  lowestPitch: number
): number {
  const rows = highestPitch - lowestPitch + 1;
  const row = Math.max(0, Math.min(rows - 1, Math.floor((pointerY / height) * rows)));
  return highestPitch - row;
}

export function tickFromPointer(pointerX: number, width: number, durationTicks: number): number {
  return Math.max(0, Math.min(durationTicks, Math.round((pointerX / width) * durationTicks)));
}
